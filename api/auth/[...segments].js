import { query } from '../../lib/db.js';
import { withApi, methodGuard, HttpError } from '../../lib/http.js';
import { hashPassword, verifyPassword, signSession, setSessionCookie, clearSessionCookie } from '../../lib/auth.js';
import { requireUser } from '../../lib/withAuth.js';
import { seedDefaultCategoriesForUser, newId } from '../../lib/seed.js';

// Consolidates signup/login/logout/me/password/delete into one function --
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and one
// file per route blew well past that. A catch-all dynamic route
// ([...segments].js -- the required form; Vercel's generic function routing
// doesn't support Next.js's optional [[...segments]].js outside Next.js
// itself) keeps the URLs identical (/api/auth/login etc. still work exactly
// as before) while collapsing them into a single function that dispatches
// on the sub-path itself. Every action here always has at least one
// sub-path segment, so the required form is sufficient -- unlike
// accounts/categories/rules/messages, auth needs no separate index.js.

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

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
      'SELECT id, email, display_name, password_hash, failed_login_count, locked_until FROM users WHERE email = $1',
      [normalizedEmail]
    );
    const user = rows[0];

    // Locked accounts are rejected before the password is even checked, so
    // a guessed-correct password during a lockout window still doesn't get
    // in -- the lock is time-based, not attempt-based-and-then-forgotten.
    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.max(1, Math.ceil((new Date(user.locked_until) - new Date()) / 60000));
      throw new HttpError(429, `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`);
    }

    const valid = user && verifyPassword(password, user.password_hash);
    if (!valid) {
      // Only tracked when the email genuinely exists -- counting failures
      // against emails that aren't registered would let an attacker use
      // lockout timing to enumerate accounts.
      if (user) {
        const nextCount = user.failed_login_count + 1;
        if (nextCount >= MAX_FAILED_ATTEMPTS) {
          await query(
            `UPDATE users SET failed_login_count = $2, locked_until = now() + make_interval(mins => $3) WHERE id = $1`,
            [user.id, nextCount, LOCKOUT_MINUTES]
          );
          throw new HttpError(429, `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`);
        }
        await query('UPDATE users SET failed_login_count = $2 WHERE id = $1', [user.id, nextCount]);
      }
      throw new HttpError(401, 'Incorrect email or password');
    }

    await query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);
    setSessionCookie(res, signSession(user.id));
    return res.status(200).json({ user: { id: user.id, email: user.email, display_name: user.display_name } });
  }

  if (action === 'logout') {
    if (!methodGuard(req, res, ['POST'])) return;
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (action === 'me') {
    if (!methodGuard(req, res, ['GET', 'DELETE'])) return;

    if (req.method === 'GET') {
      const user = await requireUser(req);
      return res.status(200).json({ user });
    }

    // DELETE: closes the account for good. Requires the current password
    // as confirmation -- an open session cookie alone (e.g. a device left
    // logged in) shouldn't be enough to destroy the account. Everything
    // else (mail accounts, messages, categories, rules) cascades via the
    // users.id foreign keys already in the schema.
    const user = await requireUser(req);
    const { password } = req.body || {};
    if (!password) throw new HttpError(400, 'password is required to delete your account');
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
      throw new HttpError(401, 'Incorrect password');
    }
    await query('DELETE FROM users WHERE id = $1', [user.id]);
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (action === 'password') {
    if (!methodGuard(req, res, ['POST'])) return;
    const user = await requireUser(req);
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      throw new HttpError(400, 'currentPassword and newPassword are required');
    }
    if (newPassword.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!verifyPassword(currentPassword, rows[0].password_hash)) {
      throw new HttpError(401, 'Current password is incorrect');
    }
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hashPassword(newPassword)]);
    return res.status(200).json({ ok: true });
  }

  throw new HttpError(404, 'Not found');
});
