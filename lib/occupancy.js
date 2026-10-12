import { ROOMS, BOOKABLE_ROOMS, classesOnDate, timeToMinutes, hallParts, roomName } from './schedule';

// Occupancy % of spaces between 9am and 9pm.
//
// For every space and day, each minute from 9:00 to 21:00 counts as used if a
// regular class (one-off moves/cancellations applied) or a confirmed booking
// covers it. Overlapping class + booking minutes are counted once, with the
// class taking the credit. Occupancy = used minutes / available minutes.
//
// Special cases:
// - AAPA Hall: its 4 partitions are 4 units. "Partitions 1 + 2" uses 2 of
//   them; the whole hall uses all 4. AAPA Hall's % = partition-minutes used /
//   (4 × minutes open).
// - Branches marked with 2 rooms (spaces: 2) have 2 units: two classes at
//   once fill it, one class is 50%.
// - Pending requests aren't counted (not confirmed yet).

export const OPEN_MIN = 9 * 60;
export const CLOSE_MIN = 21 * 60;
const SPAN = CLOSE_MIN - OPEN_MIN; // 720 minutes

// Groupings that aren't one physical room.
export const NON_PHYSICAL = ['online-duet-class', 'online-group-classes', 'online-one-to-one', 'pvt-group-class', 'pvt-one-to-one-class', 'school'];

// The spaces the report covers: the academy's own spaces (one row for AAPA
// Hall), optionally followed by the other physical branches.
export function reportSpaces({ includeBranches = false } = {}) {
  const own = BOOKABLE_ROOMS.filter(r => !hallParts(r.id)).map(r => ({ id: r.id, name: roomName(r.id), units: 1 }));
  own.push({ id: 'AAPA', name: 'AAPA Hall', units: 4, hall: true });
  if (!includeBranches) return own;
  const branches = ROOMS
    .filter(r => r.branch && !NON_PHYSICAL.includes(r.id))
    .map(r => ({ id: r.id, name: roomName(r.id), units: r.spaces || 1, branch: true }));
  return own.concat(branches);
}

// Which space row (and which units of it) a room id fills.
function unitsFor(roomId, spaceById) {
  const parts = hallParts(roomId);
  if (parts) return { spaceId: 'AAPA', parts: [...parts].map(p => Number(p) - 1) };
  return spaceById.has(roomId) ? { spaceId: roomId, parts: null } : null;
}

function clip(s, e) {
  const a = Math.max(s, OPEN_MIN);
  const b = Math.min(e, CLOSE_MIN);
  return b > a ? [a - OPEN_MIN, b - OPEN_MIN] : null;
}

