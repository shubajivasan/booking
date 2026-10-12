import { supabaseAdmin } from './supabaseAdmin';
import { sendAdminNotification } from './sendAdminNotification';
import { roomName, minutesToLabel, timeToMinutes } from './schedule';
import { slotsLabel, esc } from './bookingEmails';

// Staff can ask for changes to classes and bookings ("This date only", Edit,
// Remove, Reschedule). Instead of changing anything, the request is saved in
// change_requests. An admin or the super admin approves it in the Requests
// tab, which then runs exactly the same change as if the admin had made it
// (same checks, clash warnings and activity log), or rejects it.
//
// Each request stores the API route, method and body the staff member sent,
// so approving simply replays it (pages/api/admin/change-requests.js).

export const ENDPOINTS = {
  blocks: { PATCH: 'class_edit', DELETE: 'class_remove' },
  'class-exceptions': { POST: 'session_change', DELETE: 'session_undo' },
  bookings: { PATCH: 'booking_change', DELETE: 'booking_cancel' },
};

const t = hhmm => minutesToLabel(timeToMinutes(hhmm));
const who = b => (b ? (b.label || [b.batch || b.course || 'Class', b.teacher].filter(Boolean).join(' — ')) : 'a class');
function prettyDate(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const whereWhen = b => `${roomName(b.room_id)}, ${b.day_of_week} ${t(b.start_time)}–${t(b.end_time)}`;

// Plain-language description, built from the current data.
async function describe(endpoint, method, body) {
  if (endpoint === 'blocks') {
    const { data: b } = await supabaseAdmin.from('recurring_blocks').select('*').eq('id', body.id).maybeSingle();
    if (!b) return { error: 'That class no longer exists. Refresh the page.' };
    if (method === 'DELETE') {
      return { summary: `Remove the regular class "${who(b)}" (${whereWhen(b)}), every week`, block_id: String(b.id) };
    }
    const after = { ...b, ...body };
    const changes = [];
    if (after.room_id !== b.room_id || after.day_of_week !== b.day_of_week
      || String(after.start_time).slice(0, 5) !== String(b.start_time).slice(0, 5)
      || String(after.end_time).slice(0, 5) !== String(b.end_time).slice(0, 5)) {
      changes.push(`now ${whereWhen(after)}`);
    }
    ['batch', 'teacher', 'course', 'class_type'].forEach(k => {
      if ((after[k] || '') !== (b[k] || '')) changes.push(`${k === 'class_type' ? 'class type' : k}: "${b[k] || '—'}" → "${after[k] || '—'}"`);
    });
    if ((after.start_date || null) !== (b.start_date || null) || (after.end_date || null) !== (b.end_date || null)) {
      changes.push(`dates: ${after.start_date || 'any'} → ${after.end_date || 'ongoing'}`);
    }
    return {
      summary: `Edit the regular class "${who(b)}" (${whereWhen(b)}): ${changes.length ? changes.join('; ') : 'no visible change'}`,
      block_id: String(b.id),
    };
  }

  if (endpoint === 'class-exceptions') {
    if (method === 'DELETE') {
      const { data: ex } = await supabaseAdmin.from('class_exceptions').select('*').eq('id', body.id).maybeSingle();
      if (!ex) return { error: 'That one-off change no longer exists. Refresh the page.' };
      const { data: b } = await supabaseAdmin.from('recurring_blocks').select('*').eq('id', ex.block_id).maybeSingle();
      return { summary: `Undo the one-off change to "${who(b)}" on ${prettyDate(ex.original_date)} (back to its usual time)`, block_id: String(ex.block_id) };
    }
    const { data: b } = await supabaseAdmin.from('recurring_blocks').select('*').eq('id', body.block_id).maybeSingle();
    if (!b) return { error: 'That class no longer exists. Refresh the page.' };
    const base = `"${who(b)}" on ${prettyDate(body.original_date)} (${roomName(b.room_id)} ${t(b.start_time)}–${t(b.end_time)})`;
    const note = body.note ? ` — note: ${body.note}` : '';
    if (body.status === 'cancelled') return { summary: `Cancel one session: ${base}${note}`, block_id: String(b.id) };
    return {
      summary: `Move one session: ${base} → ${roomName(body.new_room_id || b.room_id)}, ${prettyDate(body.new_date)} ${t(body.new_start || '00:00')}–${t(body.new_end || '00:00')}${note}`,
      block_id: String(b.id),
    };
  }

  if (endpoint === 'bookings') {
    const ids = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
    if (!ids.length) return { error: 'Pick a booking.' };
    const { data: rows } = await supabaseAdmin.from('bookings').select('*').in('id', ids);
    if (!rows || !rows.length) return { error: 'That booking no longer exists. Refresh the page.' };
    const first = rows[0];
    const was = `${first.student_name}${first.purpose ? ` (${first.purpose})` : ''}, ${roomName(first.room_id)} ${prettyDate(first.date)} ${slotsLabel(rows.map(r => r.hour * 60 + (r.minute || 0)))}`;
    if (method === 'DELETE') return { summary: `Cancel the booking: ${was}`, booking_ids: ids.map(String) };
    if (Array.isArray(body.ids)) {
      return {
        summary: `Reschedule the booking: ${was} → ${roomName(body.room_id)}, ${prettyDate(body.date)} ${minutesToLabel(Number(body.start))}–${minutesToLabel(Number(body.end))}`,
        booking_ids: ids.map(String),
      };
    }
    return { summary: `Move a booking slot: ${was} → ${prettyDate(body.date || first.date)}`, booking_ids: ids.map(String) };
  }
  return { error: 'This change can’t be requested.' };
}

// Called by the API routes when a staff member tries to make one of these
// changes. Saves the request and answers 202.
export async function queueStaffChange(req, res, user, endpoint) {
  const method = req.method;
  const kind = ENDPOINTS[endpoint]?.[method];
  if (!kind) return res.status(403).json({ error: 'Only an admin can do this.' });

  const body = { ...(req.body || {}) };
  delete body.force; // an admin decides on clash warnings when approving

  const d = await describe(endpoint, method, body);
  if (d.error) return res.status(400).json({ error: d.error });

  const { data, error } = await supabaseAdmin.from('change_requests').insert([{
    kind, endpoint, method, body, summary: d.summary,
    block_id: d.block_id || null, booking_ids: d.booking_ids || null,
    requested_by: String(user.id), requested_by_name: user.name, requested_by_email: user.email,
  }]).select().single();
  if (error) {
    if (error.code === '42P01' || /change_requests/.test(error.message || '')) {
      return res.status(500).json({ error: 'Change requests aren’t set up yet. Ask an admin to run migration-change-requests.sql in Supabase.' });
    }
    return res.status(500).json({ error: error.message });
  }

  try {
    await sendAdminNotification({
      subject: `Change request from ${user.name}`,
      html: `<p><b>${esc(user.name)}</b> asked for this change to the schedule:</p><p>${esc(d.summary)}</p><p>Open the dashboard → Requests tab to approve or reject it: <a href="https://${req.headers.host}/admin">${req.headers.host}/admin</a></p>`,
    });
  } catch (err) {
    console.error('Change request email failed:', err);
  }

  return res.status(202).json({
    queued: true,
    request: data,
    message: 'Sent to an admin for approval. Nothing changes until it’s approved.',
  });
}
