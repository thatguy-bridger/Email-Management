import { query } from '../../lib/db.js';
import { withApi, methodGuard, HttpError } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';

// Consolidates list/get/update into one function -- see
// api/auth/[[...segments]].js for why (Vercel Hobby plan's 12-function cap).

const LIST_COLUMNS = `
  id, account_id, thread_id, from_name, from_email, to_json, subject, snippet,
  date, seen, flagged, archived, trashed, has_attachments, category_id,
  category_locked, needs_reply
`;
// Fetching a thread (?threadId=) is for rendering a full conversation in the
// reading pane, so it needs the bodies too -- the plain inbox list never
// does, and stays lighter for it.
const THREAD_COLUMNS = `${LIST_COLUMNS}, body_html, body_text`;

async function listMessages(user, req, res) {
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
  const params = [user.id];

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
    SELECT ${threadId ? THREAD_COLUMNS : LIST_COLUMNS} FROM messages
    WHERE ${where.join(' AND ')}
    ORDER BY date DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const { rows } = await query(sql, params);
  res.status(200).json({ messages: rows });
}

async function getOrUpdateMessage(user, id, req, res) {
  if (!methodGuard(req, res, ['GET', 'PATCH'])) return;

  if (req.method === 'GET') {
    const { rows } = await query('SELECT * FROM messages WHERE id = $1 AND user_id = $2', [id, user.id]);
    if (!rows.length) throw new HttpError(404, 'Message not found');
    if (!rows[0].seen) {
      await query('UPDATE messages SET seen = true WHERE id = $1', [id]);
      rows[0].seen = true;
    }
    return res.status(200).json({ message: rows[0] });
  }

  const body = req.body || {};

  if (body.categoryId !== undefined && body.categoryId !== null) {
    const { rows: catCheck } = await query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [
      body.categoryId,
      user.id,
    ]);
    if (!catCheck.length) throw new HttpError(400, 'Invalid category');
  }

  const fields = [];
  const params = [id, user.id];
  const set = (col, val) => {
    params.push(val);
    fields.push(`${col} = $${params.length}`);
  };

  if (typeof body.seen === 'boolean') set('seen', body.seen);
  if (typeof body.flagged === 'boolean') set('flagged', body.flagged);
  if (typeof body.archived === 'boolean') set('archived', body.archived);
  if (typeof body.trashed === 'boolean') set('trashed', body.trashed);
  if (typeof body.needsReply === 'boolean') set('needs_reply', body.needsReply);
  if (body.categoryId !== undefined) {
    set('category_id', body.categoryId);
    set('category_locked', true);
  }

  if (!fields.length) throw new HttpError(400, 'No recognized fields to update');

  const { rows } = await query(
    `UPDATE messages SET ${fields.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
    params
  );
  if (!rows.length) throw new HttpError(404, 'Message not found');
  res.status(200).json({ message: rows[0] });
}

export default withApi(async (req, res) => {
  const segments = req.query.segments || [];
  const user = await requireUser(req);

  if (segments.length === 0) {
    if (!methodGuard(req, res, ['GET'])) return;
    return listMessages(user, req, res);
  }

  if (segments.length === 1) {
    return getOrUpdateMessage(user, segments[0], req, res);
  }

  throw new HttpError(404, 'Not found');
});
