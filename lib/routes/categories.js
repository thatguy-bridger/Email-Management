import { query } from '../db.js';
import { HttpError, methodGuard } from '../http.js';
import { newId } from '../seed.js';

// Logic behind api/categories/index.js, which dispatches list/create/
// update/delete on ?id= in the query string.

export async function listCategories(user, req, res) {
  const { rows } = await query(
    `
    SELECT c.*,
           COUNT(m.id) FILTER (WHERE m.archived = false AND m.trashed = false)::int AS total,
           COUNT(m.id) FILTER (WHERE m.seen = false AND m.archived = false AND m.trashed = false)::int AS unread_count
    FROM categories c
    LEFT JOIN messages m ON m.category_id = c.id
    WHERE c.user_id = $1
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.created_at ASC
  `,
    [user.id]
  );
  res.status(200).json({ categories: rows });
}

// Walks the proposed parent's own ancestor chain to make sure it never
// reaches `categoryId` -- prevents A -> B -> A cycles (including the
// trivial one-step case of setting a category as its own parent).
async function assertNoCycle(userId, categoryId, proposedParentId) {
  if (!proposedParentId) return;
  if (proposedParentId === categoryId) throw new HttpError(400, "A category can't be its own parent");
  let cursor = proposedParentId;
  for (let depth = 0; depth < 50 && cursor; depth++) {
    const { rows } = await query('SELECT parent_id FROM categories WHERE id = $1 AND user_id = $2', [cursor, userId]);
    if (!rows.length) throw new HttpError(400, 'Invalid parent category');
    if (rows[0].parent_id === categoryId) throw new HttpError(400, "That category is already nested under this one");
    cursor = rows[0].parent_id;
  }
}

export async function createCategory(user, req, res) {
  const { name, color, icon, parentId } = req.body || {};
  if (!name) throw new HttpError(400, 'name is required');
  if (parentId) {
    const { rows: parentCheck } = await query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [
      parentId,
      user.id,
    ]);
    if (!parentCheck.length) throw new HttpError(400, 'Invalid parent category');
  }
  const { rows: maxRows } = await query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM categories WHERE user_id = $1',
    [user.id]
  );
  const id = newId('cat');
  const { rows } = await query(
    `INSERT INTO categories (id, user_id, name, color, icon, is_builtin, sort_order, parent_id)
     VALUES ($1,$2,$3,$4,$5,false,$6,$7) RETURNING *`,
    [id, user.id, name, color || '#6366f1', icon || 'tag', maxRows[0].next, parentId || null]
  );
  res.status(201).json({ category: rows[0] });
}

export async function updateOrDeleteCategory(user, id, req, res) {
  if (!methodGuard(req, res, ['PATCH', 'DELETE'])) return;

  if (req.method === 'DELETE') {
    const { rows } = await query('SELECT is_builtin FROM categories WHERE id = $1 AND user_id = $2', [
      id,
      user.id,
    ]);
    if (!rows.length) throw new HttpError(404, 'Category not found');
    if (rows[0].is_builtin) throw new HttpError(400, 'The Primary category cannot be deleted');
    // Messages, and any rules pointing at this category, fall back to
    // uncategorized/no-op rather than being deleted alongside the category.
    // Children are promoted to top-level automatically by the parent_id
    // foreign key's ON DELETE SET NULL, not deleted with their parent.
    await query('UPDATE messages SET category_id = NULL WHERE category_id = $1', [id]);
    await query('DELETE FROM rules WHERE category_id = $1', [id]);
    await query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [id, user.id]);
    return res.status(204).end();
  }

  const { name, color, icon, sortOrder, parentId } = req.body || {};
  if (parentId !== undefined && parentId !== null) {
    const { rows: parentCheck } = await query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [
      parentId,
      user.id,
    ]);
    if (!parentCheck.length) throw new HttpError(400, 'Invalid parent category');
    await assertNoCycle(user.id, id, parentId);
  }

  const { rows } = await query(
    `UPDATE categories SET
       name = COALESCE($3, name),
       color = COALESCE($4, color),
       icon = COALESCE($5, icon),
       sort_order = COALESCE($6, sort_order),
       parent_id = CASE WHEN $7 THEN $8 ELSE parent_id END
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    // node-postgres rejects `undefined` params, so omitted fields need to
    // become null before hitting COALESCE. parent_id is a genuine nullable
    // field (moving a category back to top-level is a valid edit), so it
    // can't use the same COALESCE-skips-null trick as the others -- a
    // separate "was this field provided at all" flag distinguishes "leave
    // unchanged" from "set to top-level".
    [id, user.id, name ?? null, color ?? null, icon ?? null, sortOrder ?? null, parentId !== undefined, parentId ?? null]
  );
  if (!rows.length) throw new HttpError(404, 'Category not found');
  res.status(200).json({ category: rows[0] });
}
