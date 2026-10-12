import { getAdminUser } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { logActivity } from '../../../lib/activityLog';
import { sendStudentConfirmation } from '../../../lib/sendAdminNotification';
import { esc } from '../../../lib/bookingEmails';
import { ENDPOINTS } from '../../../lib/changeRequests';
import blocksHandler from './blocks';
import bookingsHandler from './bookings';
import exceptionsHandler from './class-exceptions';

// Staff change requests (see lib/changeRequests.js).
//   GET                                   → { pending, recent } (admins)
//                                            { pending, mine }   (staff)
//   POST { id, action: 'approve', force? } → runs the requested change as the
//          approving admin; a clash warning comes back as 409 with its code,
//          and approving again with force=true goes ahead.
//   POST { id, action: 'reject', reason? }
//   POST { id, action: 'withdraw' }        → staff cancel their own request

const HANDLERS = { blocks: blocksHandler, bookings: bookingsHandler, 'class-exceptions': exceptionsHandler };

// Runs an API handler in-process, as the signed-in admin making this request.
function replay(handler, req, method, body) {
  return new Promise(resolve => {
    const fakeRes = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(j) { resolve({ status: this.statusCode, body: j }); return this; },
      send(t) { resolve({ status: this.statusCode, body: { message: t } }); return this; },
      end() { resolve({ status: this.statusCode, body: {} }); return this; },
      setHeader() { return this; },
    };
    Promise.resolve(handler({ method, body, query: {}, headers: req.headers, cookies: req.cookies }, fakeRes))
      .catch(err => resolve({ status: 500, body: { error: err.message } }));
  });
}

async function notifyStaff(row, approved, decidedBy, reason) {
  if (!row.requested_by_email) return;
  try {
    await sendStudentConfirmation({
      to: row.requested_by_email,
      subject: approved ? 'Your schedule change was approved' : 'Your schedule change was not approved',
      html: `<p>Hi ${esc(row.requested_by_name || '')},</p>
        <p>${approved ? `${esc(decidedBy)} approved your change, and the schedule has been updated:` : `${esc(decidedBy)} didn’t approve this change:`}</p>
        <p>${esc(row.summary)}</p>
        ${!approved && reason ? `<p><b>Note:</b> ${esc(reason)}</p>` : ''}`,
    });
  } catch (err) {
    console.error('Change request decision email failed:', err);
  }
}

export default async function handler(req, res) {
  const user = await getAdminUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });
  const isAdmin = user.role !== 'staff';

  if (req.method === 'GET') {
    const pendingRes = await supabaseAdmin.from('change_requests').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(500);
    if (pendingRes.error) {
      if (pendingRes.error.code === '42P01' || /change_requests/.test(pendingRes.error.message || '')) {
        return res.status(200).json({ pending: [], recent: [], mine: [], missingTable: true });
      }
      return res.status(500).json({ error: pendingRes.error.message });
    }
    if (isAdmin) {
      const recent = await supabaseAdmin.from('change_requests').select('*').neq('status', 'pending').order('decided_at', { ascending: false }).limit(30);
      return res.status(200).json({ pending: pendingRes.data, recent: recent.data || [] });
    }
    const mine = await supabaseAdmin.from('change_requests').select('*').eq('requested_by', String(user.id)).order('created_at', { ascending: false }).limit(30);
    return res.status(200).json({ pending: pendingRes.data, mine: mine.data || [] });
  }

  if (req.method !== 'POST') return res.status(405).end();
  const { id, action, reason, force } = req.body || {};
  if (!id || !['approve', 'reject', 'withdraw'].includes(action)) return res.status(400).json({ error: 'id and a valid action are required.' });

  const { data: row } = await supabaseAdmin.from('change_requests').select('*').eq('id', id).maybeSingle();
  if (!row) return res.status(404).json({ error: 'That request no longer exists.' });
  if (row.status !== 'pending') return res.status(409).json({ error: `This request was already ${row.status}.` });

  if (action === 'withdraw') {
    if (String(row.requested_by) !== String(user.id) && !isAdmin) return res.status(403).json({ error: 'You can only withdraw your own requests.' });
    await supabaseAdmin.from('change_requests').update({ status: 'withdrawn', decided_by_name: user.name, decided_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending');
    return res.status(200).json({ ok: true });
  }

  if (!isAdmin) return res.status(403).json({ error: 'Only an admin can approve or reject change requests.' });

  if (action === 'reject') {
    const note = reason ? String(reason).slice(0, 300) : null;
    const { data: done } = await supabaseAdmin.from('change_requests')
      .update({ status: 'rejected', decided_by_name: user.name, decided_at: new Date().toISOString(), decision_note: note })
      .eq('id', id).eq('status', 'pending').select();
    if (!done || !done.length) return res.status(409).json({ error: 'Someone else has just decided this request.' });
    await logActivity({ user, action: 'update', entity_type: 'change_request', summary: `Rejected ${row.requested_by_name}'s request: ${row.summary}${note ? ` (${note})` : ''}` });
    await notifyStaff(row, false, user.name, note);
    return res.status(200).json({ ok: true });
  }

  // Approve: claim it first so two admins can't run it twice.
  const { data: claimed } = await supabaseAdmin.from('change_requests')
    .update({ status: 'processing' }).eq('id', id).eq('status', 'pending').select();
  if (!claimed || !claimed.length) return res.status(409).json({ error: 'Someone else has just decided this request.' });

  const handlerFn = HANDLERS[row.endpoint];
  if (!handlerFn || !ENDPOINTS[row.endpoint]?.[row.method]) {
    await supabaseAdmin.from('change_requests').update({ status: 'pending' }).eq('id', id);
    return res.status(400).json({ error: 'This kind of change can’t be approved here.' });
  }

  const result = await replay(handlerFn, req, row.method, { ...row.body, ...(force ? { force: true } : {}) });
  if (result.status < 200 || result.status >= 300) {
    // Not applied: back to pending so it can be approved again (e.g. after a
    // clash warning) or rejected.
    await supabaseAdmin.from('change_requests').update({ status: 'pending' }).eq('id', id);
    return res.status(result.status === 409 ? 409 : 400).json({
      code: result.body?.code || null,
      error: result.body?.error || 'The change couldn’t be applied.',
    });
  }

  await supabaseAdmin.from('change_requests')
    .update({ status: 'approved', decided_by_name: user.name, decided_at: new Date().toISOString() }).eq('id', id);
  await logActivity({ user, action: 'update', entity_type: 'change_request', summary: `Approved ${row.requested_by_name}'s request: ${row.summary}` });
  await notifyStaff(row, true, user.name);
  return res.status(200).json({ ok: true });
}
