import { query } from '../lib/db.js';
import { withAuth } from '../lib/withAuth.js';
import { methodGuard } from '../lib/http.js';

export default withAuth(async (req, res) => {
  if (!methodGuard(req, res, ['GET'])) return;
  const userId = req.user.id;

  const [unread, needsReply, flagged, byCategory, accounts, recent] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS n FROM messages WHERE user_id = $1 AND seen = false AND archived = false AND trashed = false`,
      [userId]
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM messages WHERE user_id = $1 AND needs_reply = true AND archived = false AND trashed = false`,
      [userId]
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM messages WHERE user_id = $1 AND flagged = true AND archived = false AND trashed = false`,
      [userId]
    ),
    query(
      `
      SELECT c.id, c.name, c.color, c.icon,
             COUNT(m.id) FILTER (WHERE m.archived = false AND m.trashed = false)::int AS total,
             COUNT(m.id) FILTER (WHERE m.seen = false AND m.archived = false AND m.trashed = false)::int AS unread
      FROM categories c
      LEFT JOIN messages m ON m.category_id = c.id
      WHERE c.user_id = $1
      GROUP BY c.id ORDER BY c.sort_order ASC
    `,
      [userId]
    ),
    query(
      `SELECT a.id, a.email, a.display_name, a.color, a.last_synced_at, a.sync_status, a.sync_error,
              a.backfill_complete, a.backfill_total_estimate,
              COALESCE(mc.count, 0)::int AS messages_synced
       FROM accounts a
       LEFT JOIN (SELECT account_id, COUNT(*) AS count FROM messages GROUP BY account_id) mc
         ON mc.account_id = a.id
       WHERE a.user_id = $1
       ORDER BY a.created_at ASC`,
      [userId]
    ),
    query(
      `
      SELECT id, from_name, from_email, subject, snippet, date, seen, category_id
      FROM messages WHERE user_id = $1 AND archived = false AND trashed = false
      ORDER BY date DESC LIMIT 8
    `,
      [userId]
    ),
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
