import { query } from '../../lib/db.js';
import { withAuth } from '../../lib/withAuth.js';
import { methodGuard } from '../../lib/http.js';

const LIST_COLUMNS = `
  id, account_id, thread_id, from_name, from_email, to_json, subject, snippet,
  date, seen, flagged, archived, trashed, has_attachments, category_id,
  category_locked, needs_reply
`;

export default withAuth(async (req, res) => {
  if (!methodGuard(req, res, ['GET'])) return;

  const {
    mailbox = 'inbox',
    category,
    account,
    threadId,
    q,
    unread,
    flagged,
    needsReply,
    limit = '50',
    offset = '0',
  } = req.query;

  const where = ['user_id = $1'];
  const params = [req.user.id];

  if (threadId) {
    where.push(`thread_id = $${params.push(threadId)}`);
  } else if (mailbox === 'archived') {
    where.push('archived = true', 'trashed = false');
  } else if (mailbox === 'trashed') {
    where.push('trashed = true');
  } else {
    where.push('archived = false', 'trashed = false');
  }

  if (category === 'uncategorized') {
    where.push('category_id IS NULL');
  } else if (category) {
    where.push(`category_id = $${params.push(category)}`);
  }
  if (account) where.push(`account_id = $${params.push(account)}`);
  if (unread === 'true') where.push('seen = false');
  if (flagged === 'true') where.push('flagged = true');
  if (needsReply === 'true') where.push('needs_reply = true');
  if (q) {
    const i = params.push(`%${q}%`);
    where.push(`(subject ILIKE $${i} OR from_name ILIKE $${i} OR from_email ILIKE $${i} OR snippet ILIKE $${i})`);
  }

  const limitN = Math.min(parseInt(limit, 10) || 50, 200);
  const offsetN = parseInt(offset, 10) || 0;
  params.push(limitN, offsetN);

  const sql = `
    SELECT ${LIST_COLUMNS} FROM messages
    WHERE ${where.join(' AND ')}
    ORDER BY date DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const { rows } = await query(sql, params);
  res.status(200).json({ messages: rows });
});
