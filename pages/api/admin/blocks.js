import { getAdminUser } from '../../../lib/adminAuth';
import { isStaffAuthenticated } from '../../../lib/staffAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { logActivity } from '../../../lib/activityLog';
import { roomName, minutesToLabel, timeToMinutes } from '../../../lib/schedule';

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function timeLabel(hhmmss) {
  return minutesToLabel(timeToMinutes(hhmmss));
}

export default async function handler(req, res) {
  const user = await getAdminUser(req);
  const isBranchStaff = isStaffAuthenticated(req);

  if (!user && !isBranchStaff) {
    return res.status(401).json({ error: 'Sign in to make changes.' });
  }

  const canEditOrDelete = isBranchStaff || (user && user.role !== 'staff');

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('recurring_blocks').select('*');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ blocks: data });
  }

  if (req.method === 'POST') {
    const { room_id, days, day_of_week, start_time, end_time, batch, teacher, course, start_date, end_date } = req.body || {};

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

    if (user) {
      await logActivity({
        user, action: 'create', entity_type: 'class',
        summary: `Added regular class "${label}" in ${roomName(room_id)} on ${dayList.join(', ')}, ${timeLabel(start_time)}\u2013${timeLabel(end_time)}`,
      });
    }

    return res.status(200).json({ blocks: data });
  }

  if (req.method === 'PATCH') {
    if (!canEditOrDelete) {
      return res.status(403).json({ error: 'Only an admin can edit a regular class.' });
    }
    const { id, room_id, day_of_week, start_time, end_time, batch, teacher, course, start_date, end_date } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required.' });
    if (!room_id || !day_of_week || !start_time || !end_time) {
      return res.status(400).json({ error: 'Room, day, start time and end time are all required.' });
    }
    if (!VALID_DAYS.includes(day_of_week)) {
      return res.status(400).json({ error: `"${day_of_week}" isn't a valid day of week.` });
    }
    if (start_time >= end_time) {
      return res.status(400).json({ error: 'End time must be after start time.' });
    }
    if (start_date && end_date && start_date > end_date) {
      return res.status(400).json({ error: 'End date must be after start date.' });
    }

    const label = [batch, teacher].filter(Boolean).join(' — ') || course || 'Class';

    const { data, error } = await supabaseAdmin
      .from('recurring_blocks')
      .update({
        room_id, day_of_week, start_time, end_time,
        batch: batch || null,
        teacher: teacher || null,
        course: course || null,
        start_date: start_date || null,
        end_date: end_date || null,
        label,
      })
      .eq('id', id)
      .select();

    if (error) return res.status(500).json({ error: error.message });

    if (user) {
      await logActivity({
        user, action: 'update', entity_type: 'class',
        summary: `Edited regular class "${label}" in ${roomName(room_id)}, now ${day_of_week} ${timeLabel(start_time)}\u2013${timeLabel(end_time)}`,
      });
    }

    return res.status(200).json({ block: data[0] });
  }

  if (req.method === 'DELETE') {
    if (!canEditOrDelete) {
      return res.status(403).json({ error: 'Only an admin can remove a regular class.' });
    }
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required.' });

    const { data: existing } = await supabaseAdmin.from('recurring_blocks').select('*').eq('id', id).maybeSingle();

    const { error } = await supabaseAdmin.from('recurring_blocks').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    if (user && existing) {
      await logActivity({
        user, action: 'delete', entity_type: 'class',
        summary: `Removed regular class "${existing.label}" from ${roomName(existing.room_id)}, ${existing.day_of_week} ${timeLabel(existing.start_time)}\u2013${timeLabel(existing.end_time)}`,
      });
    }

    return res.status(200).json({ ok: true });
  }

  res.status(405).end();
}
