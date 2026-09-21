import crypto from 'crypto';

// Replaces the old "cookie value === one shared secret" check. Now the
// cookie carries WHICH staff member is logged in, cryptographically signed
// so it can't be forged or edited — a visitor can't just change the user
// id in their cookie to impersonate someone else, since the signature
// would no longer match.

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function createSessionToken(userId) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const expires = Date.now() + THIRTY_DAYS_MS;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!token || !secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expires, sig] = parts;
  const payload = `${userId}.${expires}`;
  const expectedSig = sign(payload, secret);

  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  if (Date.now() > Number(expires)) return null;

  return userId;
}
