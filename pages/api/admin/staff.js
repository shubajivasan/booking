import { getAdminUser } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { hashPassword } from '../../../lib/passwordHash';
import { logActivity } from '../../../lib/activityLog';

const VALID_ROLES = ['admin', 'staff'];

export default async function handler(req, res) {
  const user = await getAdminUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to manage staff.' });

  if (user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only the super admin can manage staff accounts.' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('staff_users')
      .select('id, name, email, role, created_at')
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ staff: data });
  }

  if (req.method === 'POST') {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are all required.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const finalRole = VALID_ROLES.includes(role) ? role : 'staff';

    const password_hash = hashPassword(password);
    const { data, error } = await supabaseAdmin
      .from('staff_users')
      .insert([{ name: String(name).trim(), email: String(email).trim().toLowerCase(), password_hash, role: finalRole }])
      .select('id, name, email, role, created_at');

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A staff account with that email already exists.' });
      }
      return res.status(500).json({ error: error.message });
    }

    await logActivity({
      user, action: 'create', entity_type: 'staff',
      summary: `Added staff member ${data[0].name} (${data[0].email}) with role "${finalRole}"`,
    });

    return res.status(200).json({ staff: data[0] });
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
