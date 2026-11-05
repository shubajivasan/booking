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
  let { data, error } = await supabaseAdmin
    .from('staff_users')
    .select('id, name, email, role, teacher_names')
    .eq('id', userId)
    .maybeSingle();
  if (error && /teacher_names/.test(error.message || '')) {
    // Teacher accounts not set up yet (migration-teacher-accounts.sql not run).
    ({ data, error } = await supabaseAdmin
      .from('staff_users').select('id, name, email, role').eq('id', userId).maybeSingle());
  }
  if (error || !data) return null;
  return { ...data, teacher_names: Array.isArray(data.teacher_names) ? data.teacher_names : [] };
}

// Roles: super_admin, admin, staff, teacher.
//   admin / super_admin  manage everything
//   staff                see everything; changes go to an admin for approval
//   teacher              see only their own classes; can ask to rename a batch
export function isAdmin(user) {
  return Boolean(user) && (user.role === 'admin' || user.role === 'super_admin');
}
export function isTeacher(user) {
  return Boolean(user) && user.role === 'teacher';
}

// Teacher names are matched loosely: case, spaces and dots don't matter.
export function normTeacher(name) {
  return String(name || '').toLowerCase().replace(/[.\s]+/g, ' ').trim();
}
// Does this class belong to the signed-in teacher?
export function teachesBlock(user, block) {
  if (!isTeacher(user) || !block) return false;
  const mine = new Set((user.teacher_names || []).map(normTeacher).filter(Boolean));
  return mine.has(normTeacher(block.teacher));
}
