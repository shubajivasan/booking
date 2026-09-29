import { createSessionToken } from './sessionToken';

// Sets the signed admin_session cookie for a staff user (30 days).
export function setSessionCookie(res, userId) {
  const token = createSessionToken(userId);
  res.setHeader(
    'Set-Cookie',
    `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`
  );
}
