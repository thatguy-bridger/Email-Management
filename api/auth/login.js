import { query } from '../../lib/db.js';
import { withApi, methodGuard, HttpError } from '../../lib/http.js';
import { verifyPassword, signSession, setSessionCookie } from '../../lib/auth.js';

export default withApi(async (req, res) => {
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
  res.status(200).json({ user: { id: rows[0].id, email: rows[0].email, display_name: rows[0].display_name } });
});
