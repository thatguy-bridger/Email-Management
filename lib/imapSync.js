import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { decrypt } from './crypto.js';

// Presets cover the providers that still support plain IMAP login with a
// password (an "app-specific password" for the ones that require 2FA).
// Microsoft retired basic-auth IMAP for Outlook.com/Office365 in 2024/2025,
// so there is no working preset for it here -- see README for why.
export const PROVIDER_PRESETS = {
  icloud: { label: 'iCloud Mail', host: 'imap.mail.me.com', port: 993, secure: true },
  gmail: { label: 'Gmail', host: 'imap.gmail.com', port: 993, secure: true },
  yahoo: { label: 'Yahoo Mail', host: 'imap.mail.yahoo.com', port: 993, secure: true },
  fastmail: { label: 'Fastmail', host: 'imap.fastmail.com', port: 993, secure: true },
  custom: { label: 'Other (custom IMAP)', host: '', port: 993, secure: true },
};

function buildClient(account) {
  return new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_secure,
    auth: {
      user: account.username,
      pass: decrypt(account.encrypted_password),
    },
    logger: false,
  });
}

export async function testConnection(account) {
  const client = buildClient(account);
  await client.connect();
  await client.logout();
}

const NO_REPLY_PATTERN = /no-?reply|notifications?@|mailer-daemon|do-?not-?reply/i;

function guessNeedsReply(parsed, accountEmail) {
  if (NO_REPLY_PATTERN.test(parsed.from?.value?.[0]?.address || '')) return false;
  if (parsed.headers?.has('list-unsubscribe')) return false;
  const directTo = (parsed.to?.value || []).some(
    (t) => t.address?.toLowerCase() === accountEmail.toLowerCase()
  );
  return directTo;
}

function toRecipientJson(addressObject) {
  return (addressObject?.value || []).map((v) => ({ name: v.name, address: v.address }));
}

function deriveThreadId(parsed, fallback) {
  const refs = parsed.references
    ? Array.isArray(parsed.references)
      ? parsed.references
      : String(parsed.references).split(/\s+/)
    : [];
  return refs[0] || parsed.messageId || fallback;
}

// Picks the mailbox to sync from: Gmail's "All Mail" (every message except
// Trash/Spam, archived mail included) if the server exposes one via the
// IMAP SPECIAL-USE extension, else a real separate "Archive" folder for
// providers that have one, else just INBOX -- which is what every account
// synced under before this existed, so behavior is unchanged where neither
// special-use folder exists.
async function findSyncMailbox(client) {
  const list = await client.list();
  const all = list.find((m) => m.specialUse === '\\All');
  if (all) return all;
  const archive = list.find((m) => m.specialUse === '\\Archive');
  if (archive) return archive;
  return list.find((m) => m.path === 'INBOX') || { path: 'INBOX', specialUse: undefined };
}

// Whether a message counts as "in the inbox" for this app's own archived
// flag, given which kind of mailbox it was fetched from:
//  - Gmail's All Mail holds everything, inbox and archived alike, so the
//    only way to tell them apart is the real-time \Inbox label Gmail's IMAP
//    server reports via the X-GM-EXT-1 extension.
//  - A dedicated Archive folder (non-Gmail) only ever holds archived mail
//    by definition -- no label needed, folder membership says it all.
//  - Plain INBOX (no special-use folder found) means every message synced
//    is, tautologically, in the inbox.
function isInInbox(mailboxInfo, msg) {
  if (mailboxInfo.specialUse === '\\All') return !!msg.labels?.has('\\Inbox');
  if (mailboxInfo.specialUse === '\\Archive') return false;
  return true;
}

