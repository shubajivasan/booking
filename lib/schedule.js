export const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const ROOMS = [
  { id: 'R1', name: 'Room No 1' },
  { id: 'R2', name: 'Room No 2' },
  { id: 'R3', name: 'Room No 3' },
  { id: 'R4', name: 'Room No 4' },
  { id: 'R5', name: 'Room No 5' },
  { id: 'R6', name: 'Room No 6' },
  { id: 'R7', name: 'Room No 7' },
  { id: 'R8', name: 'Room No 8' },
  { id: 'R9', name: 'Room No 9' },
  { id: 'R10', name: 'Room No 10' },
  { id: 'BH', name: 'Studio D' }, // formerly "Basement Hall" (id kept, so old data still matches)
  { id: 'GTR', name: 'Guitar Room' },
  { id: 'KEY', name: 'Keyboard Room' },
  { id: 'DRM', name: 'Drum Room' },
  { id: 'MLB', name: 'Music Lab Room' },
  // Other branches — reference-only. Their classes show in the admin
  // dashboard (filters, schedules, add/edit class), but they're never
  // offered for student bookings: the public site has its own room list in
  // components/BookingApp.js, and booking reschedules/approvals only use
  // BOOKABLE_ROOMS below.
  { id: 'andheri-west', name: 'Andheri West', branch: true },
  // spaces: how many classes can run at the same time there (default 1).
  // The Clash check only flags a clash when more classes overlap than this.
  { id: 'bengaluru-jayanagar-group', name: 'Bengaluru Jayanagar  Group', branch: true, spaces: 2 },
  { id: 'bengaluru-jayanagar-pvt', name: 'Bengaluru Jayanagar PVT', branch: true },
  { id: 'bengaluru-sahakarnagar-duet', name: 'Bengaluru Sahakarnagar Duet', branch: true },
  { id: 'bengaluru-sahakarnagar-pvt-one-to-one', name: 'Bengaluru Sahakarnagar PVT One to One', branch: true },
  { id: 'chembur', name: 'Chembur', branch: true },
  { id: 'kalyan', name: 'Kalyan', branch: true },
  { id: 'kandivali-east', name: 'Kandivali East', branch: true },
  { id: 'kandivali-west', name: 'Kandivali West', branch: true, spaces: 2 },
  { id: 'kempscorner', name: 'KempsCorner', branch: true },
  { id: 'lalbaug', name: 'Lalbaug', branch: true },
  { id: 'malad-west', name: 'Malad West', branch: true, spaces: 2 },
  { id: 'miraroad', name: 'Miraroad', branch: true },
  { id: 'online-duet-class', name: 'Online Duet Class', branch: true },
  { id: 'online-group-classes', name: 'Online Group Classes', branch: true },
  { id: 'online-one-to-one', name: 'Online One to One', branch: true },
  { id: 'pvt-group-class', name: 'PVT Group Class', branch: true },
  { id: 'powai', name: 'Powai', branch: true },
  { id: 'powai-nis', name: 'Powai NIS', branch: true },
  { id: 'prabhadevi', name: 'Prabhadevi', branch: true },
  { id: 'pvt-one-to-one-class', name: 'Pvt One to One Class', branch: true },
  { id: 'school', name: 'School', branch: true },
  { id: 'thane-dosti', name: 'Thane Dosti', branch: true },
  { id: 'thane-panch-pakhdi', name: 'Thane Panch Pakhdi', branch: true },
  { id: 'thane-pokhran', name: 'Thane Pokhran', branch: true },
];

// This branch's own spaces — the only ones a student booking can be in.
// ---------- AAPA Hall: one hall, 4 partitions ----------
// Every possible choice (a single partition, any combination, or the whole
// hall) is its own space id, so a booking or class always has ONE room id
// and every existing feature (requests, edit timing, reschedule, clash
// check, assistant) keeps working. Ids:
//   'AAPA-1' … 'AAPA-4'   single partitions
//   'AAPA-12', 'AAPA-134' … combinations (digits = partitions)
//   'AAPA'                 the whole hall (all 4 partitions)
// Two AAPA spaces clash when they share any partition. The database
// enforces this for bookings too (migration-aapa-hall.sql).
export const AAPA_PARTS = ['1', '2', '3', '4'];
export const AAPA_SEATS_PER_PARTITION = 20; // placeholder; change when known

export function aapaRoomId(parts) {
  const p = [...new Set(parts.map(String))].filter(x => AAPA_PARTS.includes(x)).sort();
  if (p.length === 0) return null;
  return p.length === 4 ? 'AAPA' : `AAPA-${p.join('')}`;
}

