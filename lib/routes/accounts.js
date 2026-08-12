import { query } from '../db.js';
import { encrypt } from '../crypto.js';
import { testConnection, PROVIDER_PRESETS } from '../imapSync.js';
import { runAccountSync } from '../runSync.js';
import { HttpError, methodGuard } from '../http.js';
import { newId } from '../seed.js';

// Shared by api/accounts/index.js (zero-segment: list/create) and
// api/accounts/[...segments].js (test/:id/:id/sync) so both thin route
// files stay in sync without duplicating logic. Split into two files
// because Vercel's generic (non-Next.js) function routing only supports a
// *required* catch-all ([...segments].js, 1+ path segments) -- there's no
// "optional" catch-all outside Next.js's own framework-level routing, so a
// bare /api/accounts needs its own index.js.

export const PUBLIC_COLUMNS = `
  id, email, display_name, provider, imap_host, imap_port, imap_secure,
  username, color, last_synced_at, sync_status, sync_error, created_at
`;

export async function listAccounts(user, req, res) {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM accounts WHERE user_id = $1 ORDER BY created_at ASC`,
    [user.id]
  );
  res.status(200).json({ accounts: rows, providers: PROVIDER_PRESETS });
}

function resolveImapConfig(body) {
  const { provider, username, password } = body;
  let { imapHost, imapPort, imapSecure } = body;
  if (!username || !password) throw new HttpError(400, 'username and password are required');
  if (provider && provider !== 'custom' && PROVIDER_PRESETS[provider]) {
    const preset = PROVIDER_PRESETS[provider];
    imapHost = imapHost || preset.host;
    imapPort = imapPort || preset.port;
    imapSecure = imapSecure ?? preset.secure;
  }
  if (!imapHost) throw new HttpError(400, 'imapHost is required');
  return { imapHost, imapPort: imapPort || 993, imapSecure: imapSecure ?? true, username, password };
}

export async function createAccount(user, req, res) {
  const body = req.body || {};
  const { email, displayName, provider, color } = body;
  if (!email) throw new HttpError(400, 'email is required');
  const { imapHost, imapPort, imapSecure, username, password } = resolveImapConfig(body);

  const candidate = {
    imap_host: imapHost,
    imap_port: imapPort,
    imap_secure: imapSecure,
    username,
    encrypted_password: encrypt(password),
  };

  try {
    await testConnection(candidate);
  } catch (err) {
    throw new HttpError(422, `Could not connect: ${err.message}`);
  }

  const id = newId('acct');
  const { rows } = await query(
    `INSERT INTO accounts
      (id, user_id, email, display_name, provider, imap_host, imap_port, imap_secure, username, encrypted_password, color)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${PUBLIC_COLUMNS}`,
    [
      id,
      user.id,
      email,
      displayName || email,
      provider || 'custom',
      candidate.imap_host,
      candidate.imap_port,
      candidate.imap_secure,
      username,
      candidate.encrypted_password,
      color || '#6366f1',
    ]
  );
  res.status(201).json({ account: rows[0] });
}

export async function testAccount(req, res) {
  const body = req.body || {};
  try {
    const { imapHost, imapPort, imapSecure, username, password } = resolveImapConfig(body);
    await testConnection({
      imap_host: imapHost,
      imap_port: imapPort,
      imap_secure: imapSecure,
      username,
      encrypted_password: encrypt(password),
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
}

export async function updateOrDeleteAccount(user, id, req, res) {
  if (!methodGuard(req, res, ['PATCH', 'DELETE'])) return;

  if (req.method === 'DELETE') {
    const { rowCount } = await query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [id, user.id]);
    if (!rowCount) throw new HttpError(404, 'Account not found');
    return res.status(204).end();
  }

  const { displayName, color } = req.body || {};
  const { rows } = await query(
    `UPDATE accounts SET
       display_name = COALESCE($3, display_name),
       color = COALESCE($4, color)
     WHERE id = $1 AND user_id = $2
     RETURNING ${PUBLIC_COLUMNS}`,
    // node-postgres rejects `undefined` params, so omitted body fields need
    // to become null before hitting COALESCE.
    [id, user.id, displayName ?? null, color ?? null]
  );
  if (!rows.length) throw new HttpError(404, 'Account not found');
  res.status(200).json({ account: rows[0] });
}

export async function syncAccountRoute(user, id, req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  const { rows } = await query('SELECT * FROM accounts WHERE id = $1 AND user_id = $2', [id, user.id]);
  if (!rows.length) throw new HttpError(404, 'Account not found');
  const result = await runAccountSync(rows[0]);
  res.status(200).json(result);
}
