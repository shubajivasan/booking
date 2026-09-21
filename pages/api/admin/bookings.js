import { isAdminAuthenticated } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export default async function handler(req, res) {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ error: 'Sign in as staff to view bookings.' });
  }

  if (req.method === 'GET') {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD).' });
    }

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .gte('date', from)
      .lte('date', to)
      .eq('status', 'confirmed');

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ bookings: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { error } = await supabaseAdmin.from('bookings').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PATCH') {
    // Reschedule an existing booking — change its room, date and/or hour.
    // Any field left out keeps its current value.
    const { id, room_id, date, hour } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const updates = {};
    if (room_id) updates.room_id = room_id;
    if (date) updates.date = date;
    if (hour !== undefined && hour !== null) updates.hour = hour;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update — provide room_id, date and/or hour.' });
    }

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That room is already booked or has a class at the new time. Pick a different slot.' });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ booking: data[0] });
  }

  res.status(405).end();
}
