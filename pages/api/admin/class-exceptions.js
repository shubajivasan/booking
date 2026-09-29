import { getAdminUser } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { logActivity } from '../../../lib/activityLog';
import { ROOMS, roomName, minutesToLabel, timeToMinutes, blockAppliesOnDate, weekdayOfDateKey } from '../../../lib/schedule';
import { loadClassesOnDate } from '../../../lib/classOccurrences';

// One-off changes to a single session of a regular class.
//   GET                       → every one-off change (small table)
//   POST { block_id, original_date, status: 'moved' | 'cancelled',
//          new_date?, new_start?, new_end?, new_room_id?, note?, force? }
//        → create or replace the change for that one date. For a move, the
//          new slot is checked for clashes first (409 code 'conflict' unless
//          force=true).
//   DELETE { id }             → undo: the session goes back to normal.
// Admin and super admin only.

// Groupings that aren't one physical room — several classes at once is normal.
const NON_PHYSICAL_ROOMS = ['online-duet-class', 'online-group-classes', 'online-one-to-one', 'pvt-group-class', 'pvt-one-to-one-class', 'school'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const t = hhmm => minutesToLabel(timeToMinutes(hhmm));
function prettyDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
const who = b => [b.batch || b.course || 'Class', b.teacher].filter(Boolean).join(' — ');

async function findConflicts({ blockId, roomId, date, start, end }) {
  if (NON_PHYSICAL_ROOMS.includes(roomId)) return [];
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  const spaces = ROOMS.find(r => r.id === roomId)?.spaces || 1;

  const sessions = (await loadClassesOnDate(date, roomId))
    .filter(c => String(c.id) !== String(blockId))
    .filter(c => timeToMinutes(c.start_time) < e && timeToMinutes(c.end_time) > s);

  const { data: bookings } = await supabaseAdmin
    .from('bookings').select('hour, minute, student_name')
    .eq('room_id', roomId).eq('date', date).in('status', ['pending', 'confirmed']);
  const clashingBookings = (bookings || []).filter(b => {
    const bs = b.hour * 60 + (b.minute || 0);
    return bs < e && bs + 30 > s;
  });

  // Rooms with several spaces (e.g. 2 rooms at a branch) only clash when full.
  const busy = sessions.length + (clashingBookings.length ? 1 : 0);
  if (busy < spaces) return [];

  const lines = sessions.map(c => `${t(c.start_time)}–${t(c.end_time)} ${who(c)}`);
  const names = [...new Set(clashingBookings.map(b => b.student_name))];
  if (names.length) lines.push(`booking by ${names.join(', ')}`);
  return lines;
}

export default async function handler(req, res) {
  const user = await getAdminUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to make changes.' });

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('class_exceptions').select('*').limit(5000);
    if (error) {
      // Table not created yet: behave as "no one-off changes".
      if (error.code === '42P01' || /class_exceptions/.test(error.message || '')) {
        return res.status(200).json({ exceptions: [], missingTable: true });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ exceptions: data });
  }

  if (user.role === 'staff') {
    return res.status(403).json({ error: 'Only an admin can change a single session.' });
  }

  if (req.method === 'POST') {
    const { block_id, original_date, status, note, force } = req.body || {};
    if (!block_id || !DATE_RE.test(String(original_date)) || !['moved', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Pick the class, its date, and whether to move or cancel it.' });
    }

    const { data: block } = await supabaseAdmin.from('recurring_blocks').select('*').eq('id', block_id).maybeSingle();
    if (!block) return res.status(404).json({ error: 'That class no longer exists. Refresh the page.' });
    if (block.day_of_week !== weekdayOfDateKey(original_date) || !blockAppliesOnDate(block, original_date)) {
      return res.status(400).json({ error: `This class doesn't run on ${prettyDate(original_date)}.` });
    }

    const row = {
      block_id,
      original_date,
      status,
      note: note ? String(note).slice(0, 300) : null,
      created_by: user.name,
      new_room_id: null, new_date: null, new_start: null, new_end: null,
    };

    if (status === 'moved') {
      const { new_date, new_start, new_end } = req.body;
      const new_room_id = req.body.new_room_id || block.room_id;
      if (!DATE_RE.test(String(new_date))) return res.status(400).json({ error: 'Pick the new date.' });
      if (!TIME_RE.test(String(new_start)) || !TIME_RE.test(String(new_end))) return res.status(400).json({ error: 'Pick the new start and end time.' });
      if (timeToMinutes(new_end) <= timeToMinutes(new_start)) return res.status(400).json({ error: 'End time must be after start time.' });
      if (!ROOMS.some(r => r.id === new_room_id)) return res.status(400).json({ error: 'Pick a valid room.' });
      Object.assign(row, { new_room_id, new_date, new_start, new_end });

      if (!force) {
        const conflicts = await findConflicts({ blockId: block.id, roomId: new_room_id, date: new_date, start: new_start, end: new_end });
        if (conflicts.length) {
          return res.status(409).json({
            code: 'conflict',
            error: `${roomName(new_room_id)} on ${prettyDate(new_date)} already has: ${conflicts.join('; ')}.`,
          });
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from('class_exceptions')
      .upsert([row], { onConflict: 'block_id,original_date' })
      .select();
    if (error) {
      if (error.code === '42P01' || /class_exceptions/.test(error.message || '')) {
        return res.status(500).json({ error: 'The database is missing the one-off changes table. Run migration-class-exceptions.sql in Supabase first.' });
      }
      return res.status(500).json({ error: error.message });
    }

    const was = `${roomName(block.room_id)}, ${prettyDate(original_date)} ${t(block.start_time)}–${t(block.end_time)}`;
    await logActivity({
      user, action: 'update', entity_type: 'class',
      summary: status === 'cancelled'
        ? `Cancelled one session of "${block.label || who(block)}" — ${was}${row.note ? ` (${row.note})` : ''}`
        : `Moved one session of "${block.label || who(block)}" — from ${was} to ${roomName(row.new_room_id)}, ${prettyDate(row.new_date)} ${t(row.new_start)}–${t(row.new_end)}${row.note ? ` (${row.note})` : ''}`,
    });

    return res.status(200).json({ exception: data[0] });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required.' });
    const { data: existing } = await supabaseAdmin.from('class_exceptions').select('*').eq('id', id).maybeSingle();
    const { error } = await supabaseAdmin.from('class_exceptions').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    if (existing) {
      const { data: block } = await supabaseAdmin.from('recurring_blocks').select('*').eq('id', existing.block_id).maybeSingle();
      if (block) {
        await logActivity({
          user, action: 'update', entity_type: 'class',
          summary: `Undid the one-off change to "${block.label || who(block)}" on ${prettyDate(existing.original_date)} — back to its usual ${roomName(block.room_id)}, ${t(block.start_time)}–${t(block.end_time)}`,
        });
      }
    }
    return res.status(200).json({ ok: true });
  }

  res.status(405).end();
}
