import { query } from './db.js';
import { syncAccount } from './imapSync.js';
import { findMatchingRule } from './ruleEngine.js';
import { newId } from './seed.js';

// (name, sql type) in insert order. Explicit casts on every placeholder --
// not just the nullable ones -- because Postgres can't always infer a type
// for a bare parameter inside a VALUES list feeding an INSERT...SELECT (see
// the WHERE clause below); leaving any of them untyped risks the same
// "could not determine data type of parameter" error at runtime.
const INSERT_COLUMNS = [
  ['id', 'text'],
  ['user_id', 'text'],
  ['account_id', 'text'],
  ['uid', 'integer'],
  ['mailbox', 'text'],
  ['message_id', 'text'],
  ['thread_id', 'text'],
  ['in_reply_to', 'text'],
  ['from_name', 'text'],
  ['from_email', 'text'],
  ['to_json', 'jsonb'],
  ['subject', 'text'],
  ['snippet', 'text'],
  ['body_html', 'text'],
  ['body_text', 'text'],
  ['date', 'timestamptz'],
  ['seen', 'boolean'],
  ['flagged', 'boolean'],
  ['archived', 'boolean'],
  ['has_attachments', 'boolean'],
  ['category_id', 'text'],
  ['needs_reply', 'boolean'],
  ['trashed', 'boolean'],
];

// A backfill batch can be a couple thousand messages -- inserting them one
// row (one awaited round trip) at a time was the dominant cost in a sync
// call once fetching itself got faster, easily adding tens of seconds on
// its own. Chunked multi-row inserts cut that to one round trip per
// INSERT_CHUNK_SIZE rows instead of one per row.
const INSERT_CHUNK_SIZE = 200;

async function insertMessageChunk(rows) {
  if (!rows.length) return;
  const colNames = INSERT_COLUMNS.map(([name]) => name).join(', ');
  const params = [];
  const valueRows = rows.map((row) => {
    const placeholders = INSERT_COLUMNS.map(([, type], i) => {
      params.push(row[i]);
      return `$${params.length}::${type}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  await query(
    `INSERT INTO messages (${colNames})
     SELECT v.* FROM (VALUES ${valueRows.join(', ')}) AS v(${colNames})
     -- Same cross-mailbox dedup as before (see message_id's unique index in
     -- schema.sql): IMAP UIDs are mailbox-scoped, so ON CONFLICT on
     -- (account_id, uid, mailbox) alone can't catch the same email arriving
     -- under a different uid after the sync source mailbox changes --
     -- message_id is what's stable across mailboxes.
     WHERE v.message_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM messages m WHERE m.account_id = v.account_id AND m.message_id = v.message_id
     )
     ON CONFLICT (account_id, uid, mailbox) DO NOTHING`,
    params
  );
}

// Shared by the manual "Sync Now" button and the cron endpoint so the two
// trigger paths can't drift into different behavior.
export async function runAccountSync(account) {
  await query(`UPDATE accounts SET sync_status = 'syncing', sync_error = NULL WHERE id = $1`, [
    account.id,
  ]);

  try {
    const { messages, maxUid, syncMailbox, backfillBeforeUid, backfillComplete } = await syncAccount(account);

    if (messages.length) {
      const [{ rows: ruleRows }, { rows: primaryRows }] = await Promise.all([
        query(
          'SELECT * FROM rules WHERE user_id = $1 AND enabled = true ORDER BY priority DESC, created_at ASC',
          [account.user_id]
        ),
        query('SELECT id FROM categories WHERE user_id = $1 AND is_builtin = true LIMIT 1', [account.user_id]),
      ]);
      const fallbackCategoryId = primaryRows[0]?.id || null;

      const rows = messages.map((m) => {
        const matched = findMatchingRule(
          { from_name: m.fromName, from_email: m.fromEmail, to_json: m.toJson, subject: m.subject, body_text: m.bodyText },
          ruleRows
        );
        const categoryId = matched?.category_id || fallbackCategoryId;
        const trashed = matched?.mark_trashed || false;
        // A rule's "mark as read" only ever adds seen=true on top of what
        // IMAP already reported -- it never un-reads a message that was
        // genuinely unread.
        const seen = m.seen || matched?.mark_seen || false;

        return [
          newId('msg'),
          account.user_id,
          account.id,
          m.uid,
          m.mailboxPath,
          m.messageId,
          m.threadId,
          m.inReplyTo,
          m.fromName,
          m.fromEmail,
          JSON.stringify(m.toJson),
          m.subject,
          m.snippet,
          m.bodyHtml,
          m.bodyText,
          m.date,
          seen,
          m.flagged,
          m.archived,
          m.hasAttachments,
          categoryId,
          m.needsReply,
          trashed,
        ];
      });

      for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
        await insertMessageChunk(rows.slice(i, i + INSERT_CHUNK_SIZE));
      }
    }

    await query(
      `UPDATE accounts SET
         last_uid = $2, sync_mailbox = $3, backfill_before_uid = $4, backfill_complete = $5,
         last_synced_at = now(), sync_status = 'idle', sync_error = NULL
       WHERE id = $1`,
      [account.id, Math.max(maxUid, account.last_uid), syncMailbox, backfillBeforeUid, backfillComplete]
    );
    return { synced: messages.length, backfillComplete };
  } catch (err) {
    await query(`UPDATE accounts SET sync_status = 'error', sync_error = $2 WHERE id = $1`, [
      account.id,
      err.message,
    ]);
    throw err;
  }
}
