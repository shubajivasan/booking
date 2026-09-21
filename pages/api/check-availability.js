import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { HOURS, DAY_NAMES, hourOverlapsBlock, blockAppliesOnDate } from '../../lib/schedule';

// Public and unauthenticated on purpose — but it only ever returns which
// hours are taken and why (a plain label), never who booked them or any
// other class/teacher detail beyond that label. The database itself has no
// public read policy on `bookings` or `recurring_blocks` at all; this route
// is the only way either table's contents reach the browser now.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { roomId, date } = req.query;
  if (!roomId || !date) {
    return res.status(400).json({ error: 'roomId and date are required' });
  }

  const [y, m, d] = date.split('-').map(Number);
  const dayName = DAY_NAMES[new Date(y, m - 1, d).getDay()];

  const [bookingsRes, blocksRes] = await Promise.all([
    supabaseAdmin.from('bookings').select('hour').eq('room_id', roomId).eq('date', date).eq('status', 'confirmed'),
    supabaseAdmin.from('recurring_blocks').select('start_time, end_time, label, start_date, end_date').eq('room_id', roomId).eq('day_of_week', dayName),
  ]);

  if (bookingsRes.error) return res.status(500).json({ error: bookingsRes.error.message });
  if (blocksRes.error) return res.status(500).json({ error: blocksRes.error.message });

  const bookedHours = bookingsRes.data.map(r => r.hour);
  const classHours = {};
  HOURS.forEach(h => {
    const match = blocksRes.data.find(b => hourOverlapsBlock(h, b) && blockAppliesOnDate(b, date));
    if (match) classHours[h] = match.label || 'Regular class';
  });

  res.status(200).json({ bookedHours, classHours });
}
