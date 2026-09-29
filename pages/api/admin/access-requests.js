import { getAdminUser } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { logActivity } from '../../../lib/activityLog';
import { sendStudentConfirmation } from '../../../lib/sendAdminNotification';
import { esc } from '../../../lib/bookingEmails';

// Staff access requests from Google sign-in. Super admin only.
//   GET                                      → pending requests
//   POST { id, action: 'approve', role }     → create the staff account (role 'staff' or 'admin')
//   POST { id, action: 'reject' }            → decline
const VALID_ROLES = ['admin', 'staff'];

export default async function handler(req, res) {
  const user = await getAdminUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });
  if (user.role !== 'super_admin') return res.status(403).json({ error: 'Only the super admin can review access requests.' });

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('staff_access_requests').select('*').eq('status', 'pending').order('requested_at', { ascending: true });
    if (error) {
      if (error.code === '42P01') return res.status(200).json({ requests: [], missingTable: true });
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ requests: data });
  }

  if (req.method === 'POST') {
    const { id, action } = req.body || {};
    if (!id || !['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'id and action are required.' });

    const { data: request } = await supabaseAdmin.from('staff_access_requests').select('*').eq('id', id).maybeSingle();
    if (!request || request.status !== 'pending') {
      return res.status(409).json({ error: 'This request has already been handled. Refresh to see the latest.' });
    }
    const loginUrl = `https://${req.headers.host}/admin/login`;

    if (action === 'approve') {
      const role = VALID_ROLES.includes(req.body.role) ? req.body.role : 'staff';
      const { error: insertError } = await supabaseAdmin
        .from('staff_users')
        .insert([{ name: request.name || request.email, email: request.email, role, password_hash: null }]);
      if (insertError && insertError.code !== '23505') return res.status(500).json({ error: insertError.message });

      await supabaseAdmin.from('staff_access_requests')
        .update({ status: 'approved', decided_by: user.name, decided_at: new Date().toISOString(), role_granted: role })
        .eq('id', id);

      await sendStudentConfirmation({
        to: request.email,
        subject: 'You now have access to the Ajivasan schedule dashboard',
        html: `
          <p>Hi ${esc(request.name || '')},</p>
          <p>Your access to the Ajivasan schedule dashboard has been approved (${role === 'admin' ? 'Admin' : 'Staff'}).</p>
          <p><a href="${loginUrl}">Sign in with Google here</a> using ${esc(request.email)}.</p>
        `,
      });
      await logActivity({
        user, action: 'create', entity_type: 'staff',
        summary: `Approved dashboard access for ${request.name || request.email} (${request.email}) as "${role}"`,
      });
      return res.status(200).json({ ok: true });
    }

    await supabaseAdmin.from('staff_access_requests')
      .update({ status: 'rejected', decided_by: user.name, decided_at: new Date().toISOString() })
      .eq('id', id);
    await sendStudentConfirmation({
      to: request.email,
      subject: 'Your Ajivasan dashboard access request',
      html: `<p>Hi ${esc(request.name || '')},</p><p>Your request for access to the Ajivasan schedule dashboard wasn’t approved. If you think this is a mistake, please speak to the academy office.</p>`,
    });
    await logActivity({
      user, action: 'delete', entity_type: 'staff',
      summary: `Declined dashboard access request from ${request.name || request.email} (${request.email})`,
    });
    return res.status(200).json({ ok: true });
  }

  res.status(405).end();
}
