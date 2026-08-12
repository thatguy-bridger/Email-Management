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

// Incremental by design: fetches UIDs strictly after account.last_uid. On a
// brand-new account there's no watermark yet, so it backfills a bounded
// window (last 50) instead of the whole mailbox -- important because this
// runs inside a serverless function with a hard time limit.
export async function syncAccount(account) {
  const client = buildClient(account);
  await client.connect();
  const results = [];
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uidNext = client.mailbox.uidNext;
      const startUid = account.last_uid > 0 ? account.last_uid + 1 : Math.max(1, uidNext - 50);
      if (startUid >= uidNext) {
        return { messages: [], maxUid: account.last_uid };
      }
      let maxUid = account.last_uid;
      for await (const msg of client.fetch(
        `${startUid}:*`,
        { uid: true, envelope: true, flags: true, source: true },
        { uid: true }
      )) {
        if (msg.uid < startUid) continue;
        maxUid = Math.max(maxUid, msg.uid);
        const parsed = await simpleParser(msg.source);
        results.push({
          uid: msg.uid,
          messageId: parsed.messageId || null,
          threadId: deriveThreadId(parsed, `${account.id}-${msg.uid}`),
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
          needsReply: guessNeedsReply(parsed, account.username),
        });
      }
      return { messages: results, maxUid };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
