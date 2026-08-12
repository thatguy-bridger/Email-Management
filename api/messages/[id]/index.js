import { query } from '../../../lib/db.js';
import { withAuth } from '../../../lib/withAuth.js';
import { methodGuard, HttpError } from '../../../lib/http.js';

export default withAuth(async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'PATCH'])) return;
  const { id } = req.query;

  if (req.method === 'GET') {
    const { rows } = await query('SELECT * FROM messages WHERE id = $1 AND user_id = $2', [id, req.user.id]);
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
      req.user.id,
    ]);
    if (!catCheck.length) throw new HttpError(400, 'Invalid category');
  }

  const fields = [];
  const params = [id, req.user.id];
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
});
