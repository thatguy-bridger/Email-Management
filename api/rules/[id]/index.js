import { query } from '../../../lib/db.js';
import { withApi, methodGuard, HttpError } from '../../../lib/http.js';

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['PATCH', 'DELETE'])) return;
  const { id } = req.query;

  if (req.method === 'DELETE') {
    const { rowCount } = await query('DELETE FROM rules WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Rule not found');
    return res.status(204).end();
  }

  const { name, field, operator, value, categoryId, priority, enabled } = req.body || {};
  const { rows } = await query(
    `UPDATE rules SET
       name = COALESCE($2, name),
       field = COALESCE($3, field),
       operator = COALESCE($4, operator),
       value = COALESCE($5, value),
       category_id = COALESCE($6, category_id),
       priority = COALESCE($7, priority),
       enabled = COALESCE($8, enabled)
     WHERE id = $1 RETURNING *`,
    // node-postgres rejects `undefined` params, so omitted fields need to
    // become null before hitting COALESCE.
    [id, name ?? null, field ?? null, operator ?? null, value ?? null, categoryId ?? null, priority ?? null, enabled ?? null]
  );
  if (!rows.length) throw new HttpError(404, 'Rule not found');
  res.status(200).json({ rule: rows[0] });
});
