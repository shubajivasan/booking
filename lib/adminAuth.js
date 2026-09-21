// Shared by every /api/admin/* route and pages/admin/index.js. Reads the
// admin_session cookie, verifies it's a genuine, unexpired token signed by
// this server (see lib/sessionToken.js), and returns which staff user it
// belongs to — or null if there's no valid session.

import { verifySessionToken } from './sessionToken';

export function getAdminUserId(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  const token = match ? decodeURIComponent(match[1]) : null;
  return verifySessionToken(token);
}

export function isAdminAuthenticated(req) {
  return Boolean(getAdminUserId(req));
}
