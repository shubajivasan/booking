import { supabaseAdmin } from './supabaseAdmin';
import { classesOnDate, weekdayOfDateKey, overlappingSpaces, spacesOverlap } from './schedule';

// Server-side: the regular-class sessions that actually happen on one date
// (optionally in one room), with one-off moves and cancellations applied.
// If the class_exceptions table doesn't exist yet (migration not run), this
// quietly falls back to the plain weekly schedule.
export async function loadClassesOnDate(dateKey, roomId = null) {
  const day = weekdayOfDateKey(dateKey);

  let exceptions = [];
  const exRes = await supabaseAdmin
    .from('class_exceptions')
    .select('*')
    .or(`original_date.eq.${dateKey},new_date.eq.${dateKey}`);
  if (!exRes.error) exceptions = exRes.data || [];

  let q = supabaseAdmin.from('recurring_blocks').select('*').eq('day_of_week', day);
  // For AAPA Hall, classes in any overlapping partition/combination count too.
  if (roomId) q = q.in('room_id', overlappingSpaces(roomId));
  const { data: weekly, error } = await q;
  if (error) throw new Error(error.message);

  // Classes moved onto this date from another weekday/room aren't in the
  // query above — fetch them by id.
  const have = new Set((weekly || []).map(b => String(b.id)));
  const missing = exceptions
    .filter(e => e.status === 'moved' && e.new_date === dateKey && !have.has(String(e.block_id)))
    .map(e => e.block_id);
  let extra = [];
  if (missing.length) {
    const { data } = await supabaseAdmin.from('recurring_blocks').select('*').in('id', missing);
    extra = data || [];
  }

  const sessions = classesOnDate([...(weekly || []), ...extra], exceptions, dateKey);
  return roomId ? sessions.filter(s => spacesOverlap(s.room_id, roomId)) : sessions;
}
