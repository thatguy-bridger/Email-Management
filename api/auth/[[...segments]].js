import { query } from '../../lib/db.js';
import { withApi, methodGuard, HttpError } from '../../lib/http.js';
import { hashPassword, verifyPassword, signSession, setSessionCookie, clearSessionCookie } from '../../lib/auth.js';
import { requireUser } from '../../lib/withAuth.js';
import { seedDefaultCategoriesForUser, newId } from '../../lib/seed.js';

// Consolidates signup/login/logout/me into one function -- Vercel's Hobby
// plan caps a deployment at 12 Serverless Functions, and one file per route
// blew well past that (17 routes). A catch-all dynamic route
// ([[...segments]].js) keeps the URLs identical (/api/auth/login etc. still
// work exactly as before) while collapsing them into a single function that
// dispatches on the sub-path itself.
export default withApi(async (req, res) => {
  const [action] = req.query.segments || [];

  if (action === 'signup') {
    if (!methodGuard(req, res, ['POST'])) return;
    const { email, password, displayName } = req.body || {};
    if (!email || !password) throw new HttpError(400, 'email and password are required');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');

    const normalizedEmail = String(email).trim().toLowerCase();
    const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.length) throw new HttpError(409, 'An account with that email already exists');

    const id = newId('user');
    const { rows } = await query(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ($1,$2,$3,$4) RETURNING id, email, display_name`,
      [id, normalizedEmail, hashPassword(password), displayName || null]
    );
    await seedDefaultCategoriesForUser(id);

    setSessionCookie(res, signSession(id));
    return res.status(201).json({ user: rows[0] });
  }

  if (action === 'login') {
    if (!methodGuard(req, res, ['POST'])) return;
    const { email, password } = req.body || {};
    if (!email || !password) throw new HttpError(400, 'email and password are required');

    const normalizedEmail = String(email).trim().toLowerCase();
    const { rows } = await query(
      'SELECT id, email, display_name, password_hash FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
      throw new HttpError(401, 'Incorrect email or password');
    }

    setSessionCookie(res, signSession(rows[0].id));
    return res.status(200).json({ user: { id: rows[0].id, email: rows[0].email, display_name: rows[0].display_name } });
  }

  if (action === 'logout') {
    if (!methodGuard(req, res, ['POST'])) return;
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (action === 'me') {
    if (!methodGuard(req, res, ['GET'])) return;
    const user = await requireUser(req);
    return res.status(200).json({ user });
  }

  throw new HttpError(404, 'Not found');
});
