import { query } from './db.js';
import { withApi, HttpError } from './http.js';
import { getSessionUserId } from './auth.js';

// Resolves the session cookie to a real user row, or throws 401. Exported
// standalone (not just via withAuth below) so catch-all route dispatchers
// -- which branch on sub-path within a single handler to stay under
// Vercel's Hobby-plan function-count limit -- can call it once per request
// rather than needing a separate wrapped handler per branch.
export async function requireUser(req) {
  const userId = getSessionUserId(req);
  if (!userId) throw new HttpError(401, 'Not signed in');
  const { rows } = await query('SELECT id, email, display_name FROM users WHERE id = $1', [userId]);
  if (!rows.length) throw new HttpError(401, 'Not signed in');
  return rows[0];
}

// For single-route handlers: same behavior as requireUser, wired up as a
// wrapper so the handler just reads req.user.
export function withAuth(handler) {
  return withApi(async (req, res) => {
    req.user = await requireUser(req);
    await handler(req, res);
  });
}
