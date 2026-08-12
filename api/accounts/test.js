import { testConnection, PROVIDER_PRESETS } from '../../lib/imapSync.js';
import { encrypt } from '../../lib/crypto.js';
import { withApi, methodGuard, HttpError } from '../../lib/http.js';

// Lets the "Add Account" form verify credentials before the account (and
// its encrypted password) is ever written to the database.
export default withApi(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;
  const body = req.body || {};
  let { imapHost, imapPort, imapSecure, provider, username, password } = body;

  if (!username || !password) throw new HttpError(400, 'username and password are required');
  if (provider && provider !== 'custom' && PROVIDER_PRESETS[provider]) {
    const preset = PROVIDER_PRESETS[provider];
    imapHost = imapHost || preset.host;
    imapPort = imapPort || preset.port;
    imapSecure = imapSecure ?? preset.secure;
  }
  if (!imapHost) throw new HttpError(400, 'imapHost is required');

  try {
    // testConnection() is built to take a stored account row (it decrypts
    // the password internally), so the plaintext password from this form
    // gets encrypted just to be unwrapped a moment later in the same call.
    await testConnection({
      imap_host: imapHost,
      imap_port: imapPort || 993,
      imap_secure: imapSecure ?? true,
      username,
      encrypted_password: encrypt(password),
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
});
