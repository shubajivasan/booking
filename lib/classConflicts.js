import { supabaseAdmin } from './supabaseAdmin';
import { loadClassesOnDate } from './classOccurrences';
import { timeToMinutes, minutesToLabel, overlappingSpaces, weekdayOfDateKey, roomName } from './schedule';
import { slotsLabel } from './bookingEmails';

// Bookings and regular classes must not overlap. The database already stops
// two bookings taking the same slot; these checks cover booking-vs-class,
// from both directions:
//   classesOverlapping()          a booking's new time vs regular classes
//   bookingsOverlappingClass()    a new/edited class vs upcoming bookings

const who = c => [c.batch || c.course || 'Class', c.teacher].filter(Boolean).join(' — ');
const t = hhmm => minutesToLabel(timeToMinutes(hhmm));

function prettyDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function todayIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Regular-class sessions in this space on this date that overlap
// [start, end) (minutes from midnight), one-off moves/cancellations applied.
// Returns readable lines, e.g. "2pm–3:30pm DJ - Krutarth Goradia — Amit Shah".
export async function classesOverlapping(roomId, date, start, end) {
  const sessions = await loadClassesOnDate(date, roomId);
  return sessions
    .filter(c => timeToMinutes(c.start_time) < end && timeToMinutes(c.end_time) > start)
    .map(c => `${t(c.start_time)}–${t(c.end_time)} ${who(c)}`);
}

// Same, for a list of 30-minute slot starts (they needn't be back to back).
export async function classesOverlappingSlots(roomId, date, slots) {
  const sessions = await loadClassesOnDate(date, roomId);
  return sessions
    .filter(c => slots.some(s => timeToMinutes(c.start_time) < s + 30 && timeToMinutes(c.end_time) > s))
    .map(c => `${t(c.start_time)}\u2013${t(c.end_time)} ${who(c)}`);
}

// Upcoming bookings and pending requests (today onwards) that a regular class
// would sit on top of. `cls` = { id?, room_id, days | day_of_week, start_time,
// end_time, start_date, end_date }. Dates where this class is cancelled or
// moved away for that day only are skipped. Returns readable lines.
export async function bookingsOverlappingClass(cls, { ignoreIds = [] } = {}) {
  const days = Array.isArray(cls.days) && cls.days.length ? cls.days : [cls.day_of_week];
  const start = timeToMinutes(cls.start_time);
  const end = timeToMinutes(cls.end_time);
  const from = cls.start_date && cls.start_date > todayIST() ? cls.start_date : todayIST();

  let q = supabaseAdmin
    .from('bookings').select('id, room_id, date, hour, minute, student_name, purpose, status')
    .in('room_id', overlappingSpaces(cls.room_id)).in('status', ['pending', 'confirmed'])
    .gte('date', from).order('date').limit(5000);
  if (cls.end_date) q = q.lte('date', cls.end_date);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let skipDates = new Set();
  if (cls.id) {
    const ex = await supabaseAdmin.from('class_exceptions').select('original_date, status').eq('block_id', cls.id);
    if (!ex.error) skipDates = new Set((ex.data || []).map(e => e.original_date));
  }
  const ignore = new Set(ignoreIds.map(String));

  const hits = (data || []).filter(b => {
    if (ignore.has(String(b.id)) || skipDates.has(b.date)) return false;
    if (!days.includes(weekdayOfDateKey(b.date))) return false;
    const s = b.hour * 60 + (b.minute || 0);
    return s < end && s + 30 > start;
  });

  // One line per booking (its slots on that date merged).
  const groups = new Map();
  hits.forEach(b => {
    const key = `${b.date}|${b.room_id}|${b.student_name}|${b.purpose || ''}|${b.status}`;
    if (!groups.has(key)) groups.set(key, { ...b, starts: [] });
    groups.get(key).starts.push(b.hour * 60 + (b.minute || 0));
  });
  return [...groups.values()].map(g =>
    `${prettyDate(g.date)} ${slotsLabel(g.starts)} ${g.student_name}${g.purpose ? ` (${g.purpose})` : ''}${g.status === 'pending' ? ' [request]' : ''}${g.room_id !== cls.room_id ? ` in ${roomName(g.room_id)}` : ''}`
  );
}

export function listForMessage(lines, max = 6) {
  return lines.length > max
    ? `${lines.slice(0, max).join('; ')}; and ${lines.length - max} more`
    : lines.join('; ');
}
