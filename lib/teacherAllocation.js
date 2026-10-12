import { classesOnDate, timeToMinutes, roomName, ROOM_GROUPS, hallParts } from './schedule';

// Teacher allocation: for each teacher, the regular-class sessions they have
// in a period (one-off moves and cancellations applied), with total hours,
// number of sessions, batches, where they teach and which class types.

export const NO_TEACHER = '(No teacher)';

function inGroup(roomId, groupId) {
  if (!groupId || groupId === 'all') return true;
  const g = ROOM_GROUPS.find(x => x.id === groupId);
  if (!g) return true;
  if (g.rooms.includes(roomId)) return true;
  // Any AAPA Hall combination belongs wherever AAPA Hall does.
  return Boolean(hallParts(roomId)) && g.rooms.includes('AAPA');
}

// Location shown for a room: AAPA partitions roll up to "AAPA Hall".
function locationName(roomId) {
  return hallParts(roomId) ? 'AAPA Hall' : roomName(roomId);
}

export function computeTeacherAllocation({ blocks, exceptions, dates, group = 'all', classType = 'all' }) {
  const byTeacher = new Map();
  for (const date of dates) {
    for (const c of classesOnDate(blocks || [], exceptions || [], date)) {
      if (!inGroup(c.room_id, group)) continue;
      const type = c.class_type || 'Not set';
      if (classType !== 'all' && type !== classType) continue;
      const name = (c.teacher || '').trim() || NO_TEACHER;
      const start = timeToMinutes(c.start_time);
      const end = timeToMinutes(c.end_time);
      const minutes = Math.max(0, end - start);
      if (!byTeacher.has(name)) {
        byTeacher.set(name, { name, minutes: 0, sessions: 0, batches: new Set(), byLocation: {}, byType: {}, byDate: {}, items: [] });
      }
      const t = byTeacher.get(name);
      t.minutes += minutes;
      t.sessions += 1;
      t.batches.add(c.batch || c.course || c.label || 'Class');
      const loc = locationName(c.room_id);
      t.byLocation[loc] = (t.byLocation[loc] || 0) + minutes;
      t.byType[type] = (t.byType[type] || 0) + minutes;
      t.byDate[date] = (t.byDate[date] || 0) + minutes;
      t.items.push({
        date, start, end, minutes, room: roomName(c.room_id), location: loc,
        batch: c.batch || '', course: c.course || '', type, moved: Boolean(c.exception),
      });
    }
  }
  // Sessions of the same teacher that overlap in time on the same date
  // (two places at once). "(No teacher)" is skipped.
  const clashesOf = t => {
    if (t.name === NO_TEACHER) return [];
    const out = [];
    const items = [...t.items].sort((x, y) => x.date.localeCompare(y.date) || x.start - y.start);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length && items[j].date === items[i].date && items[j].start < items[i].end; j++) {
        out.push([items[i], items[j]]);
      }
    }
    return out;
  };
  const teachers = [...byTeacher.values()].map(t => ({
    ...t,
    clashes: clashesOf(t),
    batchCount: t.batches.size,
    batches: [...t.batches].sort(),
    locations: Object.entries(t.byLocation).sort((a, b) => b[1] - a[1]),
    types: Object.entries(t.byType).sort((a, b) => b[1] - a[1]),
    items: t.items.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start),
  }));
  const minutes = teachers.reduce((a, t) => a + t.minutes, 0);
  const sessions = teachers.reduce((a, t) => a + t.sessions, 0);
  return { teachers, totals: { minutes, sessions, teachers: teachers.filter(t => t.name !== NO_TEACHER).length } };
}
