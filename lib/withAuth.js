import { query } from './db.js';
import { withApi, HttpError } from './http.js';
import { getSessionUserId } from './auth.js';

// Every data route (accounts, messages, categories, rules, stats) needs the
// same thing on top of withApi: a valid session, resolved to a real user
// row, attached as req.user so the handler can scope its queries.
export function withAuth(handler) {
  return withApi(async (req, res) => {
    const userId = getSessionUserId(req);
    if (!userId) throw new HttpError(401, 'Not signed in');
    const { rows } = await query('SELECT id, email, display_name FROM users WHERE id = $1', [userId]);
    if (!rows.length) throw new HttpError(401, 'Not signed in');
    req.user = rows[0];
    await handler(req, res);
  });
}
