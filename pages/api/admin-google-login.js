import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { verifyGoogleCredential } from '../../lib/googleAuth';
import { setSessionCookie } from '../../lib/sessionCookie';
import { sendStudentConfirmation } from '../../lib/sendAdminNotification';
import { esc } from '../../lib/bookingEmails';

// "Sign in with Google" for staff.
// POST { credential }                 → sign in if this email is a staff account
// POST { credential, request: true }  → not staff yet: ask the super admin for access
// Responds with { status }:
//   'ok'         signed in (cookie set)
//   'no_access'  not a staff member and no request yet
//   'pending'    request sent, waiting for the super admin
//   'rejected'   an earlier request was declined (they can ask again)
//   'requested'  request just sent
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let google;
  try {
    google = await verifyGoogleCredential(req.body?.credential);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
  const { email, name } = google;

  const { data: user, error } = await supabaseAdmin
    .from('staff_users').select('id, name').eq('email', email).maybeSingle();
  if (error) return res.status(500).json({ error: 'Something went wrong. Please try again.' });

  if (user) {
    setSessionCookie(res, user.id);
    return res.status(200).json({ status: 'ok', name: user.name });
  }

  const { data: existing } = await supabaseAdmin
    .from('staff_access_requests').select('*').eq('email', email).maybeSingle();

  if (!req.body?.request) {
    return res.status(200).json({
      status: existing ? (existing.status === 'approved' ? 'no_access' : existing.status) : 'no_access',
      email, name,
    });
  }

  if (existing && existing.status === 'pending') {
    return res.status(200).json({ status: 'pending', email, name });
  }

  const { error: upsertError } = await supabaseAdmin
    .from('staff_access_requests')
    .upsert([{
      email, name, status: 'pending', requested_at: new Date().toISOString(),
      decided_by: null, decided_at: null, role_granted: null,
    }], { onConflict: 'email' });
  if (upsertError) {
    if (upsertError.code === '42P01') {
      return res.status(500).json({ error: 'Access requests aren’t set up yet. Ask the admin to run migration-google-login.sql.' });
    }
    return res.status(500).json({ error: 'Could not send your request. Please try again.' });
  }

  // Tell every super admin.
  const { data: supers } = await supabaseAdmin.from('staff_users').select('email').eq('role', 'super_admin');
  const to = (supers || []).map(s => s.email).filter(Boolean).join(',');
  if (to) {
    const adminUrl = `https://${req.headers.host}/admin`;
    await sendStudentConfirmation({
      to,
      subject: `Dashboard access request: ${name}`,
      html: `
        <h2>New access request</h2>
        <p><b>${esc(name)}</b> (${esc(email)}) signed in with Google and is asking for access to the schedule dashboard.</p>
        <p><a href="${adminUrl}">Open the dashboard → Staff tab</a> to approve (as Staff or Admin) or reject.</p>
      `,
    });
  }

  return res.status(200).json({ status: 'requested', email, name });
}
