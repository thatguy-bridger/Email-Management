import crypto from 'crypto';

// IMAP passwords are the one genuinely sensitive thing this app stores, so
// they're kept encrypted at rest (AES-256-GCM) rather than as plaintext --
// the DB is a plain Postgres table, not a secrets manager. The key never
// touches the database; it only lives in the ENCRYPTION_KEY env var.
function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add it to your Vercel project env vars.'
    );
  }
  const key = raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (a 64-char hex string, or base64).');
  }
  return key;
}

export function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decrypt(payload) {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
}
