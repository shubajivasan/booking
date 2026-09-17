// Shared by every /api/admin/* route. Checks the same cookie that
// pages/admin/index.js checks, so write actions require the same login as
// viewing the dashboard.

export function isAdminAuthenticated(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  const sessionValue = match ? match[1] : null;
  const expected = process.env.ADMIN_SESSION_SECRET;
  return Boolean(expected) && sessionValue === expected;
}
