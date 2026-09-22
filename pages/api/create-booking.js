import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { sendAdminNotification, sendStudentConfirmation } from '../../lib/sendAdminNotification';
import { sendWhatsAppNotification } from '../../lib/sendWhatsAppNotification';
import { minutesToLabel, roomName } from '../../lib/schedule';

// Groups a list of 30-minute slot starts (in minutes-from-midnight) into
// contiguous runs for a readable label — e.g. [600, 630] (10:00, 10:30)
// reads as "10am–11am" instead of two separate half-hour ranges.
function slotsLabel(startMinutesList) {
  const sorted = [...startMinutesList].sort((a, b) => a - b);
  const runs = [];
  let runStart = sorted[0];
  let runEnd = sorted[0] + 30;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === runEnd) {
      runEnd = sorted[i] + 30;
    } else {
      runs.push([runStart, runEnd]);
      runStart = sorted[i];
      runEnd = sorted[i] + 30;
    }
  }
  runs.push([runStart, runEnd]);
  return runs.map(([s, e]) => `${minutesToLabel(s)}\u2013${minutesToLabel(e)}`).join(', ');
}

// Public and unauthenticated on purpose (no login system for students yet)
// — but going through the server means the service role key, not a
// browser-exposed key, performs the insert, and the response only ever
// contains the ids of the rows THIS request just created, never anyone
// else's data. Double-booking protection is unaffected: it comes from the
// unique(room_id, date, hour, minute) constraint in the database itself,
// which applies no matter who or what performs the insert.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { roomId, date, slots, price, name, email, phone, purpose } = req.body || {};

  if (!roomId || !date || !Array.isArray(slots) || slots.length === 0 || !name || !email || !price) {
    return res.status(400).json({ error: 'Missing required booking details' });
  }

  const pricePerSlot = Math.round(price / 2);

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
    status: 'confirmed',
  }));

  const { data, error } = await supabaseAdmin.from('bookings').insert(rows).select('id');

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'One or more of those times were just booked by someone else. Please pick different slots.',
      });
    }
    return res.status(500).json({ error: 'Something went wrong saving your booking. Please try again.' });
  }

  const hoursLabel = slotsLabel(slots);

  // Fire-and-forget: don't make the student wait on the email, and don't
  // let an email problem affect the response they get.
  sendAdminNotification({
    subject: `New booking: ${roomName(roomId)} on ${date}`,
    html: `
      <h2>New booking</h2>
      <p><b>Space:</b> ${roomName(roomId)}</p>
      <p><b>Date:</b> ${date}</p>
      <p><b>Hours:</b> ${hoursLabel}</p>
      <p><b>Name:</b> ${name}</p>
      <p><b>Email:</b> ${email}</p>
      <p><b>Phone:</b> ${phone || '\u2014'}</p>
      <p><b>Purpose:</b> ${purpose || '\u2014'}</p>
    `,
  });

  sendStudentConfirmation({
    to: email,
    subject: `Your booking is confirmed \u2014 ${roomName(roomId)}, ${date}`,
    html: `
      <div style="font-family: Georgia, serif; color: #2b2116; max-width: 480px;">
        <p style="font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #8a6d3b; margin-bottom: 4px;">
          Ajivasan Academy of Performing Arts
        </p>
        <h2 style="margin-top: 0;">Booking confirmed</h2>
        <p>Hi ${name},</p>
        <p>Your booking is confirmed. Here are the details:</p>
        <table style="border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 4px 12px 4px 0; color: #6b5c47;">Space</td><td><b>${roomName(roomId)}</b></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b5c47;">Date</td><td><b>${date}</b></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b5c47;">Time</td><td><b>${hoursLabel}</b></td></tr>
          ${purpose ? `<tr><td style="padding: 4px 12px 4px 0; color: #6b5c47;">Purpose</td><td>${purpose}</td></tr>` : ''}
        </table>
        <p style="font-size: 13px; color: #6b5c47;">
          If anything about this booking needs to change, please get in touch with the academy directly.
        </p>
      </div>
    `,
  });

  sendWhatsAppNotification({
    roomLabel: roomName(roomId),
    date,
    timeLabel: hoursLabel,
    studentName: name,
    purpose,
  });

  res.status(200).json({ ids: data.map(r => r.id) });
}
