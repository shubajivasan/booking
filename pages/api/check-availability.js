import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { HOURS, slotOverlapsBlock, validSlotStarts, overlappingSpaces } from '../../lib/schedule';
import { loadClassesOnDate } from '../../lib/classOccurrences';

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

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  // Regular classes on this date, with one-off moves/cancellations applied
  // (a session moved away frees its usual slot; one moved here blocks it).
  let classSessions;
  const bookingsRes = await supabaseAdmin.from('bookings').select('hour, minute').in('room_id', overlappingSpaces(roomId)).eq('date', date).in('status', ['pending', 'confirmed']);
  if (bookingsRes.error) return res.status(500).json({ error: bookingsRes.error.message });
  try {
    classSessions = await loadClassesOnDate(date, roomId);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // Every booked slot as its start time in minutes-from-midnight, e.g. 630
  // for 10:30. Older rows with no minute value are treated as :00, which is
  // exactly what they already meant.
  const bookedSlots = bookingsRes.data.map(r => r.hour * 60 + (r.minute || 0));

  const classSlots = {};
  validSlotStarts(HOURS).forEach(startMinutes => {
    const match = classSessions.find(b => slotOverlapsBlock(startMinutes, 30, b));
    if (match) classSlots[startMinutes] = match.label || 'Regular class';
  });

  res.status(200).json({ bookedSlots, classSlots });
}
