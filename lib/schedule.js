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
];

// Spaces allocated by management: a student can't book these directly —
// their booking is saved as a 'pending' request and only becomes
// 'confirmed' once an admin approves it in the dashboard's Requests tab.
// To add or remove a room from this list, just edit the ids here.
export const APPROVAL_ROOMS = ['R9', 'R10', 'BH'];

export function requiresApproval(roomId) {
  return APPROVAL_ROOMS.includes(roomId);
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