// dates: ['YYYY-MM-DD', …]. bookings: confirmed booking rows (30-min slots).
// Returns { spaces: [...], totals, dates } where each space has
//   capacityMin, classMin, bookingMin, usedMin, pct, classPct, bookingPct,
//   byDate: { date: { pct, classPct, bookingPct } },
//   byHour: [12 × { pct, classPct, bookingPct }]   (summed over all dates)
export function computeOccupancy({ blocks, exceptions, bookings, dates, includeBranches = false }) {
  const spaces = reportSpaces({ includeBranches });
  const spaceById = new Map(spaces.map(s => [s.id, s]));
  const bookingsByDate = new Map();
  (bookings || []).forEach(b => {
    if (b.status && b.status !== 'confirmed') return;
    if (!bookingsByDate.has(b.date)) bookingsByDate.set(b.date, []);
    bookingsByDate.get(b.date).push(b);
  });

  const result = spaces.map(s => ({
    ...s, capacityMin: 0, classMin: 0, bookingMin: 0, usedMin: 0, byDate: {},
    byHourRaw: Array.from({ length: 12 }, () => ({ cap: 0, cls: 0, bk: 0 })),
  }));
  const rowById = new Map(result.map(r => [r.id, r]));

  for (const date of dates) {
    // Per space: per unit, minute counters for classes and bookings.
    const counters = new Map();
    const get = (spaceId) => {
      if (!counters.has(spaceId)) {
        const units = spaceById.get(spaceId).units;
        counters.set(spaceId, { cls: Array.from({ length: units }, () => new Uint8Array(SPAN)), bk: Array.from({ length: units }, () => new Uint8Array(SPAN)) });
      }
      return counters.get(spaceId);
    };
    const mark = (roomId, s, e, kind) => {
      const target = unitsFor(roomId, spaceById);
      const range = clip(s, e);
      if (!target || !range) return;
      const c = get(target.spaceId)[kind];
      // Specific partitions (AAPA) or, for a normal space, the first free unit.
      const unitList = target.parts || [null];
      for (const u of unitList) {
        for (let m = range[0]; m < range[1]; m++) {
          if (u !== null) { c[u][m] = Math.min(255, c[u][m] + 1); continue; }
          // Multi-room branch: stack into units in order (count of things at once).
          let placed = false;
          for (let k = 0; k < c.length && !placed; k++) { if (c[k][m] === 0) { c[k][m] = 1; placed = true; } }
          if (!placed) c[c.length - 1][m] = Math.min(255, c[c.length - 1][m] + 1);
        }
      }
    };

    classesOnDate(blocks || [], exceptions || [], date).forEach(c => mark(c.room_id, timeToMinutes(c.start_time), timeToMinutes(c.end_time), 'cls'));
    (bookingsByDate.get(date) || []).forEach(b => {
      const s = b.hour * 60 + (b.minute || 0);
      mark(b.room_id, s, s + 30, 'bk');
    });

    for (const row of result) {
      const cap = row.units * SPAN;
      let cls = 0;
      let bk = 0;
      const c = counters.get(row.id);
      const hourCls = new Array(12).fill(0);
      const hourBk = new Array(12).fill(0);
      if (c) {
        for (let m = 0; m < SPAN; m++) {
          // How many units are busy this minute, and how many by classes.
          let classUnits = 0;
          let anyUnits = 0;
          if (row.hall) {
            for (let u = 0; u < row.units; u++) {
              if (c.cls[u][m]) { classUnits++; anyUnits++; } else if (c.bk[u][m]) anyUnits++;
            }
          } else {
            let nc = 0; let nb = 0;
            for (let u = 0; u < row.units; u++) { if (c.cls[u][m]) nc++; if (c.bk[u][m]) nb++; }
            classUnits = Math.min(nc, row.units);
            anyUnits = Math.min(nc + nb, row.units);
          }
          cls += classUnits;
          bk += anyUnits - classUnits;
          hourCls[Math.floor(m / 60)] += classUnits;
          hourBk[Math.floor(m / 60)] += anyUnits - classUnits;
        }
      }
      row.capacityMin += cap;
      row.classMin += cls;
      row.bookingMin += bk;
      row.byDate[date] = { pct: (cls + bk) / cap * 100, classPct: cls / cap * 100, bookingPct: bk / cap * 100 };
      for (let h = 0; h < 12; h++) {
        row.byHourRaw[h].cap += row.units * 60;
        row.byHourRaw[h].cls += hourCls[h];
        row.byHourRaw[h].bk += hourBk[h];
      }
    }
  }

  const pct = (n, d) => (d ? (n / d) * 100 : 0);
  result.forEach(r => {
    r.usedMin = r.classMin + r.bookingMin;
    r.pct = pct(r.usedMin, r.capacityMin);
    r.classPct = pct(r.classMin, r.capacityMin);
    r.bookingPct = pct(r.bookingMin, r.capacityMin);
    r.byHour = r.byHourRaw.map(h => ({ pct: pct(h.cls + h.bk, h.cap), classPct: pct(h.cls, h.cap), bookingPct: pct(h.bk, h.cap) }));
    delete r.byHourRaw;
  });

  const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
  const totalsFor = rows => {
    const cap = sum(rows, 'capacityMin');
    return {
      capacityMin: cap, classMin: sum(rows, 'classMin'), bookingMin: sum(rows, 'bookingMin'), usedMin: sum(rows, 'usedMin'),
      pct: pct(sum(rows, 'usedMin'), cap), classPct: pct(sum(rows, 'classMin'), cap), bookingPct: pct(sum(rows, 'bookingMin'), cap),
    };
  };
  return {
    dates,
    spaces: result,
    totals: totalsFor(result.filter(r => !r.branch)), // the academy's own spaces
    branchTotals: includeBranches ? totalsFor(result.filter(r => r.branch)) : null,
  };
}
