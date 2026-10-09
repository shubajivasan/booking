import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { sendAdminNotification, sendStudentConfirmation } from '../../lib/sendAdminNotification';
import { sendWhatsAppNotification } from '../../lib/sendWhatsAppNotification';
import { roomName, requiresApproval } from '../../lib/schedule';
import { slotsLabel, adminEmail, studentConfirmedEmail, studentRequestReceivedEmail } from '../../lib/bookingEmails';
import { loadSpaceDetails } from '../../lib/spaceDetails';
import { classesOverlappingSlots } from '../../lib/classConflicts';

// Resolves after `ms` milliseconds — used to cap how long the booking
// response waits on notifications.
function timeout(ms) {
  return new Promise(resolve => setTimeout(() => resolve('timeout'), ms));
}

// Public and unauthenticated on purpose (no login system for students yet)
// — but going through the server means the service role key, not a
// browser-exposed key, performs the insert, and the response only ever
// contains the ids of the rows THIS request just created, never anyone
// else's data. Double-booking protection is unaffected: it comes from the
// unique index on (room_id, date, hour, minute) for active bookings in the
// database itself, which applies no matter who or what performs the insert.
//
// Rooms in APPROVAL_ROOMS (lib/schedule.js) are saved as 'pending' instead
// of 'confirmed'. A pending request still holds the slot, so nobody else
// can request the same time while an admin decides.
export default async function handler(req, res) {
  await loadSpaceDetails(); // names a super admin changed in the Spaces tab
  if (req.method !== 'POST') return res.status(405).end();

  const { roomId, date, slots, price, name, email, phone, purpose } = req.body || {};

  // price can be 0 for spaces whose price isn't set yet (e.g. AAPA Hall).
  if (!roomId || !date || !Array.isArray(slots) || slots.length === 0 || !name || !email || price == null) {
    return res.status(400).json({ error: 'Missing required booking details' });
  }

  // The booking page greys out class times, but a page left open from before
  // a class was added (or a direct request) could still send them. Bookings
  // can't sit on top of a regular class, so check on the server too.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !slots.every(s => Number.isInteger(s) && s % 30 === 0)) {
    return res.status(400).json({ error: 'Invalid date or time.' });
  }
  let classClash = [];
  try { classClash = await classesOverlappingSlots(roomId, date, slots); } catch (err) { console.error('Class check failed:', err); }
  if (classClash.length) {
    return res.status(409).json({
      error: 'Part of that time is taken by a regular class. The times have been refreshed — please pick a free slot.',
    });
  }

  const needsApproval = requiresApproval(roomId);
  const status = needsApproval ? 'pending' : 'confirmed';
  const pricePerSlot = Math.round((Number(price) || 0) / 2);

  const rows = slots.map(startMinutes => ({
    room_id: roomId,
    date,
    hour: Math.floor(startMinutes / 60),
    minute: startMinutes % 60,
    student_name: String(name).slice(0, 200),
    email: String(email).slice(0, 200),
    phone: phone ? String(phone).slice(0, 40) : null,
    purpose: purpose ? String(purpose).slice(0, 500) : null,
    amount: pricePerSlot,
    status,
  }));

  const { data, error } = await supabaseAdmin.from('bookings').insert(rows).select('id');

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'One or more of those times were just booked by someone else. Please pick different slots.',
      });
    }
    console.error('Booking insert failed:', error);
    return res.status(500).json({ error: 'Something went wrong saving your booking. Please try again.' });
  }

  const hoursLabel = slotsLabel(slots);
  const details = { roomId, date, hoursLabel, name, email, phone, purpose };
  const adminUrl = `https://${req.headers.host}/admin`;

  // Notifications are awaited before responding. On Vercel, work that's
  // still running after the response is sent can be cut off, so
  // fire-and-forget risked alerts silently never arriving. Each helper
  // catches its own errors, so a failed email/WhatsApp still never breaks
  // the booking — and the 8-second cap means a slow mail server can't
  // leave the student stuck on "Confirming…".
  const notifications = Promise.allSettled([
    sendAdminNotification(adminEmail({ ...details, needsApproval, adminUrl })),
    sendStudentConfirmation({
      to: email,
      ...(needsApproval ? studentRequestReceivedEmail(details) : studentConfirmedEmail(details)),
    }),
    sendWhatsAppNotification({
      roomLabel: roomName(roomId),
      date,
      timeLabel: hoursLabel,
      studentName: name,
      // The approved WhatsApp template's wording is fixed, so a request is
      // flagged through the purpose field rather than a new template.
      purpose: needsApproval ? `APPROVAL NEEDED \u2014 ${purpose || 'no purpose given'}` : purpose,
    }),
  ]);

  const outcome = await Promise.race([notifications, timeout(8000)]);
  if (outcome === 'timeout') {
    console.warn('Notifications still sending after 8s \u2014 responding to student anyway.');
  }

  res.status(200).json({ ids: data.map(r => r.id), status });
}
