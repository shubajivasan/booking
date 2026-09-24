import { getAdminUser } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { logActivity } from '../../../lib/activityLog';
import { roomName, minutesToLabel, BOOKABLE_ROOMS } from '../../../lib/schedule';
import { slotsLabel } from '../../../lib/bookingEmails';

// The dashboard shows back-to-back 30-min slot rows of the same booking as
// ONE entry, so Remove and Reschedule act on all of that entry's rows
// (`ids`). A single `id` still works for older callers (bulk date moves).
function idList(body) {
  const { id, ids } = body || {};
  if (Array.isArray(ids)) return ids.filter(x => typeof x === 'string').slice(0, 100);
  return typeof id === 'string' ? [id] : [];
}

function describe(rows) {
  const first = rows[0];
  return `${first.student_name} \u2014 ${roomName(first.room_id)}, ${first.date} ${slotsLabel(rows.map(r => r.hour * 60 + (r.minute || 0)))}`;
}

export default async function handler(req, res) {
  const user = await getAdminUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in as staff to view bookings.' });

  if (req.method === 'GET') {
    const { from, to, all } = req.query;

    if (all === 'true') {
      const { data, error } = await supabaseAdmin
        .from('bookings')
        .select('*')
        .eq('status', 'confirmed')
        .order('date', { ascending: false })
        .order('hour', { ascending: false })
        .limit(1000);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ bookings: data, truncated: data.length === 1000 });
    }

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD), or pass all=true.' });
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

  if (user.role === 'staff') {
    return res.status(403).json({ error: 'Only an admin can change a booking.' });
  }

  if (req.method === 'DELETE') {
    const ids = idList(req.body);
    if (ids.length === 0) return res.status(400).json({ error: 'id or ids is required' });

    const { data: existing } = await supabaseAdmin.from('bookings').select('*').in('id', ids);

    const { error } = await supabaseAdmin.from('bookings').delete().in('id', ids);
    if (error) return res.status(500).json({ error: error.message });

    if (existing && existing.length > 0) {
      await logActivity({
        user, action: 'delete', entity_type: 'booking',
        summary: `Cancelled booking for ${describe(existing)}`,
      });
    }

    return res.status(200).json({ ok: true });
  }

  // Whole-entry reschedule: { ids, room_id, date, start, end } with start/end
  // in minutes from midnight. Moves every slot together (and can change the
  // length) in one database transaction — see migration-reschedule-group.sql.
  if (req.method === 'PATCH' && Array.isArray(req.body?.ids)) {
    const ids = idList(req.body);
    const { room_id, date } = req.body;
    const start = Number(req.body.start);
    const end = Number(req.body.end);
    if (ids.length === 0) return res.status(400).json({ error: 'ids is required' });
    if (!BOOKABLE_ROOMS.some(r => r.id === room_id)) return res.status(400).json({ error: 'Pick a valid room.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ error: 'Pick a valid date.' });
    if (!Number.isInteger(start) || !Number.isInteger(end) || start % 30 || end % 30 || start < 0 || end > 24 * 60 || end <= start) {
      return res.status(400).json({ error: 'The end time must be after the start time, in 30-minute steps.' });
    }
    const slots = [];
    for (let m = start; m < end; m += 30) slots.push(m);

    const { data: existing } = await supabaseAdmin.from('bookings').select('*').in('id', ids);

    const { data, error } = await supabaseAdmin.rpc('reschedule_booking_group', {
      p_ids: ids, p_room: room_id, p_date: date, p_slots: slots,
    });
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That room is already booked for part of the new time. Pick a different slot.' });
      }
      if ((error.message || '').includes('booking_not_found')) {
        return res.status(409).json({ error: 'This booking has changed or been removed. Refresh to see the latest.' });
      }
      if (error.code === 'PGRST202' || (error.message || '').includes('reschedule_booking_group')) {
        return res.status(500).json({ error: 'The database is missing the reschedule function. Run migration-reschedule-group.sql in Supabase first.' });
      }
      return res.status(500).json({ error: error.message });
    }

    if (existing && existing.length > 0 && data && data.length > 0) {
      await logActivity({
        user, action: 'update', entity_type: 'booking',
        summary: `Rescheduled booking for ${describe(existing)} \u2192 ${roomName(data[0].room_id)}, ${data[0].date} ${slotsLabel(data.map(r => r.hour * 60 + (r.minute || 0)))}`,
      });
    }

    return res.status(200).json({ bookings: data });
  }

  if (req.method === 'PATCH') {
    const { id, room_id, date, hour, minute } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { data: existing } = await supabaseAdmin.from('bookings').select('*').eq('id', id).maybeSingle();

    const updates = {};
    if (room_id) updates.room_id = room_id;
    if (date) updates.date = date;
    if (hour !== undefined && hour !== null) updates.hour = hour;
    if (minute !== undefined && minute !== null) updates.minute = minute;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update — provide room_id, date, hour and/or minute.' });
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

    if (existing) {
      const updated = data[0];
      await logActivity({
        user, action: 'update', entity_type: 'booking',
        summary: `Rescheduled booking for ${existing.student_name} \u2014 from ${roomName(existing.room_id)}, ${existing.date} ${minutesToLabel(existing.hour * 60 + (existing.minute || 0))} to ${roomName(updated.room_id)}, ${updated.date} ${minutesToLabel(updated.hour * 60 + (updated.minute || 0))}`,
      });
    }

    return res.status(200).json({ booking: data[0] });
  }

  res.status(405).end();
}
