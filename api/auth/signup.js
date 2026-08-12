import { query } from '../../lib/db.js';
import { withApi, methodGuard, HttpError } from '../../lib/http.js';
import { hashPassword, signSession, setSessionCookie } from '../../lib/auth.js';
import { seedDefaultCategoriesForUser, newId } from '../../lib/seed.js';

export default withApi(async (req, res) => {
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
  res.status(201).json({ user: rows[0] });
});
