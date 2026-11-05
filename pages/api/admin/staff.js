import { getAdminUser } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { hashPassword } from '../../../lib/passwordHash';
import { logActivity } from '../../../lib/activityLog';

const VALID_ROLES = ['admin', 'staff', 'teacher'];

// Teacher accounts list the teacher name(s) they cover, as in the schedule.
function cleanNames(v) {
  return [...new Set((Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(Boolean))].slice(0, 20);
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
      .select('id, name, email, role, teacher_names, created_at')
      .order('created_at', { ascending: true });
    if (error && /teacher_names/.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin.from('staff_users').select('id, name, email, role, created_at').order('created_at', { ascending: true }));
    }
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ staff: data });
  }

  if (req.method === 'POST') {
    const { name, email, password, role } = req.body || {};
    const teacher_names = cleanNames(req.body?.teacher_names);
    if (role === 'teacher' && teacher_names.length === 0) {
      return res.status(400).json({ error: 'Pick the teacher name(s) this account should see.' });
    }
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
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
        name: String(name).trim(), email: String(email).trim().toLowerCase(), password_hash, role: finalRole,
        ...(finalRole === 'teacher' ? { teacher_names } : {}),
      }])
      .select('id, name, email, role, created_at');

    if (error) {
      if (/teacher_names|staff_users_role_check|violates check constraint/.test(error.message || '')) {
        return res.status(500).json({ error: SETUP_MSG });
      }
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A staff account with that email already exists.' });
      }
      return res.status(500).json({ error: error.message });
    }

    await logActivity({
      user, action: 'create', entity_type: 'staff',
      summary: `Added staff member ${data[0].name} (${data[0].email}) with role "${finalRole}"${finalRole === 'teacher' ? ` for ${teacher_names.join(', ')}` : ''}`,
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
    const { error } = await supabaseAdmin.from('staff_users')
      .update({ role, teacher_names: role === 'teacher' ? teacher_names : null }).eq('id', id);
    if (error) {
      if (/teacher_names|staff_users_role_check|violates check constraint/.test(error.message || '')) return res.status(500).json({ error: SETUP_MSG });
      return res.status(500).json({ error: error.message });
    }
    await logActivity({
      user, action: 'update', entity_type: 'staff',
      summary: `Changed ${existing.name} (${existing.email}) to "${role}"${role === 'teacher' ? ` for ${teacher_names.join(', ')}` : ''}`,
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
