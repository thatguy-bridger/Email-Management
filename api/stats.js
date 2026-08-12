import { query } from '../lib/db.js';
import { withApi, methodGuard } from '../lib/http.js';

export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['GET'])) return;

  const [unread, needsReply, flagged, byCategory, accounts, recent] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM messages WHERE seen = false AND archived = false AND trashed = false`),
    query(`SELECT COUNT(*)::int AS n FROM messages WHERE needs_reply = true AND archived = false AND trashed = false`),
    query(`SELECT COUNT(*)::int AS n FROM messages WHERE flagged = true AND archived = false AND trashed = false`),
    query(`
      SELECT c.id, c.name, c.color, c.icon,
             COUNT(m.id) FILTER (WHERE m.archived = false AND m.trashed = false)::int AS total,
             COUNT(m.id) FILTER (WHERE m.seen = false AND m.archived = false AND m.trashed = false)::int AS unread
      FROM categories c
      LEFT JOIN messages m ON m.category_id = c.id
      GROUP BY c.id ORDER BY c.sort_order ASC
    `),
    query(`SELECT id, email, display_name, color, last_synced_at, sync_status, sync_error FROM accounts ORDER BY created_at ASC`),
    query(`
      SELECT id, from_name, from_email, subject, snippet, date, seen, category_id
      FROM messages WHERE archived = false AND trashed = false
      ORDER BY date DESC LIMIT 8
    `),
  ]);

  res.status(200).json({
    unread: unread.rows[0].n,
    needsReply: needsReply.rows[0].n,
    flagged: flagged.rows[0].n,
    categories: byCategory.rows,
    accounts: accounts.rows,
    recent: recent.rows,
  });
});
