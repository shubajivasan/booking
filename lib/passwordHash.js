import crypto from 'crypto';

// Uses Node's built-in scrypt (a slow, salted hash designed for passwords)
// rather than a plain equality check or a fast hash like SHA-256 — this
// means even if the staff_users table were ever exposed, the actual
// passwords can't be recovered from it directly.

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hashBuffer = Buffer.from(hash, 'hex');
  const testHash = crypto.scryptSync(password, salt, 64);
  if (hashBuffer.length !== testHash.length) return false;
  return crypto.timingSafeEqual(hashBuffer, testHash);
}