// '1234' for the whole hall, '13' for partitions 1+3, null for non-AAPA rooms.
export function hallParts(roomId) {
  if (roomId === 'AAPA') return '1234';
  const m = /^AAPA-([1-4]+)$/.exec(String(roomId || ''));
  return m ? m[1] : null;
}

function aapaName(parts) {
  if (parts.length === 4) return 'AAPA Hall (whole hall)';
  if (parts.length === 1) return `AAPA Hall \u2013 Partition ${parts}`;
  return `AAPA Hall \u2013 Partitions ${parts.split('').join(' + ')}`;
}

// All 15 choices, singles first, whole hall last.
const AAPA_ROOMS = [];
for (let mask = 1; mask < 16; mask++) {
  const parts = AAPA_PARTS.filter((_, i) => mask & (1 << i)).join('');
  AAPA_ROOMS.push({
    id: aapaRoomId(parts.split('')),
    name: aapaName(parts),
    hall: 'AAPA',
    parts,
    capacity: parts.length * AAPA_SEATS_PER_PARTITION,
  });
}
AAPA_ROOMS.sort((a, b) => (a.parts.length === 4) - (b.parts.length === 4) || a.parts.length - b.parts.length || a.parts.localeCompare(b.parts));
ROOMS.splice(ROOMS.findIndex(r => r.id === 'MLB') + 1, 0, ...AAPA_ROOMS);
export const AAPA_ROOM_IDS = AAPA_ROOMS.map(r => r.id);

// True when two spaces can't be used at the same time: the same room, or
// two AAPA Hall choices that share a partition.
export function spacesOverlap(a, b) {
  if (a === b) return true;
  const pa = hallParts(a);
  const pb = hallParts(b);
  if (!pa || !pb) return false;
  return [...pa].some(ch => pb.includes(ch));
}

// Every space id that overlaps this one (itself included).
export function overlappingSpaces(roomId) {
  return hallParts(roomId) ? AAPA_ROOM_IDS.filter(id => spacesOverlap(id, roomId)) : [roomId];
}

export const BOOKABLE_ROOMS = ROOMS.filter(r => !r.branch);

// Spaces allocated by management: a student can't book these directly —
// their booking is saved as a 'pending' request and only becomes
// 'confirmed' once an admin approves it in the dashboard's Requests tab.
// To add or remove a room from this list, just edit the ids here.
// AAPA Hall (every partition / combination) is always by request too.
export const APPROVAL_ROOMS = ['R9', 'R10', 'BH'];

export function requiresApproval(roomId) {
  return APPROVAL_ROOMS.includes(roomId) || Boolean(hallParts(roomId));
}

export function timeToMinutes(t) {
  const [hh, mm] = t.split(':').map(Number);
  return hh * 60 + mm;
}

// A 1-hour slot starting at startMinutes (minutes-from-midnight, e.g. 630
// for 10:30) is blocked by a recurring class if their ranges overlap at
// all — standard interval overlap check. durationMinutes lets this check
// any length slot, though every student booking is a fixed 1 hour today.
export function slotOverlapsBlock(startMinutes, durationMinutes, block) {
  const slotEnd = startMinutes + durationMinutes;
  const blockStart = timeToMinutes(block.start_time);
  const blockEnd = timeToMinutes(block.end_time);
  return blockStart < slotEnd && blockEnd > startMinutes;
}

// Kept for any code still checking a plain whole-hour slot.
export function hourOverlapsBlock(h, block) {
  return slotOverlapsBlock(h * 60, 60, block);
}

// Every valid 30-minute slot start in a day, in minutes-from-midnight:
// every hour AND its half-hour, including the very last half-hour before
// closing (e.g. 8:30pm–9pm when 20 is the last hour), since each slot is
// its own 30-minute block rather than implicitly reserving a full hour.
export function validSlotStarts(hours) {
  const starts = [];
  hours.forEach(h => { starts.push(h * 60); starts.push(h * 60 + 30); });
  return starts.sort((a, b) => a - b);
}

export function minutesToLabel(mins) {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  let d = h % 12;
  if (d === 0) d = 12;
  return m === 0 ? `${d}${ap}` : `${d}:${String(m).padStart(2, '0')}${ap}`;
}

export function fmtHour(h) {
  const ap = h >= 12 ? 'pm' : 'am';
  let d = h % 12;
  if (d === 0) d = 12;
  return d + ap;
}

