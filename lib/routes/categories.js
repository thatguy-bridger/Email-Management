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
           COUNT(m.id) FILTER (WHERE m.seen = false AND m.archived = false AND m.trashed = false)::int AS unread_count,
           EXISTS(SELECT 1 FROM categories ch WHERE ch.parent_id = c.id)::bool AS has_children
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

// Only leaf categories (no subcategories of their own) can hold mail --
// once a category gains a child it becomes purely an organizational node.
// Exported so messages.js/rules.js can enforce the same rule wherever a
// category gets assigned to a message or a rule.
export async function assertLeafCategory(userId, categoryId) {
  const { rows } = await query(
    `SELECT EXISTS(SELECT 1 FROM categories WHERE parent_id = $1) AS has_children
     FROM categories WHERE id = $1 AND user_id = $2`,
    [categoryId, userId]
  );
  if (!rows.length) throw new HttpError(400, 'Invalid category');
  if (rows[0].has_children) {
    throw new HttpError(
      400,
      "That category has subcategories now, so it can't hold mail directly -- pick one of its subcategories instead."
    );
  }
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

// Runs whenever a category gains a child (or might already have one) --
// idempotent, so it's safe to call unconditionally rather than trying to
// detect the exact "just became a parent" transition. Mail that was filed
// directly under it is uncategorized; rules that only categorized into it
// (no other action) become inert and are removed, while rules that also
// trash/mark-read keep that action and just lose the categorization half.
// Returns counts so the caller can tell the user what changed. Exported so
// gmailImport.js can call it too -- a multi-level import (e.g. "Finance/Bank"
// arriving before "Finance/Bank/Wire") can turn a category that already had
// a rule pointing at it into a parent partway through the same import.
export async function demoteToParent(userId, categoryId) {
  const [{ rowCount: messagesUncategorized }, { rowCount: rulesRemoved }, { rowCount: rulesUpdated }] = await Promise.all([
    query('UPDATE messages SET category_id = NULL WHERE category_id = $1 AND user_id = $2', [categoryId, userId]),
    query(
      'DELETE FROM rules WHERE category_id = $1 AND user_id = $2 AND mark_trashed = false AND mark_seen = false',
      [categoryId, userId]
    ),
    query(
      'UPDATE rules SET category_id = NULL WHERE category_id = $1 AND user_id = $2 AND (mark_trashed = true OR mark_seen = true)',
      [categoryId, userId]
    ),
  ]);
  if (!messagesUncategorized && !rulesRemoved && !rulesUpdated) return null;
  return { messagesUncategorized, rulesRemoved, rulesUpdated };
}

async function checkParent(userId, parentId) {
  const { rows } = await query('SELECT id, is_builtin FROM categories WHERE id = $1 AND user_id = $2', [
    parentId,
    userId,
  ]);
  if (!rows.length) throw new HttpError(400, 'Invalid parent category');
  if (rows[0].is_builtin) throw new HttpError(400, "The Primary category can't have subcategories");
}

export async function createCategory(user, req, res) {
  const { name, color, icon, parentId } = req.body || {};
  if (!name) throw new HttpError(400, 'name is required');
  if (parentId) await checkParent(user.id, parentId);

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
  const demoted = parentId ? await demoteToParent(user.id, parentId) : null;
  res.status(201).json({ category: rows[0], demotedParent: demoted });
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
    const { rows: selfCheck } = await query('SELECT is_builtin FROM categories WHERE id = $1 AND user_id = $2', [
      id,
      user.id,
    ]);
    if (!selfCheck.length) throw new HttpError(404, 'Category not found');
    if (selfCheck[0].is_builtin) throw new HttpError(400, "The Primary category can't be nested under another category");
    await checkParent(user.id, parentId);
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
  const demoted = parentId ? await demoteToParent(user.id, parentId) : null;
  res.status(200).json({ category: rows[0], demotedParent: demoted });
}
