import { getAdminUser, isAdmin, isTeacher, teachesBlock } from '../../../lib/adminAuth';
import { isStaffAuthenticated } from '../../../lib/staffAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { logActivity } from '../../../lib/activityLog';
import { roomName, minutesToLabel, timeToMinutes, CLASS_TYPES } from '../../../lib/schedule';
import { loadSpaceDetails } from '../../../lib/spaceDetails';
import { bookingsOverlappingClass, listForMessage } from '../../../lib/classConflicts';
import { queueStaffChange } from '../../../lib/changeRequests';
import { fetchAll } from '../../../lib/fetchAll';

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// '' / null = not set; anything else must be one of CLASS_TYPES.
function cleanClassType(v) {
  if (v === undefined) return undefined; // not sent: leave as is
  if (!v) return null;
  return CLASS_TYPES.includes(v) ? v : false;
}
function missingColumn(error) {
  return /class_type/.test(error?.message || '')
    ? 'The database is missing the class type column. Run migration-class-type.sql in Supabase first.'
    : error.message;
}

function timeLabel(hhmmss) {
  return minutesToLabel(timeToMinutes(hhmmss));
}

export default async function handler(req, res) {
  await loadSpaceDetails(); // names a super admin changed in the Spaces tab
  const user = await getAdminUser(req);
  const isBranchStaff = isStaffAuthenticated(req);

  if (!user && !isBranchStaff) {
    return res.status(401).json({ error: 'Sign in to make changes.' });
  }

  const canEditOrDelete = isBranchStaff || isAdmin(user);

  if (req.method === 'GET') {
    // Page by page: there are more than 1,000 classes across all branches.
    const { data, error } = await fetchAll(() => supabaseAdmin.from('recurring_blocks').select('*').order('id'));
    if (error) return res.status(500).json({ error: error.message });
    // A teacher only ever receives their own classes.
    if (isTeacher(user)) return res.status(200).json({ blocks: data.filter(b => teachesBlock(user, b)) });
    return res.status(200).json({ blocks: data });
  }

  // Teachers: the only change they can make is asking to rename the batch of
  // one of their own classes. It becomes a change request for an admin.
  if (isTeacher(user)) {
    if (req.method !== 'PATCH') return res.status(403).json({ error: 'Teachers can only ask to rename a batch.' });
    const { data: b } = await supabaseAdmin.from('recurring_blocks').select('*').eq('id', req.body?.id).maybeSingle();
    if (!b || !teachesBlock(user, b)) return res.status(403).json({ error: 'You can only ask to rename your own classes.' });
    const batch = String(req.body?.batch || '').trim().slice(0, 120);
    if (!batch) return res.status(400).json({ error: 'Type the new batch name.' });
    if (batch === (b.batch || '').trim()) return res.status(400).json({ error: 'That is already the batch name.' });
    return queueStaffChange({ ...req, method: 'PATCH', body: { id: b.id, batch, rename_only: true } }, res, user, 'blocks');
  }

  if (req.method === 'POST') {
    const { room_id, days, day_of_week, start_time, end_time, batch, teacher, course, start_date, end_date } = req.body || {};
    const class_type = cleanClassType(req.body?.class_type);
    if (class_type === false) return res.status(400).json({ error: 'Pick a valid class type.' });

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

    // A class mustn't land on top of upcoming bookings without the admin
    // knowing: list them and only save if confirmed (force).
    if (!req.body.force) {
      const ignoreIds = Array.isArray(req.body.ignore_booking_ids) ? req.body.ignore_booking_ids : [];
      const clash = await bookingsOverlappingClass({ room_id, days: dayList, start_time, end_time, start_date, end_date }, { ignoreIds });
      if (clash.length) {
        return res.status(409).json({
          code: 'booking_conflict',
          error: `${roomName(room_id)}: this class would overlap ${clash.length === 1 ? 'an upcoming booking' : `${clash.length} upcoming bookings`} — ${listForMessage(clash)}.`,
        });
      }
    }

    const rows = dayList.map(day_of_week => ({
      room_id,
      day_of_week,
      start_time,
      end_time,
      batch: batch || null,
      teacher: teacher || null,
      course: course || null,
      ...(class_type !== undefined ? { class_type } : {}),
      start_date: start_date || null,
      end_date: end_date || null,
      label,
    }));

    const { data, error } = await supabaseAdmin
      .from('recurring_blocks')
      .insert(rows)
      .select();

    if (error) return res.status(500).json({ error: missingColumn(error) });

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
      // Staff: the edit becomes a request an admin approves.
      if (user) return queueStaffChange(req, res, user, 'blocks');
      return res.status(403).json({ error: 'Only an admin can edit a regular class.' });
    }

    // Batch rename only (a teacher's approved request): change nothing else,
    // so edits made to the class since the request aren't undone.
    if (req.body?.rename_only) {
      const batch = String(req.body.batch || '').trim().slice(0, 120);
      const { data: b } = await supabaseAdmin.from('recurring_blocks').select('*').eq('id', req.body.id).maybeSingle();
      if (!b) return res.status(404).json({ error: 'That class no longer exists.' });
      if (!batch) return res.status(400).json({ error: 'The batch name can\u2019t be empty.' });
      const label = [batch, b.teacher].filter(Boolean).join(' \u2014 ') || b.course || 'Class';
      const { data, error } = await supabaseAdmin.from('recurring_blocks').update({ batch, label }).eq('id', b.id).select();
      if (error) return res.status(500).json({ error: error.message });
      if (user) {
        await logActivity({
          user, action: 'update', entity_type: 'class',
          summary: `Renamed batch "${b.batch || '\u2014'}" \u2192 "${batch}" (${roomName(b.room_id)}, ${b.day_of_week} ${timeLabel(b.start_time)}\u2013${timeLabel(b.end_time)})`,
        });
      }
      return res.status(200).json({ block: data[0] });
    }
    const { id, room_id, day_of_week, start_time, end_time, batch, teacher, course, start_date, end_date } = req.body || {};
    const class_type = cleanClassType(req.body?.class_type);
    if (class_type === false) return res.status(400).json({ error: 'Pick a valid class type.' });
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

    // Only when the room, day, time or dates change (editing just the name or
    // teacher shouldn't warn about bookings that were already there).
    const { data: before } = await supabaseAdmin.from('recurring_blocks').select('*').eq('id', id).maybeSingle();
    const timingChanged = !before
      || before.room_id !== room_id || before.day_of_week !== day_of_week
      || String(before.start_time).slice(0, 5) !== String(start_time).slice(0, 5)
      || String(before.end_time).slice(0, 5) !== String(end_time).slice(0, 5)
      || (before.start_date || null) !== (start_date || null) || (before.end_date || null) !== (end_date || null);
    if (!req.body.force && timingChanged) {
      const clash = await bookingsOverlappingClass({ id, room_id, day_of_week, start_time, end_time, start_date, end_date });
      if (clash.length) {
        return res.status(409).json({
          code: 'booking_conflict',
          error: `${roomName(room_id)}: with these changes the class would overlap ${clash.length === 1 ? 'an upcoming booking' : `${clash.length} upcoming bookings`} — ${listForMessage(clash)}.`,
        });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('recurring_blocks')
      .update({
        room_id, day_of_week, start_time, end_time,
        batch: batch || null,
        teacher: teacher || null,
        course: course || null,
        ...(class_type !== undefined ? { class_type } : {}),
        start_date: start_date || null,
        end_date: end_date || null,
        label,
      })
      .eq('id', id)
      .select();

    if (error) return res.status(500).json({ error: missingColumn(error) });

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
      if (user) return queueStaffChange(req, res, user, 'blocks');
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
