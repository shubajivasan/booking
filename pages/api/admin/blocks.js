import { isAdminAuthenticated } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default async function handler(req, res) {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ error: 'Sign in as staff to make changes.' });
  }

  if (req.method === 'POST') {
    const { room_id, day_of_week, start_time, end_time, batch, teacher, course } = req.body || {};

    if (!room_id || !day_of_week || !start_time || !end_time) {
      return res.status(400).json({ error: 'Room, day, start time and end time are all required.' });
    }
    if (!VALID_DAYS.includes(day_of_week)) {
      return res.status(400).json({ error: 'day_of_week must be a full day name, e.g. "Monday".' });
    }
    if (start_time >= end_time) {
      return res.status(400).json({ error: 'End time must be after start time.' });
    }

    const label = [batch, teacher].filter(Boolean).join(' — ') || course || 'Class';

    const { data, error } = await supabaseAdmin
      .from('recurring_blocks')
      .insert([{
        room_id,
        day_of_week,
        start_time,
        end_time,
        batch: batch || null,
        teacher: teacher || null,
        course: course || null,
        label,
      }])
      .select();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ block: data[0] });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required.' });

    const { error } = await supabaseAdmin.from('recurring_blocks').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.status(405).end();
}
