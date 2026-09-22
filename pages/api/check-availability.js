import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { HOURS, DAY_NAMES, slotOverlapsBlock, blockAppliesOnDate, validSlotStarts } from '../../lib/schedule';

// Public and unauthenticated on purpose — but it only ever returns which
// slots are taken and why (a plain label), never who booked them or any
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
    supabaseAdmin.from('bookings').select('hour, minute').eq('room_id', roomId).eq('date', date).eq('status', 'confirmed'),
    supabaseAdmin.from('recurring_blocks').select('start_time, end_time, label, start_date, end_date').eq('room_id', roomId).eq('day_of_week', dayName),
  ]);

  if (bookingsRes.error) return res.status(500).json({ error: bookingsRes.error.message });
  if (blocksRes.error) return res.status(500).json({ error: blocksRes.error.message });

  // Every booked slot as its start time in minutes-from-midnight, e.g. 630
  // for 10:30. Older rows with no minute value are treated as :00, which is
  // exactly what they already meant.
  const bookedSlots = bookingsRes.data.map(r => r.hour * 60 + (r.minute || 0));

  const classSlots = {};
  validSlotStarts(HOURS).forEach(startMinutes => {
    const match = blocksRes.data.find(b => slotOverlapsBlock(startMinutes, 30, b) && blockAppliesOnDate(b, date));
    if (match) classSlots[startMinutes] = match.label || 'Regular class';
  });

  res.status(200).json({ bookedSlots, classSlots });
}