async function fetchRange(client, range, mailboxInfo) {
  const useLabels = mailboxInfo.specialUse === '\\All';
  const fetchQuery = { uid: true, envelope: true, flags: true, source: true };
  if (useLabels) fetchQuery.labels = true;

  const results = [];
  for await (const msg of client.fetch(range, fetchQuery, { uid: true })) {
    const parsed = await simpleParser(msg.source);
    results.push({
      uid: msg.uid,
      mailboxPath: mailboxInfo.path,
      archived: !isInInbox(mailboxInfo, msg),
      messageId: parsed.messageId || null,
      threadId: deriveThreadId(parsed, `${mailboxInfo.path}-${msg.uid}`),
      inReplyTo: parsed.inReplyTo || null,
      fromName: parsed.from?.value?.[0]?.name || '',
      fromEmail: parsed.from?.value?.[0]?.address || '',
      toJson: toRecipientJson(parsed.to),
      subject: parsed.subject || '(no subject)',
      snippet: (parsed.text || '').slice(0, 240).replace(/\s+/g, ' ').trim(),
      bodyHtml: parsed.html || null,
      bodyText: parsed.text || null,
      date: parsed.date || new Date(),
      seen: msg.flags?.has('\\Seen') ?? false,
      flagged: msg.flags?.has('\\Flagged') ?? false,
      hasAttachments: (parsed.attachments || []).length > 0,
      needsReply: guessNeedsReply(parsed, mailboxInfo.accountEmail),
    });
  }
  return results;
}

// Bounded so one call comfortably finishes inside a serverless function's
// hard time limit (60s) even for large HTML messages -- a backfill of
// thousands of archived messages happens across many sync calls instead of
// one, each chipping away at the next-older batch.
const BACKFILL_BATCH_SIZE = 150;
// Same "recent window" a brand-new account has always gotten immediately,
// before backfill has had a chance to run at all.
const INITIAL_RECENT_WINDOW = 50;

// Incremental by design: fetches UIDs strictly after account.last_uid for
// new mail, plus (separately) one bounded batch of older mail for
// historical backfill. The sync source (INBOX vs. a special-use All
// Mail/Archive folder) can change between calls -- most commonly the very
// first time this runs against an account that was previously only ever
// synced from INBOX -- and since IMAP UIDs are scoped to a single mailbox,
// last_uid/backfill_before_uid from the old source are meaningless against
// the new one's numbering. account.sync_mailbox records which mailbox the
// current watermarks belong to, so a mismatch (including "never synced at
// all") (re)initializes both against the newly detected source instead of
// comparing UIDs across two different mailboxes.
export async function syncAccount(account) {
  const client = buildClient(account);
  await client.connect();
  try {
    const mailboxInfo = await findSyncMailbox(client);
    mailboxInfo.accountEmail = account.username;

    const lock = await client.getMailboxLock(mailboxInfo.path);
    try {
      const uidNext = client.mailbox.uidNext;
      let results = [];
      let newLastUid = account.last_uid;
      let newBackfillBeforeUid = account.backfill_before_uid;
      let newBackfillComplete = account.backfill_complete;

      if (account.sync_mailbox !== mailboxInfo.path) {
        // First sync against this mailbox (brand-new account, or the
        // detected source just changed) -- grab the recent window
        // immediately for instant value, then start backfill from just
        // below it.
        const recentStart = Math.max(1, uidNext - INITIAL_RECENT_WINDOW);
        if (recentStart < uidNext) {
          results = results.concat(await fetchRange(client, `${recentStart}:*`, mailboxInfo));
        }
        newLastUid = uidNext - 1;
        newBackfillBeforeUid = recentStart;
        newBackfillComplete = recentStart <= 1;
      } else {
        const startUid = account.last_uid + 1;
        if (startUid < uidNext) {
          results = results.concat(await fetchRange(client, `${startUid}:*`, mailboxInfo));
          newLastUid = uidNext - 1;
        }

        if (!account.backfill_complete && account.backfill_before_uid > 1) {
          const batchStart = Math.max(1, account.backfill_before_uid - BACKFILL_BATCH_SIZE);
          results = results.concat(
            await fetchRange(client, `${batchStart}:${account.backfill_before_uid - 1}`, mailboxInfo)
          );
          newBackfillBeforeUid = batchStart;
          newBackfillComplete = batchStart <= 1;
        }
      }

      return {
        messages: results,
        maxUid: newLastUid,
        syncMailbox: mailboxInfo.path,
        backfillBeforeUid: newBackfillBeforeUid,
        backfillComplete: newBackfillComplete,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
