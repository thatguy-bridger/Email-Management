import { query } from '../../lib/db.js';
import { categorize } from '../../lib/ruleEngine.js';
import { withAuth } from '../../lib/withAuth.js';
import { methodGuard } from '../../lib/http.js';

// Editing a rule only affects new mail unless you also re-run it against
// history -- this button (and endpoint) does that. Messages a user
// hand-assigned a category to (category_locked) are left alone.
export default withAuth(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;

  const [{ rows: ruleRows }, { rows: messages }, { rows: primaryRows }] = await Promise.all([
    query('SELECT * FROM rules WHERE user_id = $1 AND enabled = true ORDER BY priority DESC, created_at ASC', [
      req.user.id,
    ]),
    query(
      'SELECT id, from_name, from_email, to_json, subject, body_text FROM messages WHERE user_id = $1 AND category_locked = false',
      [req.user.id]
    ),
    query('SELECT id FROM categories WHERE user_id = $1 AND is_builtin = true LIMIT 1', [req.user.id]),
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
});
