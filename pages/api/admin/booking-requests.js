import { getAdminUser } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { logActivity } from '../../../lib/activityLog';
import { roomName, BOOKABLE_ROOMS, DAY_NAMES, slotOverlapsBlock, blockAppliesOnDate } from '../../../lib/schedule';
import { sendStudentConfirmation } from '../../../lib/sendAdminNotification';
import { slotsLabel, studentConfirmedEmail, studentRejectedEmail } from '../../../lib/bookingEmails';

// Booking requests for management-allocated rooms (APPROVAL_ROOMS in
// lib/schedule.js). Admin and super_admin only — staff can't touch bookings.
//
// GET  → every pending request, grouped: one request = all the 30-min slot
//        rows a student submitted together (same room, date, email and
//        created_at, since they were inserted in a single statement).
// POST { ids, action: 'approve' | 'reject', reason?, changes?, force? }
//      approve → status 'confirmed' + confirmation email to the student
//      approve + changes { room_id, date, start, end } (start/end in
//        minutes from midnight) → the request's slots are swapped for the
//        new timing and confirmed in one database transaction (see
//        migration-approve-with-changes.sql). If the new timing overlaps a
//        regular class, returns 409 code 'class_conflict' unless force=true.
//      reject  → status 'rejected' (frees the slot) + email with the reason

// Validates an admin's changed timing and turns it into 30-min slot starts.
function slotsFromChanges(changes) {
  const { room_id, date, start, end } = changes || {};
  if (!BOOKABLE_ROOMS.some(r => r.id === room_id)) return { error: 'Pick a valid room.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { error: 'Pick a valid date.' };
  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s % 30 || e % 30 || s < 0 || e > 24 * 60 || e <= s) {
    return { error: 'The end time must be after the start time, in 30-minute steps.' };
  }
  const slots = [];
  for (let m = s; m < e; m += 30) slots.push(m);
  return { room_id, date, slots };
}

async function findClassConflict(roomId, date, slots) {
  const [y, m, d] = date.split('-').map(Number);
  const dayName = DAY_NAMES[new Date(y, m - 1, d).getDay()];
  const { data } = await supabaseAdmin
    .from('recurring_blocks')
    .select('start_time, end_time, label, teacher, course, start_date, end_date')
    .eq('room_id', roomId)
    .eq('day_of_week', dayName);
  const clash = (data || []).find(b =>
    blockAppliesOnDate(b, date) && slots.some(start => slotOverlapsBlock(start, 30, b))
  );
  if (!clash) return null;
  const name = clash.label || [clash.course, clash.teacher].filter(Boolean).join(' \u2014 ') || 'a regular class';
  return `${name} (${String(clash.start_time).slice(0, 5)}\u2013${String(clash.end_time).slice(0, 5)})`;
}

function groupRequests(rows) {
  const groups = new Map();
  rows.forEach(r => {
    const key = `${r.room_id}|${r.date}|${r.email}|${r.created_at}`;
    if (!groups.has(key)) {
      groups.set(key, {
        ids: [], slots: [],
        room_id: r.room_id, date: r.date, student_name: r.student_name,
        email: r.email, phone: r.phone, purpose: r.purpose, created_at: r.created_at,
      });
    }
    const g = groups.get(key);
    g.ids.push(r.id);
    g.slots.push(r.hour * 60 + (r.minute || 0));
  });
  return [...groups.values()].map(g => ({ ...g, slots: g.slots.sort((a, b) => a - b) }));
}

export default async function handler(req, res) {
  const user = await getAdminUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to view booking requests.' });
  if (user.role === 'staff') return res.status(403).json({ error: 'Only an admin can review booking requests.' });

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1000);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ requests: groupRequests(data) });
  }

  if (req.method === 'POST') {
    const { ids, action, reason, changes, force } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0 || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'ids and a valid action (approve or reject) are required.' });
    }

    const safeIds = ids.filter(id => typeof id === 'string').slice(0, 100);
    const withChanges = action === 'approve' && changes;
    let data;
    let originalLabel = '';

    if (withChanges) {
      const parsed = slotsFromChanges(changes);
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const { data: original } = await supabaseAdmin
        .from('bookings').select('room_id, date, hour, minute').in('id', safeIds).eq('status', 'pending');
      if (!original || original.length === 0) {
        return res.status(409).json({ error: 'This request has already been handled by someone else. Refresh to see the latest.' });
      }
      originalLabel = `${roomName(original[0].room_id)}, ${original[0].date} ${slotsLabel(original.map(r => r.hour * 60 + (r.minute || 0)))}`;

      if (!force) {
        const clash = await findClassConflict(parsed.room_id, parsed.date, parsed.slots);
        if (clash) {
          return res.status(409).json({
            code: 'class_conflict',
            error: `The new timing overlaps a regular class in ${roomName(parsed.room_id)}: ${clash}.`,
          });
        }
      }

      const rpc = await supabaseAdmin.rpc('approve_booking_request_with_changes', {
        p_ids: safeIds, p_room: parsed.room_id, p_date: parsed.date, p_slots: parsed.slots,
      });
      if (rpc.error) {
        if (rpc.error.code === '23505') {
          return res.status(409).json({ error: 'Another booking already holds part of that new timing. Pick a different time.' });
        }
        if ((rpc.error.message || '').includes('request_already_handled')) {
          return res.status(409).json({ error: 'This request has already been handled by someone else. Refresh to see the latest.' });
        }
        if (rpc.error.code === 'PGRST202' || (rpc.error.message || '').includes('approve_booking_request_with_changes')) {
          return res.status(500).json({ error: 'The database is missing the approve-with-changes function. Run migration-approve-with-changes.sql in Supabase first.' });
        }
        return res.status(500).json({ error: rpc.error.message });
      }
      data = rpc.data;
    } else {
      // Only rows still pending are changed, so two admins clicking at the
      // same time can't approve and reject the same request.
      const upd = await supabaseAdmin
        .from('bookings')
        .update({ status: action === 'approve' ? 'confirmed' : 'rejected' })
        .in('id', safeIds)
        .eq('status', 'pending')
        .select();
      if (upd.error) return res.status(500).json({ error: upd.error.message });
      data = upd.data;
    }

    if (!data || data.length === 0) {
      return res.status(409).json({ error: 'This request has already been handled by someone else. Refresh to see the latest.' });
    }

    const first = data[0];
    const details = {
      roomId: first.room_id,
      date: first.date,
      hoursLabel: slotsLabel(data.map(r => r.hour * 60 + (r.minute || 0))),
      name: first.student_name,
      purpose: first.purpose,
    };
    const cleanReason = reason ? String(reason).slice(0, 500) : '';

    await sendStudentConfirmation({
      to: first.email,
      ...(action === 'approve'
        ? studentConfirmedEmail({ ...details, afterApproval: true, timingChanged: Boolean(withChanges) })
        : studentRejectedEmail({ ...details, reason: cleanReason })),
    });

    await logActivity({
      user,
      action: action === 'approve' ? 'update' : 'delete',
      entity_type: 'booking',
      summary: withChanges
        ? `Approved booking request for ${first.student_name} with changes \u2014 from ${originalLabel} to ${roomName(first.room_id)}, ${first.date} ${details.hoursLabel}`
        : `${action === 'approve' ? 'Approved' : 'Rejected'} booking request for ${first.student_name} \u2014 ${roomName(first.room_id)}, ${first.date} ${details.hoursLabel}${cleanReason ? ` (reason: ${cleanReason})` : ''}`,
    });

    return res.status(200).json({ ok: true, updated: data.length });
  }

  res.status(405).end();
}
