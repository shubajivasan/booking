import { getAdminUser } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { hashPassword } from '../../../lib/passwordHash';
import { logActivity } from '../../../lib/activityLog';

const VALID_ROLES = ['admin', 'staff', 'teacher'];

// Teacher accounts list the teacher name(s) they cover, as in the schedule.
function cleanNames(v) {
  return [...new Set((Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(Boolean))].slice(0, 20);
}
// Login IDs: 3–30 characters, letters, numbers, dot, dash, underscore.
// Saved in lowercase; signing in isn't case sensitive.
const LOGIN_ID_RE = /^[a-z0-9._-]{3,30}$/;
function cleanLoginId(v) {
  const id = String(v ?? '').trim().toLowerCase();
  return id;
}
const SETUP_MSG = 'Teacher accounts aren\u2019t set up yet. Run migration-teacher-accounts.sql in Supabase first.';

export default async function handler(req, res) {
  const user = await getAdminUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to manage staff.' });

  if (user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only the super admin can manage staff accounts.' });
  }

  if (req.method === 'GET') {
    let { data, error } = await supabaseAdmin
      .from('staff_users')
      .select('id, name, email, login_id, role, teacher_names, created_at')
      .order('created_at', { ascending: true });
    if (error && /teacher_names/.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin.from('staff_users').select('id, name, email, role, created_at').order('created_at', { ascending: true }));
    }
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ staff: data });
  }

  if (req.method === 'POST') {
    const { name, password, role } = req.body || {};
    const email = String(req.body?.email || '').trim().toLowerCase();
    const login_id = cleanLoginId(req.body?.login_id);
    if (login_id && !LOGIN_ID_RE.test(login_id)) {
      return res.status(400).json({ error: 'Login ID: 3\u201330 letters or numbers (dots, dashes and underscores allowed), no spaces.' });
    }
    if (login_id && !password) {
      return res.status(400).json({ error: 'Set a password for this login ID.' });
    }
    const teacher_names = cleanNames(req.body?.teacher_names);
    if (role === 'teacher' && teacher_names.length === 0) {
      return res.status(400).json({ error: 'Pick the teacher name(s) this account should see.' });
    }
    if (!name || (!email && !login_id)) {
      return res.status(400).json({ error: 'Give a name, and an email or a login ID.' });
    }
    // Password is optional: without one, the person signs in with Google.
    if (password && String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters (or leave it blank for Google sign-in only).' });
    }
    const finalRole = VALID_ROLES.includes(role) ? role : 'staff';

    const password_hash = password ? hashPassword(password) : null;
    const { data, error } = await supabaseAdmin
      .from('staff_users')
      .insert([{
        name: String(name).trim(), email: email || null, password_hash, role: finalRole,
        ...(login_id ? { login_id } : {}),
        ...(finalRole === 'teacher' ? { teacher_names } : {}),
      }])
      .select('id, name, email, role, created_at');

    if (error) {
      if (/teacher_names|login_id|staff_users_role_check|violates check constraint|null value in column "email"/.test(error.message || '')) {
        if (error.code === '23505') return res.status(409).json({ error: 'That login ID is already taken. Pick another.' });
        return res.status(500).json({ error: SETUP_MSG });
      }
      if (error.code === '23505') {
        return res.status(409).json({ error: /login_id/.test(error.message || '') ? 'That login ID is already taken. Pick another.' : 'A staff account with that email already exists.' });
      }
      return res.status(500).json({ error: error.message });
    }

    await logActivity({
      user, action: 'create', entity_type: 'staff',
      summary: `Added staff member ${data[0].name} (${data[0].email || `login ID ${login_id}`}) with role "${finalRole}"${finalRole === 'teacher' ? ` for ${teacher_names.join(', ')}` : ''}`,
    });

    return res.status(200).json({ staff: data[0] });
  }

  // Change someone's access level, and a teacher's names.
  if (req.method === 'PATCH') {
    const { id, role } = req.body || {};
    if (!id || !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Pick a person and a valid access level.' });
    if (id === user.id) return res.status(400).json({ error: 'You can\u2019t change your own access level.' });
    const { data: existing } = await supabaseAdmin.from('staff_users').select('id, name, email, role').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'That account no longer exists.' });
    if (existing.role === 'super_admin') return res.status(400).json({ error: 'The super admin\u2019s access can\u2019t be changed here.' });
    const teacher_names = cleanNames(req.body.teacher_names);
    if (role === 'teacher' && teacher_names.length === 0) return res.status(400).json({ error: 'Pick the teacher name(s) this account should see.' });
    const update = { role, teacher_names: role === 'teacher' ? teacher_names : null };
    // Optional: set or change the login ID, and set a new password.
    if (req.body.login_id !== undefined) {
      const login_id = cleanLoginId(req.body.login_id);
      if (login_id && !LOGIN_ID_RE.test(login_id)) return res.status(400).json({ error: 'Login ID: 3\u201330 letters or numbers (dots, dashes and underscores allowed), no spaces.' });
      update.login_id = login_id || null;
    }
    if (req.body.new_password) {
      if (String(req.body.new_password).length < 8) return res.status(400).json({ error: 'The new password must be at least 8 characters.' });
      update.password_hash = hashPassword(String(req.body.new_password));
    }
    const { error } = await supabaseAdmin.from('staff_users').update(update).eq('id', id);
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That login ID is already taken. Pick another.' });
      if (/teacher_names|login_id|staff_users_role_check|violates check constraint/.test(error.message || '')) return res.status(500).json({ error: SETUP_MSG });
      return res.status(500).json({ error: error.message });
    }
    await logActivity({
      user, action: 'update', entity_type: 'staff',
      summary: `Changed ${existing.name} (${existing.email || 'no email'}) to "${role}"${role === 'teacher' ? ` for ${teacher_names.join(', ')}` : ''}${update.login_id !== undefined ? `; login ID ${update.login_id || 'removed'}` : ''}${update.password_hash ? '; password reset' : ''}`,
    });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required.' });

    if (id === user.id) {
      return res.status(400).json({ error: "You can't remove your own account while logged in as it." });
    }

    const { data: existing } = await supabaseAdmin.from('staff_users').select('name, email').eq('id', id).maybeSingle();

    const { error } = await supabaseAdmin.from('staff_users').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    if (existing) {
      await logActivity({
        user, action: 'delete', entity_type: 'staff',
        summary: `Removed staff member ${existing.name} (${existing.email})`,
      });
    }

    return res.status(200).json({ ok: true });
  }

  res.status(405).end();
}
