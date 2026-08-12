import { query } from '../../lib/db.js';
import { categorize } from '../../lib/ruleEngine.js';
import { withApi, methodGuard } from '../../lib/http.js';

// Editing a rule only affects new mail unless you also re-run it against
// history -- this button (and endpoint) does that. Messages a user
// hand-assigned a category to (category_locked) are left alone.
export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;

  const { rows: ruleRows } = await query(
    'SELECT * FROM rules WHERE enabled = true ORDER BY priority DESC, created_at ASC'
  );
  const { rows: messages } = await query(
    'SELECT id, from_name, from_email, to_json, subject, body_text FROM messages WHERE category_locked = false'
  );

  let updated = 0;
  for (const m of messages) {
    const categoryId = categorize(m, ruleRows) || 'cat-primary';
    const { rowCount } = await query(
      'UPDATE messages SET category_id = $2 WHERE id = $1 AND category_id IS DISTINCT FROM $2',
      [m.id, categoryId]
    );
    updated += rowCount;
  }
  res.status(200).json({ evaluated: messages.length, updated });
});
