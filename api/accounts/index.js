import { query } from '../../lib/db.js';
import { encrypt } from '../../lib/crypto.js';
import { testConnection, PROVIDER_PRESETS } from '../../lib/imapSync.js';
import { withAuth } from '../../lib/withAuth.js';
import { methodGuard, HttpError } from '../../lib/http.js';
import { newId } from '../../lib/seed.js';

const PUBLIC_COLUMNS = `
  id, email, display_name, provider, imap_host, imap_port, imap_secure,
  username, color, last_synced_at, sync_status, sync_error, created_at
`;

async function listAccounts(req, res) {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM accounts WHERE user_id = $1 ORDER BY created_at ASC`,
    [req.user.id]
  );
  res.status(200).json({ accounts: rows, providers: PROVIDER_PRESETS });
}

async function createAccount(req, res) {
  const body = req.body || {};
  const { email, displayName, provider, username, password, color } = body;
  let { imapHost, imapPort, imapSecure } = body;

  if (!email || !username || !password) {
    throw new HttpError(400, 'email, username, and password are required');
  }

  if (provider && provider !== 'custom' && PROVIDER_PRESETS[provider]) {
    const preset = PROVIDER_PRESETS[provider];
    imapHost = imapHost || preset.host;
    imapPort = imapPort || preset.port;
    imapSecure = imapSecure ?? preset.secure;
  }
  if (!imapHost) throw new HttpError(400, 'imapHost is required for a custom provider');

  const candidate = {
    imap_host: imapHost,
    imap_port: imapPort || 993,
    imap_secure: imapSecure ?? true,
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
      req.user.id,
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

export default withAuth(async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  if (req.method === 'GET') return listAccounts(req, res);
  return createAccount(req, res);
});
