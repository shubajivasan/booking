import { getAdminUser } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { logActivity } from '../../../lib/activityLog';
import { roomName } from '../../../lib/schedule';
import { sendStudentConfirmation } from '../../../lib/sendAdminNotification';
import { slotsLabel, studentConfirmedEmail, studentRejectedEmail } from '../../../lib/bookingEmails';

// Booking requests for management-allocated rooms (APPROVAL_ROOMS in
// lib/schedule.js). Admin and super_admin only — staff can't touch bookings.
//
// GET  → every pending request, grouped: one request = all the 30-min slot
//        rows a student submitted together (same room, date, email and
//        created_at, since they were inserted in a single statement).
// POST { ids, action: 'approve' | 'reject', reason? }
//      approve → status 'confirmed' + confirmation email to the student
//      reject  → status 'rejected' (frees the slot) + email with the reason

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
    const { ids, action, reason } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0 || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'ids and a valid action (approve or reject) are required.' });
    }

    // Only rows still pending are changed, so two admins clicking at the
    // same time can't approve and reject the same request.
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update({ status: action === 'approve' ? 'confirmed' : 'rejected' })
      .in('id', ids.filter(id => typeof id === 'string').slice(0, 100))
      .eq('status', 'pending')
      .select();

    if (error) return res.status(500).json({ error: error.message });
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
        ? studentConfirmedEmail({ ...details, afterApproval: true })
        : studentRejectedEmail({ ...details, reason: cleanReason })),
    });

    await logActivity({
      user,
      action: action === 'approve' ? 'update' : 'delete',
      entity_type: 'booking',
      summary: `${action === 'approve' ? 'Approved' : 'Rejected'} booking request for ${first.student_name} \u2014 ${roomName(first.room_id)}, ${first.date} ${details.hoursLabel}${cleanReason ? ` (reason: ${cleanReason})` : ''}`,
    });

    return res.status(200).json({ ok: true, updated: data.length });
  }

  res.status(405).end();
}
