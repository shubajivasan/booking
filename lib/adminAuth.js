// Shared by every /api/admin/* route and pages/admin/index.js.

import { verifySessionToken } from './sessionToken';
import { supabaseAdmin } from './supabaseAdmin';

export function getAdminUserId(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  const token = match ? decodeURIComponent(match[1]) : null;
  return verifySessionToken(token);
}

export function isAdminAuthenticated(req) {
  return Boolean(getAdminUserId(req));
}

// Looks up the logged-in user's full record (including role) from the
// database. Used wherever a route needs to know not just "is someone
// logged in" but "what are THEY specifically allowed to do" — the role is
// always read fresh from the database on every request, not cached in the
// cookie, so revoking or changing someone's access takes effect
// immediately without them needing to log out and back in.
export async function getAdminUser(req) {
  const userId = getAdminUserId(req);
  if (!userId) return null;
  const { data, error } = await supabaseAdmin
    .from('staff_users')
    .select('id, name, email, role')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}