export function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function startOfWeek(date) {
  // Monday as the first day of the week
  const d = new Date(date);
  const day = d.getDay(); // 0=Sunday..6=Saturday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Names a super admin has changed in the Spaces tab (stored in the
// space_details table). Applied in place so every list, filter and message
// that reads ROOMS shows the new name; ids never change, so old bookings and
// classes still match. Renaming AAPA Hall renames its partitions too.
const DEFAULT_ROOM_NAMES = Object.fromEntries(ROOMS.map(r => [r.id, r.name]));
export function applySpaceNames(names = {}) {
  ROOMS.forEach(r => {
    const def = DEFAULT_ROOM_NAMES[r.id];
    if (r.hall === 'AAPA') r.name = names.AAPA ? def.replace(/^AAPA Hall/, names.AAPA) : def;
    else r.name = names[r.id] || def;
  });
}

export function roomName(id) {
  const r = ROOMS.find(x => x.id === id);
  return r ? r.name : id;
}

// A recurring block always applies on its day_of_week. If start_date and/or
// end_date are set, it additionally only applies within that date range —
// both blank means "ongoing, no end in sight" (the default for classes
// that were never given a range).
export function blockAppliesOnDate(block, dateKey) {
  if (block.start_date && dateKey < block.start_date) return false;
  if (block.end_date && dateKey > block.end_date) return false;
  return true;
}

// ---------- one-off changes to a single session of a regular class ----------
// A row in `class_exceptions` changes ONE date of a weekly class:
//   status 'cancelled' → the class doesn't happen on original_date
//   status 'moved'     → it doesn't happen on original_date; instead it
//                        happens on new_date, new_start–new_end, in new_room_id
// Every other week is untouched.

export function weekdayOfDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
}

// Which regular-class sessions happen on dateKey, after one-off changes.
// Returns block-shaped objects (room/time already switched for moved
// sessions). With includeInactive, sessions that were cancelled or moved
// AWAY from this date are also returned, marked inactive (for display).
// Each returned session may carry:
//   exception      — the class_exceptions row that affects it
//   exceptionKind  — 'moved-here' | 'moved-away' | 'cancelled'
export function classesOnDate(blocks, exceptions, dateKey, { includeInactive = false } = {}) {
  const day = weekdayOfDateKey(dateKey);
  const exceptionFor = new Map();
  (exceptions || []).forEach(e => exceptionFor.set(`${e.block_id}|${e.original_date}`, e));
  const blockById = new Map(blocks.map(b => [String(b.id), b]));

  const out = [];
  blocks.forEach(b => {
    if (b.day_of_week !== day || !blockAppliesOnDate(b, dateKey)) return;
    const ex = exceptionFor.get(`${b.id}|${dateKey}`);
    if (!ex) { out.push(b); return; }
    if (includeInactive) {
      out.push({ ...b, exception: ex, exceptionKind: ex.status === 'cancelled' ? 'cancelled' : 'moved-away', inactive: true });
    }
  });
  (exceptions || []).forEach(e => {
    if (e.status !== 'moved' || e.new_date !== dateKey) return;
    const b = blockById.get(String(e.block_id));
    if (!b) return;
    out.push({
      ...b,
      room_id: e.new_room_id || b.room_id,
      start_time: e.new_start,
      end_time: e.new_end,
      exception: e,
      exceptionKind: 'moved-here',
    });
  });
  return out;
}

// ---------- groups for the room filter ----------
// Every space belongs to exactly one group. Used by the admin dashboard's
// room filter (one-click group buttons and headings in the list).
export const ROOM_GROUPS = [
  {
    id: 'juhu',
    name: 'Juhu Branch',
    // AAPA Hall: the whole hall + the 4 single partitions are listed; filtering
    // by any of them also shows combinations that use those partitions.
    rooms: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'BH', 'DRM', 'GTR', 'KEY', 'MLB', 'AAPA', 'AAPA-1', 'AAPA-2', 'AAPA-3', 'AAPA-4'],
  },
  {
    id: 'academy',
    name: 'Academy branches',
    rooms: [
      'andheri-west', 'chembur', 'kalyan', 'kandivali-east', 'kandivali-west', 'kempscorner', 'lalbaug',
      'malad-west', 'miraroad', 'powai', 'powai-nis', 'prabhadevi', 'thane-dosti', 'thane-panch-pakhdi', 'thane-pokhran',
    ],
  },
  {
    id: 'online',
    name: 'Online / Home Tuitions',
    rooms: ['pvt-one-to-one-class', 'pvt-group-class', 'online-one-to-one', 'online-group-classes', 'online-duet-class'],
  },
  {
    id: 'schools',
    name: 'Schools',
    rooms: ['school'],
  },
  {
    id: 'bengaluru',
    name: 'Bengaluru',
    rooms: ['bengaluru-jayanagar-group', 'bengaluru-jayanagar-pvt', 'bengaluru-sahakarnagar-duet', 'bengaluru-sahakarnagar-pvt-one-to-one'],
  },
];
