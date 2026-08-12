import { query } from '../../lib/db.js';
import { withApi, methodGuard, HttpError } from '../../lib/http.js';
import { newId } from '../../lib/seed.js';

const VALID_FIELDS = new Set(['from', 'to', 'domain', 'subject', 'body']);
const VALID_OPERATORS = new Set(['contains', 'equals', 'starts_with', 'ends_with']);

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  if (req.method === 'GET') {
    const { rows } = await query(`
      SELECT r.*, c.name AS category_name, c.color AS category_color
      FROM rules r JOIN categories c ON c.id = r.category_id
      ORDER BY r.priority DESC, r.created_at ASC
    `);
    return res.status(200).json({ rules: rows });
  }

  const { name, field, operator, value, categoryId, priority } = req.body || {};
  if (!name || !field || !operator || !value || !categoryId) {
    throw new HttpError(400, 'name, field, operator, value, and categoryId are required');
  }
  if (!VALID_FIELDS.has(field)) throw new HttpError(400, `field must be one of ${[...VALID_FIELDS].join(', ')}`);
  if (!VALID_OPERATORS.has(operator)) throw new HttpError(400, `operator must be one of ${[...VALID_OPERATORS].join(', ')}`);

  const id = newId('rule');
  const { rows } = await query(
    `INSERT INTO rules (id, name, field, operator, value, category_id, priority, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *`,
    [id, name, field, operator, value, categoryId, priority || 0]
  );
  res.status(201).json({ rule: rows[0] });
});
