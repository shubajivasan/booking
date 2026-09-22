import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { sendAdminNotification } from '../../lib/sendAdminNotification';
import { sendWhatsAppNotification } from '../../lib/sendWhatsAppNotification';
import { fmtHour, roomName } from '../../lib/schedule';

// Public and unauthenticated on purpose (no login system for students yet)
// — but going through the server means the service role key, not a
// browser-exposed key, performs the insert, and the response only ever
// contains the ids of the rows THIS request just created, never anyone
// else's data. Double-booking protection is unaffected: it comes from the
// unique(room_id, date, hour) constraint in the database itself, which
// applies no matter who or what performs the insert.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { roomId, date, hours, price, name, email, phone, purpose } = req.body || {};

  if (!roomId || !date || !Array.isArray(hours) || hours.length === 0 || !name || !email || !price) {
    return res.status(400).json({ error: 'Missing required booking details' });
  }

  const rows = hours.map(hour => ({
    room_id: roomId,
    date,
    hour,
    student_name: String(name).slice(0, 200),
    email: String(email).slice(0, 200),
    phone: phone ? String(phone).slice(0, 40) : null,
    purpose: purpose ? String(purpose).slice(0, 500) : null,
    amount: price,
    status: 'confirmed',
  }));

  const { data, error } = await supabaseAdmin.from('bookings').insert(rows).select('id');

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'One or more of those hours were just booked by someone else. Please pick different slots.',
      });
    }
    return res.status(500).json({ error: 'Something went wrong saving your booking. Please try again.' });
  }

  const hoursLabel = [...hours].sort((a, b) => a - b).map(h => `${fmtHour(h)}\u2013${fmtHour(h + 1)}`).join(', ');

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

  sendWhatsAppNotification({
    roomLabel: roomName(roomId),
    date,
    timeLabel: hoursLabel,
    studentName: name,
    purpose,
  });

  res.status(200).json({ ids: data.map(r => r.id) });
}
