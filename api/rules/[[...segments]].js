import { query } from '../../lib/db.js';
import { categorize } from '../../lib/ruleEngine.js';
import { withApi, methodGuard, HttpError } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { newId } from '../../lib/seed.js';

// Consolidates list/create/update/delete/reapply into one function -- see
// api/auth/[[...segments]].js for why (Vercel Hobby plan's 12-function cap).

const VALID_FIELDS = new Set(['from', 'to', 'domain', 'subject', 'body']);
const VALID_OPERATORS = new Set(['contains', 'equals', 'starts_with', 'ends_with']);

async function listRules(user, req, res) {
  const { rows } = await query(
    `
    SELECT r.*, c.name AS category_name, c.color AS category_color
    FROM rules r JOIN categories c ON c.id = r.category_id
    WHERE r.user_id = $1
    ORDER BY r.priority DESC, r.created_at ASC
  `,
    [user.id]
  );
  res.status(200).json({ rules: rows });
}

async function createRule(user, req, res) {
  const { name, field, operator, value, categoryId, priority } = req.body || {};
  if (!name || !field || !operator || !value || !categoryId) {
    throw new HttpError(400, 'name, field, operator, value, and categoryId are required');
  }
  if (!VALID_FIELDS.has(field)) throw new HttpError(400, `field must be one of ${[...VALID_FIELDS].join(', ')}`);
  if (!VALID_OPERATORS.has(operator)) throw new HttpError(400, `operator must be one of ${[...VALID_OPERATORS].join(', ')}`);

  const { rows: catCheck } = await query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [
    categoryId,
    user.id,
  ]);
  if (!catCheck.length) throw new HttpError(400, 'Invalid category');

  const id = newId('rule');
  const { rows } = await query(
    `INSERT INTO rules (id, user_id, name, field, operator, value, category_id, priority, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *`,
    [id, user.id, name, field, operator, value, categoryId, priority || 0]
  );
  res.status(201).json({ rule: rows[0] });
}

async function updateOrDeleteRule(user, id, req, res) {
  if (!methodGuard(req, res, ['PATCH', 'DELETE'])) return;

  if (req.method === 'DELETE') {
    const { rowCount } = await query('DELETE FROM rules WHERE id = $1 AND user_id = $2', [id, user.id]);
    if (!rowCount) throw new HttpError(404, 'Rule not found');
    return res.status(204).end();
  }

  const { name, field, operator, value, categoryId, priority, enabled } = req.body || {};
  if (categoryId) {
    const { rows: catCheck } = await query('SELECT id FROM categories WHERE id = $1 AND user_id = $2', [
      categoryId,
      user.id,
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
    [id, user.id, name ?? null, field ?? null, operator ?? null, value ?? null, categoryId ?? null, priority ?? null, enabled ?? null]
  );
  if (!rows.length) throw new HttpError(404, 'Rule not found');
  res.status(200).json({ rule: rows[0] });
}

// Editing a rule only affects new mail unless you also re-run it against
// history -- this does that. Messages a user hand-assigned a category to
// (category_locked) are left alone.
async function reapplyRules(user, req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const [{ rows: ruleRows }, { rows: messages }, { rows: primaryRows }] = await Promise.all([
    query('SELECT * FROM rules WHERE user_id = $1 AND enabled = true ORDER BY priority DESC, created_at ASC', [
      user.id,
    ]),
    query(
      'SELECT id, from_name, from_email, to_json, subject, body_text FROM messages WHERE user_id = $1 AND category_locked = false',
      [user.id]
    ),
    query('SELECT id FROM categories WHERE user_id = $1 AND is_builtin = true LIMIT 1', [user.id]),
  ]);
  const fallbackCategoryId = primaryRows[0]?.id || null;

  let updated = 0;
  for (const m of messages) {
    const categoryId = categorize(m, ruleRows) || fallbackCategoryId;
    const { rowCount } = await query(
      'UPDATE messages SET category_id = $2 WHERE id = $1 AND category_id IS DISTINCT FROM $2',
      [m.id, categoryId]
    );
    updated += rowCount;
  }
  res.status(200).json({ evaluated: messages.length, updated });
}

export default withApi(async (req, res) => {
  const segments = req.query.segments || [];
  const user = await requireUser(req);

  if (segments.length === 0) {
    if (!methodGuard(req, res, ['GET', 'POST'])) return;
    if (req.method === 'GET') return listRules(user, req, res);
    return createRule(user, req, res);
  }

  if (segments.length === 1 && segments[0] === 'reapply') {
    return reapplyRules(user, req, res);
  }

  if (segments.length === 1) {
    return updateOrDeleteRule(user, segments[0], req, res);
  }

  throw new HttpError(404, 'Not found');
});
