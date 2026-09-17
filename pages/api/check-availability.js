import { supabaseAdmin } from '../../lib/supabaseAdmin';

// Public and unauthenticated on purpose — but it only ever returns which
// hours are taken (integers), never who booked them. That's the whole
// point of moving this behind an API route: the server decides exactly
// which columns leave the database, instead of the browser being able to
// run any query it likes against the table directly.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { roomId, date } = req.query;
  if (!roomId || !date) {
    return res.status(400).json({ error: 'roomId and date are required' });
  }

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('hour')
    .eq('room_id', roomId)
    .eq('date', date)
    .eq('status', 'confirmed');

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ bookedHours: data.map(r => r.hour) });
}
