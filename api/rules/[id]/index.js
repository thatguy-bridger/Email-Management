import { query } from '../../../lib/db.js';
import { withAuth } from '../../../lib/withAuth.js';
import { methodGuard, HttpError } from '../../../lib/http.js';

export default withAuth(async (req, res) => {
  if (!methodGuard(req, res, ['PATCH', 'DELETE'])) return;
  const { id } = req.query;

  if (req.method === 'DELETE') {
    const { rowCount } = await query('DELETE FROM rules WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Rule not found');
    return res.status(204).end();
  }

  const { name, field, operator, value, categoryId, priority, enabled } = req.body || {};
  if (categoryId) {
    const { rows: catCheck } = await query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [
      categoryId,
      req.user.id,
    ]);
    if (!catCheck.length) throw new HttpError(400, 'Invalid category');
  }

  const { rows } = await query(
    `UPDATE rules SET
       name = COALESCE($3, name),
       field = COALESCE($4, field),
       operator = COALESCE($5, operator),
       value = COALESCE($6, value),
       category_id = COALESCE($7, category_id),
       priority = COALESCE($8, priority),
       enabled = COALESCE($9, enabled)
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    // node-postgres rejects `undefined` params, so omitted fields need to
    // become null before hitting COALESCE.
    [id, req.user.id, name ?? null, field ?? null, operator ?? null, value ?? null, categoryId ?? null, priority ?? null, enabled ?? null]
  );
  if (!rows.length) throw new HttpError(404, 'Rule not found');
  res.status(200).json({ rule: rows[0] });
});
