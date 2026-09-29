import { ROOMS, DAY_NAMES, timeToMinutes, minutesToLabel, blockAppliesOnDate, roomName } from './schedule';

// Read-only schedule lookups used by the admin Assistant (pages/api/admin/assistant.js).
// Pure functions: they take already-loaded classes (recurring_blocks rows) and
// bookings rows, so they're easy to test and never touch the database.

// Groupings that aren't a single physical room (online / private / school).
// Their entries matter for teachers' timetables, but "is this room free"
// doesn't apply to them.
export const NON_PHYSICAL_ROOMS = ['online-duet-class', 'online-group-classes', 'online-one-to-one', 'pvt-group-class', 'pvt-one-to-one-class', 'school'];

export const DAY_OPEN = 9 * 60;   // this branch's public hours, 9am
export const DAY_CLOSE = 21 * 60; // 9pm

function norm(s) {
  return String(s || '').toLowerCase().replace(/\bno\b\.?/g, '').replace(/[^a-z0-9]/g, '');
}

// "room 10", "Room No 10", "R10", "basement" → the matching ROOMS entry.
export function resolveRoom(query) {
  const q = norm(query);
  if (!q) return null;
  return ROOMS.find(r => norm(r.id) === q || norm(r.name) === q)
    || ROOMS.find(r => norm(r.name).startsWith(q))
    || ROOMS.find(r => norm(r.name).includes(q))
    || null;
}

// "ansh" → every distinct teacher name containing it ("Ansh", "Ansh Kumar"),
// so a class under a longer spelling is never missed. If several different
// people match, the tool result warns and the assistant asks which one.
export function resolveTeachers(query, blocks) {
  const q = norm(query);
  if (!q) return [];
  const names = [...new Set(blocks.map(b => b.teacher).filter(Boolean))];
  // Match whole names or the start of a word, so "ansh" finds "Ansh Kumar"
  // but not "Hansh" (a different person, offered only as a suggestion).
  return names.filter(n => {
    const words = String(n).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return norm(n) === q || norm(n).startsWith(q) || words.some(w => w.startsWith(q))
      || (norm(n).length >= 3 && q.startsWith(norm(n)));
  });
}

// Letters that differ between two words (typo distance).
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// Teacher names that look like the query, best first: exact, starts with,
// contains, then close spellings ("Anssh" → "Ansh", "Shradha" → "Shraddha").
// Each comes with where and what they teach, so similar names can be told
// apart.
export function suggestTeachers(query, blocks, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const byName = new Map();
  blocks.forEach(b => {
    if (!b.teacher) return;
    if (!byName.has(b.teacher)) byName.set(b.teacher, { rooms: new Set(), courses: new Set(), classes: 0 });
    const info = byName.get(b.teacher);
    info.rooms.add(roomName(b.room_id));
    if (b.course) info.courses.add(b.course);
    info.classes += 1;
  });

  const scored = [];
  byName.forEach((info, name) => {
    const n = norm(name);
    const words = String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let score = null;
    if (n === q) score = 0;
    else if (n.startsWith(q) || words.some(w => w.startsWith(q))) score = 1;
    else if (n.includes(q)) score = 2;
    else {
      const allowed = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
      const best = Math.min(editDistance(q, n), ...words.map(w => editDistance(q, w)));
      if (allowed && best <= allowed) score = 3 + best;
    }
    if (score === null) return;
    scored.push({
      score,
      name,
      teaches: [...info.courses].slice(0, 4).join(', ') || 'no course recorded',
      at: [...info.rooms].slice(0, 4).join(', '),
      regular_classes: info.classes,
    });
  });
  return scored
    .sort((a, b) => a.score - b.score || b.regular_classes - a.regular_classes || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ score, ...rest }) => ({ ...rest, match: score === 0 ? 'exact' : score <= 2 ? 'contains' : 'similar spelling' }));
}

