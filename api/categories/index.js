import { query } from '../../lib/db.js';
import { withApi, methodGuard, HttpError } from '../../lib/http.js';
import { newId } from '../../lib/seed.js';

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;

  if (req.method === 'GET') {
    const { rows } = await query(`
      SELECT c.*,
             COUNT(m.id) FILTER (WHERE m.archived = false AND m.trashed = false)::int AS total,
             COUNT(m.id) FILTER (WHERE m.seen = false AND m.archived = false AND m.trashed = false)::int AS unread_count
      FROM categories c
      LEFT JOIN messages m ON m.category_id = c.id
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.created_at ASC
    `);
    return res.status(200).json({ categories: rows });
  }

  const { name, color, icon } = req.body || {};
  if (!name) throw new HttpError(400, 'name is required');
  const { rows: maxRows } = await query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM categories');
  const id = newId('cat');
  const { rows } = await query(
    `INSERT INTO categories (id, name, color, icon, is_builtin, sort_order)
     VALUES ($1,$2,$3,$4,false,$5) RETURNING *`,
    [id, name, color || '#6366f1', icon || 'tag', maxRows[0].next]
  );
  res.status(201).json({ category: rows[0] });
});
