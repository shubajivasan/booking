import { isAdminAuthenticated } from '../../../lib/adminAuth';
import { isStaffAuthenticated } from '../../../lib/staffAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default async function handler(req, res) {
  // Both the head-office admin dashboard and the branch staff portal
  // manage the same recurring_blocks table through this one route — they're
  // separate logins (separate passwords, separate cookies), but the action
  // itself (add/remove a regular class) is identical either way.
  if (!isAdminAuthenticated(req) && !isStaffAuthenticated(req)) {
    return res.status(401).json({ error: 'Sign in to make changes.' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('recurring_blocks').select('*');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ blocks: data });
  }

  if (req.method === 'POST') {
    const { room_id, days, day_of_week, start_time, end_time, batch, teacher, course, start_date, end_date } = req.body || {};

    // Accept either the new `days` array or the old single `day_of_week`
    // string, so nothing that already calls this route breaks.
    const dayList = Array.isArray(days) && days.length ? days : (day_of_week ? [day_of_week] : []);

    if (!room_id || dayList.length === 0 || !start_time || !end_time) {
      return res.status(400).json({ error: 'Room, at least one day, start time and end time are all required.' });
    }
    const invalidDay = dayList.find(d => !VALID_DAYS.includes(d));
    if (invalidDay) {
      return res.status(400).json({ error: `"${invalidDay}" isn't a valid day of week.` });
    }
    if (start_time >= end_time) {
      return res.status(400).json({ error: 'End time must be after start time.' });
    }
    if (start_date && end_date && start_date > end_date) {
      return res.status(400).json({ error: 'End date must be after start date.' });
    }

    const label = [batch, teacher].filter(Boolean).join(' — ') || course || 'Class';

    const rows = dayList.map(day_of_week => ({
      room_id,
      day_of_week,
      start_time,
      end_time,
      batch: batch || null,
      teacher: teacher || null,
      course: course || null,
      start_date: start_date || null,
      end_date: end_date || null,
      label,
    }));

    const { data, error } = await supabaseAdmin
      .from('recurring_blocks')
      .insert(rows)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ blocks: data });
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