export function searchTeachers({ name }, blocks) {
  const matches = suggestTeachers(name, blocks);
  return matches.length
    ? { query: name, matches }
    : { query: name, matches: [], note: 'No teacher with a similar name is in the class schedule.' };
}

export function weekdayOf(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
}

function classLabel(b) {
  return [b.batch || b.course || 'Class', b.teacher].filter(Boolean).join(' — ');
}

// Everything happening in one room on one date: regular classes and
// active (pending or confirmed) bookings, as time ranges.
export function roomItems(roomId, dateKey, blocks, bookings) {
  const day = weekdayOf(dateKey);
  const items = [];
  blocks
    .filter(b => b.room_id === roomId && b.day_of_week === day && blockAppliesOnDate(b, dateKey))
    .forEach(b => items.push({
      kind: 'class',
      start: timeToMinutes(b.start_time),
      end: timeToMinutes(b.end_time),
      label: classLabel(b),
    }));

  // Bookings are one row per 30-min slot; merge back-to-back slots of the
  // same person into one range.
  const rows = bookings
    .filter(bk => bk.room_id === roomId && bk.date === dateKey && ['pending', 'confirmed'].includes(bk.status))
    .map(bk => ({ ...bk, s: bk.hour * 60 + (bk.minute || 0) }))
    .sort((a, b) => (a.email || '').localeCompare(b.email || '') || a.s - b.s);
  let cur = null;
  rows.forEach(bk => {
    if (cur && cur.email === bk.email && cur.status === bk.status && cur.end === bk.s) { cur.end += 30; return; }
    cur = {
      kind: bk.status === 'pending' ? 'pending request' : 'booking',
      start: bk.s, end: bk.s + 30, email: bk.email, status: bk.status,
      label: `${bk.student_name || 'Student'}${bk.purpose ? ` — ${bk.purpose}` : ''}`,
    };
    items.push(cur);
  });
  return items.sort((a, b) => a.start - b.start);
}

// Free windows between `from` and `to`, allowing `spaces` things at once
// (most rooms 1; some branches have 2 rooms).
export function freeWindows(items, from, to, spaces = 1) {
  const points = [...new Set([from, to, ...items.flatMap(i => [i.start, i.end])])]
    .filter(t => t >= from && t <= to)
    .sort((a, b) => a - b);
  const windows = [];
  for (let k = 0; k < points.length - 1; k++) {
    const t0 = points[k];
    const t1 = points[k + 1];
    const busy = items.filter(i => i.start < t1 && i.end > t0).length;
    if (busy < spaces) {
      const last = windows[windows.length - 1];
      if (last && last.end === t0) last.end = t1;
      else windows.push({ start: t0, end: t1 });
    }
  }
  return windows;
}

const range = (s, e) => `${minutesToLabel(s)}–${minutesToLabel(e)}`;

function describeItems(items) {
  return items.map(i => `${range(i.start, i.end)}: ${i.kind} — ${i.label}`);
}

// ---- Tool implementations. Each returns a plain object the AI reads. ----

