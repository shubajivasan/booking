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
  { id: 'BH', name: 'Basement Hall' },
  { id: 'GTR', name: 'Guitar Room' },
  { id: 'KEY', name: 'Keyboard Room' },
  { id: 'DRM', name: 'Drum Room' },
  { id: 'MLB', name: 'Music Lab Room' },
  { id: 'andheri-west', name: 'Andheri West' },
  { id: 'bengaluru-jayanagar-group', name: 'Bengaluru Jayanagar  Group' },
  { id: 'bengaluru-jayanagar-pvt', name: 'Bengaluru Jayanagar PVT' },
  { id: 'bengaluru-sahakarnagar-duet', name: 'Bengaluru Sahakarnagar Duet' },
  { id: 'bengaluru-sahakarnagar-pvt-one-to-one', name: 'Bengaluru Sahakarnagar PVT One to One' },
  { id: 'chembur', name: 'Chembur' },
  { id: 'kalyan', name: 'Kalyan' },
  { id: 'kandivali-east', name: 'Kandivali East' },
  { id: 'kandivali-west', name: 'Kandivali West' },
  { id: 'kempscorner', name: 'KempsCorner' },
  { id: 'lalbaug', name: 'Lalbaug' },
  { id: 'malad-west', name: 'Malad West' },
  { id: 'miraroad', name: 'Miraroad' },
  { id: 'online-duet-class', name: 'Online Duet Class' },
  { id: 'online-group-classes', name: 'Online Group Classes' },
  { id: 'online-one-to-one', name: 'Online One to One' },
  { id: 'pvt-group-class', name: 'PVT Group Class' },
  { id: 'powai', name: 'Powai' },
  { id: 'powai-nis', name: 'Powai NIS' },
  { id: 'prabhadevi', name: 'Prabhadevi' },
  { id: 'pvt-one-to-one-class', name: 'Pvt One to One Class' },
  { id: 'school', name: 'School' },
  { id: 'thane-dosti', name: 'Thane Dosti' },
  { id: 'thane-panch-pakhdi', name: 'Thane Panch Pakhdi' },
  { id: 'thane-pokhran', name: 'Thane Pokhran' },
];

export function timeToMinutes(t) {
  const [hh, mm] = t.split(':').map(Number);
  return hh * 60 + mm;
}

// An hour slot [h:00, h+1:00) is blocked by a recurring class if their
// ranges overlap at all — standard interval overlap check.
export function hourOverlapsBlock(h, block) {
  const slotStart = h * 60;
  const slotEnd = (h + 1) * 60;
  const blockStart = timeToMinutes(block.start_time);
  const blockEnd = timeToMinutes(block.end_time);
  return blockStart < slotEnd && blockEnd > slotStart;
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
