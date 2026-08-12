import { query } from '../../lib/db.js';
import { encrypt } from '../../lib/crypto.js';
import { testConnection, PROVIDER_PRESETS } from '../../lib/imapSync.js';
import { runAccountSync } from '../../lib/runSync.js';
import { withApi, methodGuard, HttpError } from '../../lib/http.js';
import { requireUser } from '../../lib/withAuth.js';
import { newId } from '../../lib/seed.js';

// Consolidates list/create/test/update/delete/sync into one function -- see
// api/auth/[[...segments]].js for why (Vercel Hobby plan's 12-function cap).
// URLs are unchanged: /api/accounts, /api/accounts/test, /api/accounts/:id,
// /api/accounts/:id/sync all still resolve exactly as before.

const PUBLIC_COLUMNS = `
  id, email, display_name, provider, imap_host, imap_port, imap_secure,
  username, color, last_synced_at, sync_status, sync_error, created_at
`;

async function listAccounts(user, req, res) {
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

async function createAccount(user, req, res) {
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

async function testAccount(req, res) {
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

async function updateOrDeleteAccount(user, id, req, res) {
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

async function syncAccountRoute(user, id, req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  const { rows } = await query('SELECT * FROM accounts WHERE id = $1 AND user_id = $2', [id, user.id]);
  if (!rows.length) throw new HttpError(404, 'Account not found');
  const result = await runAccountSync(rows[0]);
  res.status(200).json(result);
}

export default withApi(async (req, res) => {
  const segments = req.query.segments || [];

  // /api/accounts/test needs auth but no specific account row.
  if (segments.length === 1 && segments[0] === 'test') {
    await requireUser(req);
    if (!methodGuard(req, res, ['POST'])) return;
    return testAccount(req, res);
  }

  const user = await requireUser(req);

  if (segments.length === 0) {
    if (!methodGuard(req, res, ['GET', 'POST'])) return;
    if (req.method === 'GET') return listAccounts(user, req, res);
    return createAccount(user, req, res);
  }

  if (segments.length === 1) {
    return updateOrDeleteAccount(user, segments[0], req, res);
  }

  if (segments.length === 2 && segments[1] === 'sync') {
    return syncAccountRoute(user, segments[0], req, res);
  }

  throw new HttpError(404, 'Not found');
});