export function checkRoom({ room, date, start_time, end_time }, blocks, bookings) {
  const r = resolveRoom(room);
  if (!r) return { error: `No room or branch matches "${room}". Known spaces: ${ROOMS.map(x => x.name).join(', ')}` };
  const spaces = r.spaces || 1;
  const items = roomItems(r.id, date, blocks, bookings);
  if (NON_PHYSICAL_ROOMS.includes(r.id)) {
    return {
      room: r.name,
      date,
      weekday: weekdayOf(date),
      note: 'This is a grouping (online / private / school classes), not a physical room \u2014 many classes can run at once, so there is no "free" or "busy". Below is everything scheduled in it that day.',
      schedule: items.length ? describeItems(items) : ['Nothing scheduled.'],
    };
  }
  const result = {
    room: r.name,
    date,
    weekday: weekdayOf(date),
    rooms_at_this_space: spaces,
    note: r.branch
      ? 'Other branch: only regular classes are recorded here, so "free" means no class is scheduled.'
      : 'This branch is open 9am–9pm. Includes regular classes, confirmed bookings and pending booking requests.',
    schedule: items.length ? describeItems(items) : ['Nothing scheduled.'],
  };

  if (start_time && end_time) {
    const s = timeToMinutes(start_time);
    const e = timeToMinutes(end_time);
    const clashing = items.filter(i => i.start < e && i.end > s);
    result.asked_for = range(s, e);
    result.available = clashing.length < spaces;
    result.clashing_with = describeItems(clashing);
    if (!r.branch && (s < DAY_OPEN || e > DAY_CLOSE)) {
      result.warning = 'Part of this time is outside public hours (9am–9pm): students cannot book it online, but an admin can approve it.';
    }
  }

  const from = r.branch ? 7 * 60 : DAY_OPEN;
  const to = r.branch ? 22 * 60 : DAY_CLOSE;
  result.free_windows = freeWindows(items, from, to, spaces).map(w => range(w.start, w.end));
  return result;
}

export function findFreeRooms({ date, start_time, end_time, include_other_branches }, blocks, bookings) {
  const s = timeToMinutes(start_time);
  const e = timeToMinutes(end_time);
  const free = [];
  const busy = [];
  ROOMS
    .filter(r => (include_other_branches || !r.branch) && !NON_PHYSICAL_ROOMS.includes(r.id))
    .forEach(r => {
      const clashing = roomItems(r.id, date, blocks, bookings).filter(i => i.start < e && i.end > s);
      if (clashing.length < (r.spaces || 1)) free.push(r.name);
      else busy.push(`${r.name} (${describeItems(clashing).join('; ')})`);
    });
  return {
    date,
    weekday: weekdayOf(date),
    time: range(s, e),
    free_spaces: free,
    busy_spaces: busy,
    note: 'Room No 9, Room No 10 and Basement Hall are booked by request (admin approval), even when free.',
  };
}

export function teacherSchedule({ teacher, date, start_time, end_time }, blocks) {
  const names = resolveTeachers(teacher, blocks);
  if (names.length === 0) {
    const close = suggestTeachers(teacher, blocks);
    return close.length
      ? { error: `No teacher named "${teacher}". Did you mean one of these?`, did_you_mean: close }
      : { error: `No teacher named like "${teacher}" is in the class schedule.` };
  }
  const day = weekdayOf(date);
  const classes = blocks
    .filter(b => names.includes(b.teacher) && b.day_of_week === day && blockAppliesOnDate(b, date))
    .map(b => ({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time), label: `${b.batch || b.course || 'Class'} in ${roomName(b.room_id)}` }))
    .sort((a, b) => a.start - b.start);

  const result = {
    teacher_names_matched: names,
    date,
    weekday: day,
    classes: classes.length ? classes.map(c => `${range(c.start, c.end)}: ${c.label}`) : ['No regular classes that day.'],
    note: 'Based on regular classes across all branches, including online and private one-to-one students. One-time bookings are not linked to teachers, so they are not included.',
  };
  if (names.length > 1) {
    result.warning = `Several teacher names matched. The classes above include all of them — if they are different people, list them and ask which one is meant.`;
    result.did_you_mean = suggestTeachers(teacher, blocks).filter(t => names.includes(t.name));
  }
  if (start_time && end_time) {
    const s = timeToMinutes(start_time);
    const e = timeToMinutes(end_time);
    const clashing = classes.filter(c => c.start < e && c.end > s);
    result.asked_for = range(s, e);
    result.available = clashing.length === 0;
    result.clashing_with = clashing.map(c => `${range(c.start, c.end)}: ${c.label}`);
  }
  result.free_windows_7am_to_10pm = freeWindows(classes, 7 * 60, 22 * 60, 1).map(w => range(w.start, w.end));
  return result;
}
