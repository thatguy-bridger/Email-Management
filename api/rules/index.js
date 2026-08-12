import { query } from '../../lib/db.js';
import { withAuth } from '../../lib/withAuth.js';
import { methodGuard, HttpError } from '../../lib/http.js';
import { newId } from '../../lib/seed.js';

const VALID_FIELDS = new Set(['from', 'to', 'domain', 'subject', 'body']);
const VALID_OPERATORS = new Set(['contains', 'equals', 'starts_with', 'ends_with']);

export default withAuth(async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  if (req.method === 'GET') {
    const { rows } = await query(
      `
      SELECT r.*, c.name AS category_name, c.color AS category_color
      FROM rules r JOIN categories c ON c.id = r.category_id
      WHERE r.user_id = $1
      ORDER BY r.priority DESC, r.created_at ASC
    `,
      [req.user.id]
    );
    return res.status(200).json({ rules: rows });
  }

  const { name, field, operator, value, categoryId, priority } = req.body || {};
  if (!name || !field || !operator || !value || !categoryId) {
    throw new HttpError(400, 'name, field, operator, value, and categoryId are required');
  }
  if (!VALID_FIELDS.has(field)) throw new HttpError(400, `field must be one of ${[...VALID_FIELDS].join(', ')}`);
  if (!VALID_OPERATORS.has(operator)) throw new HttpError(400, `operator must be one of ${[...VALID_OPERATORS].join(', ')}`);

  const { rows: catCheck } = await query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [
    categoryId,
    req.user.id,
  ]);
  if (!catCheck.length) throw new HttpError(400, 'Invalid category');

  const id = newId('rule');
  const { rows } = await query(
    `INSERT INTO rules (id, user_id, name, field, operator, value, category_id, priority, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *`,
    [id, req.user.id, name, field, operator, value, categoryId, priority || 0]
  );
  res.status(201).json({ rule: rows[0] });
});
