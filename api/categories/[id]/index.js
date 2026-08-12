import { query } from '../../../lib/db.js';
import { withAuth } from '../../../lib/withAuth.js';
import { methodGuard, HttpError } from '../../../lib/http.js';

export default withAuth(async (req, res) => {
  if (!methodGuard(req, res, ['PATCH', 'DELETE'])) return;
  const { id } = req.query;

  if (req.method === 'DELETE') {
    const { rows } = await query('SELECT is_builtin FROM categories WHERE id = $1 AND user_id = $2', [
      id,
      req.user.id,
    ]);
    if (!rows.length) throw new HttpError(404, 'Category not found');
    if (rows[0].is_builtin) throw new HttpError(400, 'The Primary category cannot be deleted');
    // Messages, and any rules pointing at this category, fall back to
    // uncategorized/no-op rather than being deleted alongside the category.
    await query('UPDATE messages SET category_id = NULL WHERE category_id = $1', [id]);
    await query('DELETE FROM rules WHERE category_id = $1', [id]);
    await query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    return res.status(204).end();
  }

  const { name, color, icon, sortOrder } = req.body || {};
  const { rows } = await query(
    `UPDATE categories SET
       name = COALESCE($3, name),
       color = COALESCE($4, color),
       icon = COALESCE($5, icon),
       sort_order = COALESCE($6, sort_order)
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    // node-postgres rejects `undefined` params, so omitted fields need to
    // become null before hitting COALESCE.
    [id, req.user.id, name ?? null, color ?? null, icon ?? null, sortOrder ?? null]
  );
  if (!rows.length) throw new HttpError(404, 'Category not found');
  res.status(200).json({ category: rows[0] });
});
