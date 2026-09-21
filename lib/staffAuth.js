// Shared by every /api/branch/* route and the branch portal itself. Uses a
// SEPARATE cookie from admin_session (lib/adminAuth.js) — branch staff and
// head-office admin are different audiences with different passwords, so
// logging into one should never grant access to the other.

export function isStaffAuthenticated(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/staff_session=([^;]+)/);
  const sessionValue = match ? match[1] : null;
  const expected = process.env.STAFF_SESSION_SECRET;
  return Boolean(expected) && sessionValue === expected;
}
