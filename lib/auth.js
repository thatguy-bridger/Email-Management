import crypto from 'crypto';

const COOKIE_NAME = 'mail_session';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// scrypt (built into Node) rather than bcryptjs -- it's the standard
// password-hashing choice here specifically because it needs no native
// addon and no extra dependency, which matters for a serverless deploy.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const candidate = crypto.scryptSync(password, salt, 64);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'AUTH_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to your Vercel project env vars.'
    );
  }
  return secret;
}

// A signed `userId.expiry.signature` token rather than a JWT library --
// there's exactly one claim (who), so a full JWT implementation would just
// be more surface area for the same guarantee: nobody can forge or extend
// a session without AUTH_SECRET, and it self-expires.
export function signSession(userId) {
  const expires = Date.now() + TOKEN_TTL_SECONDS * 1000;
  const payload = `${userId}.${expires}`;
  const sig = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [userId, expiresStr, sig] = parts;
  const expected = crypto.createHmac('sha256', getAuthSecret()).update(`${userId}.${expiresStr}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  if (Date.now() > Number(expiresStr)) return null;
  return userId;
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getSessionUserId(req) {
  return verifySession(parseCookies(req)[COOKIE_NAME]);
}

export function setSessionCookie(res, token) {
  // Secure is dropped outside production so `vercel dev` over plain http
  // (no TLS) can still set/read the cookie; every real deployment is https.
  const secure = process.env.NODE_ENV === 'production' ? 'Secure; ' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL_SECONDS}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
