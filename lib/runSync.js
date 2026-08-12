import { query } from './db.js';
import { syncAccount } from './imapSync.js';
import { findMatchingRule } from './ruleEngine.js';
import { newId } from './seed.js';

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

      for (const m of messages) {
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

        await query(
          `INSERT INTO messages
            (id, user_id, account_id, uid, mailbox, message_id, thread_id, in_reply_to, from_name, from_email,
             to_json, subject, snippet, body_html, body_text, date, seen, flagged, archived, has_attachments,
             category_id, needs_reply, trashed)
           SELECT $1,$2,$3,$4,$5,$6::text,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
           -- IMAP UIDs are mailbox-scoped, so the ON CONFLICT target below
           -- (account_id, uid, mailbox) only guards against re-fetching the
           -- exact same mailbox+uid twice. It can't catch the same email
           -- arriving via a *different* mailbox (e.g. this account used to
           -- sync INBOX only and now syncs All Mail instead) -- message_id
           -- is stable across mailboxes, so this WHERE NOT EXISTS is the
           -- guard for that case specifically. Postgres can't infer $6's
           -- type from this INSERT...SELECT...WHERE shape on its own (no
           -- plain VALUES list to pin column types to), hence the explicit
           -- casts -- without them this throws "could not determine data
           -- type of parameter $6" at runtime.
           WHERE $6::text IS NULL OR NOT EXISTS (
             SELECT 1 FROM messages WHERE account_id = $3 AND message_id = $6::text
           )
           ON CONFLICT (account_id, uid, mailbox) DO NOTHING`,
          [
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
          ]
        );
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
