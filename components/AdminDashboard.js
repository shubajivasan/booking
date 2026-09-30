import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  HOURS, DAY_NAMES, ROOMS, BOOKABLE_ROOMS, timeToMinutes, minutesToLabel, fmtHour,
  toDateKey, startOfWeek, addDays, roomName, blockAppliesOnDate, classesOnDate, weekdayOfDateKey, ROOM_GROUPS,
} from '../lib/schedule';

// Each 30-minute slot is stored as its own row. For display, back-to-back
// slots of the same booking (same room, date, student, email and purpose)
// are merged into one entry — e.g. 8:30pm–10:30pm instead of four rows. A
// gap splits them: 8:30–9:30pm and 10–10:30pm show as two entries. Every
// merged entry carries all of its row ids so actions apply to the whole
// thing.
function mergeBookingRows(rows) {
  const sorted = [...rows].sort((a, b) =>
    a.room_id.localeCompare(b.room_id)
    || a.date.localeCompare(b.date)
    || (a.email || '').localeCompare(b.email || '')
    || (a.student_name || '').localeCompare(b.student_name || '')
    || (a.purpose || '').localeCompare(b.purpose || '')
    || (a.hour * 60 + (a.minute || 0)) - (b.hour * 60 + (b.minute || 0))
  );
  const entries = [];
  sorted.forEach(bk => {
    const start = bk.hour * 60 + (bk.minute || 0);
    const prev = entries[entries.length - 1];
    if (
      prev
      && prev.room_id === bk.room_id && prev.date === bk.date
      && prev.email === bk.email && prev.studentName === bk.student_name
      && (prev.purpose || '') === (bk.purpose || '')
      && prev.endMinutes === start
    ) {
      prev.ids.push(bk.id);
      prev.endMinutes = start + 30;
      prev.amount = (prev.amount || 0) + (bk.amount || 0);
      return;
    }
    entries.push({
      type: 'booking',
      id: bk.id,
      ids: [bk.id],
      key: bk.id,
      room_id: bk.room_id,
      date: bk.date,
      hour: bk.hour,
      minute: bk.minute || 0,
      startMinutes: start,
      endMinutes: start + 30,
      studentName: bk.student_name,
      email: bk.email,
      phone: bk.phone,
      purpose: bk.purpose,
      amount: bk.amount,
    });
  });
  return entries;
}

// Times an admin can pick when approving/rescheduling: 7am–11pm in 30-min
// steps, wider than the public 9am–9pm so late rehearsals can be set.
const ADMIN_TIME_OPTIONS = [];
for (let m = 7 * 60; m <= 23 * 60; m += 30) ADMIN_TIME_OPTIONS.push(m);

// Groupings that aren't a single physical room (online / private / school
// classes from the branch import). Many classes at the same time there are
// normal, so the clash check skips them unless the admin ticks the box.
const NON_PHYSICAL_ROOMS = ['online-duet-class', 'online-group-classes', 'online-one-to-one', 'pvt-group-class', 'pvt-one-to-one-class', 'school'];

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Two regular classes can only both run on a date if their date ranges
// (start_date → end_date, blank = open-ended) overlap.
function dateRangesOverlap(a, b) {
  const aFrom = a.start_date || '0000-01-01';
  const aTo = a.end_date || '9999-12-31';
  const bFrom = b.start_date || '0000-01-01';
  const bTo = b.end_date || '9999-12-31';
  return aFrom <= bTo && bFrom <= aTo;
}

// Finds (1) regular classes in the same room, same weekday, overlapping
// times and overlapping date ranges, and (2) upcoming bookings that sit on
// top of a regular class. Classes that have already ended are ignored.
// Tick-box dropdown with a search box, for long lists (teachers, courses).
// selected = [] means "all".
function MultiSelectFilter({ allLabel, noun, options, selected, onChange }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = q ? options.filter(o => o.toLowerCase().includes(q)) : options;
  // Ticked items first, then the rest alphabetically.
  const shown = [...matches.filter(o => selected.includes(o)), ...matches.filter(o => !selected.includes(o))];
  const toggle = value => onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  const label = selected.length === 0 ? allLabel
    : selected.length === 1 ? selected[0]
      : `${selected.length} ${noun}`;
  return (
    <details className="room-multiselect">
      <summary title={selected.join(', ')} className={selected.length ? 'has-selection' : ''}>{label}</summary>
      <div className="room-multiselect-panel">
        <input
          type="text"
          className="multiselect-search"
          placeholder={`Search ${noun}\u2026`}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {selected.length > 0 && (
          <button type="button" className="cta ghost" style={{ width: '100%', marginBottom: 8 }} onClick={() => onChange([])}>
            Clear ({selected.length} selected)
          </button>
        )}
        {q && shown.length > 0 && (
          <button
            type="button"
            className="cta ghost"
            style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
            onClick={() => onChange([...new Set([...selected, ...shown])])}
          >
            Select all {shown.length} matching
          </button>
        )}
        <div className="day-checkboxes" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {shown.map((o, i) => (
            <label
              key={o}
              className={`day-checkbox ${selected.includes(o) ? 'checked' : ''} ${i === selected.length - 1 && selected.length > 0 && !q ? 'last-selected' : ''}`}
            >
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
              {o}
            </label>
          ))}
          {shown.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 4 }}>No matches.</p>}
        </div>
      </div>
    </details>
  );
}

// True when two lists of room ids contain exactly the same rooms.
function sameRoomSet(a, b) {
  return a.length === b.length && b.every(id => a.includes(id));
}

function prettyDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function findScheduleClashes(blocks, bookingEntries, { includeNonPhysical, todayKey, exceptions = [] }) {
  const active = blocks.filter(b =>
    (!b.end_date || b.end_date >= todayKey)
    && (includeNonPhysical || !NON_PHYSICAL_ROOMS.includes(b.room_id))
  );

  const groups = new Map();
  active.forEach(b => {
    const key = `${b.room_id}|${b.day_of_week}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  });

  const spacesIn = roomId => (ROOMS.find(r => r.id === roomId)?.spaces) || 1;
  const sameClass = (a, b) =>
    a.start_time.slice(0, 5) === b.start_time.slice(0, 5)
    && a.end_time.slice(0, 5) === b.end_time.slice(0, 5)
    && (a.teacher || '') === (b.teacher || '')
    && (a.course || '') === (b.course || '')
    && (a.batch || '') === (b.batch || '');

  const classClashes = [];
  groups.forEach(list => {
    const roomId = list[0].room_id;
    const day = list[0].day_of_week;
    const spaces = spacesIn(roomId);
    const sorted = [...list].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
    const duplicatePairs = new Set();

    // 1. The exact same class entered twice is always a mistake, however
    //    many rooms the space has.
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (!sameClass(a, b) || !dateRangesOverlap(a, b)) continue;
        duplicatePairs.add(`${a.id}|${b.id}`);
        classClashes.push({
          key: `dup|${a.id}|${b.id}`, kind: 'duplicate', room_id: roomId, day, spaces,
          overlapStart: timeToMinutes(a.start_time), overlapEnd: timeToMinutes(a.end_time),
          items: [a, b],
        });
      }
    }

    if (spaces === 1) {
      // 2a. One room: any two different classes at overlapping times clash.
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i];
          const b = sorted[j];
          const aS = timeToMinutes(a.start_time), aE = timeToMinutes(a.end_time);
          const bS = timeToMinutes(b.start_time), bE = timeToMinutes(b.end_time);
          if (bS >= aE) break; // sorted by start, nothing later can overlap a
          if (duplicatePairs.has(`${a.id}|${b.id}`)) continue;
          if (!rangesOverlap(aS, aE, bS, bE) || !dateRangesOverlap(a, b)) continue;
          classClashes.push({
            key: `${a.id}|${b.id}`, kind: 'overlap', room_id: roomId, day, spaces,
            overlapStart: Math.max(aS, bS), overlapEnd: Math.min(aE, bE),
            items: [a, b],
          });
        }
      }
      return;
    }

    // 2b. Several rooms (e.g. a branch with 2 rooms): it's only a clash when
    //     MORE classes run at the same moment than there are rooms. Walk the
    //     day in time segments; in each, count the classes running on the
    //     busiest date (the busiest set always starts on some class's start
    //     date, or today).
    const bounds = [...new Set(sorted.flatMap(b => [timeToMinutes(b.start_time), timeToMinutes(b.end_time)]))].sort((x, y) => x - y);
    let current = null;
    for (let k = 0; k < bounds.length - 1; k++) {
      const t0 = bounds[k];
      const t1 = bounds[k + 1];
      const running = sorted.filter(b => timeToMinutes(b.start_time) < t1 && timeToMinutes(b.end_time) > t0);
      let worst = [];
      if (running.length > spaces) {
        const dates = [...new Set(running.map(b => (b.start_date && b.start_date > todayKey ? b.start_date : todayKey)))];
        dates.forEach(d => {
          const on = running.filter(b => blockAppliesOnDate(b, d));
          if (on.length > worst.length) worst = on;
        });
      }
      if (worst.length > spaces) {
        const ids = worst.map(b => b.id).sort().join('|');
        if (current && current.ids === ids && current.overlapEnd === t0) {
          current.overlapEnd = t1;
        } else {
          current = {
            key: `over|${roomId}|${day}|${t0}|${ids}`, ids, kind: 'overlap', room_id: roomId, day, spaces,
            overlapStart: t0, overlapEnd: t1, items: worst,
          };
          classClashes.push(current);
        }
      } else {
        current = null;
      }
    }
  });

  const bookingClashes = [];
  bookingEntries.forEach(entry => {
    if (entry.date < todayKey) return;
    // Sessions that actually happen that date (one-off moves applied).
    classesOnDate(active, exceptions, entry.date).forEach(b => {
      if (b.room_id !== entry.room_id) return;
      const bS = timeToMinutes(b.start_time), bE = timeToMinutes(b.end_time);
      if (!rangesOverlap(entry.startMinutes, entry.endMinutes, bS, bE)) return;
      bookingClashes.push({ key: `${entry.key}|${b.id}`, entry, block: b });
    });
  });

  // One-off moved sessions: does the new date/time/room collide with
  // anything that happens there that day?
  const notEnded = blocks.filter(b => !b.end_date || b.end_date >= todayKey);
  exceptions
    .filter(e => e.status === 'moved' && e.new_date && e.new_date >= todayKey)
    .forEach(e => {
      const sessions = classesOnDate(notEnded, exceptions, e.new_date);
      const moved = sessions.find(x => x.exception && x.exception.id === e.id);
      if (!moved) return;
      if (!includeNonPhysical && NON_PHYSICAL_ROOMS.includes(moved.room_id)) return;
      const mS = timeToMinutes(moved.start_time), mE = timeToMinutes(moved.end_time);
      const others = sessions.filter(x => x !== moved && x.room_id === moved.room_id
        && rangesOverlap(mS, mE, timeToMinutes(x.start_time), timeToMinutes(x.end_time)));
      const spaces = (ROOMS.find(r => r.id === moved.room_id)?.spaces) || 1;
      if (others.length + 1 <= spaces) return;
      const s0 = Math.max(mS, ...others.map(x => timeToMinutes(x.start_time)));
      const e0 = Math.min(mE, ...others.map(x => timeToMinutes(x.end_time)));
      classClashes.push({
        key: `oneoff|${e.id}`, kind: 'one-off', room_id: moved.room_id, day: weekdayOfDateKey(e.new_date),
        date: e.new_date, spaces, overlapStart: s0, overlapEnd: Math.max(e0, s0 + 1), items: [moved, ...others],
      });
    });

  const dayOrder = d => DAY_NAMES.indexOf(d);
  classClashes.sort((x, y) =>
    x.room_id.localeCompare(y.room_id) || dayOrder(x.day) - dayOrder(y.day) || x.overlapStart - y.overlapStart);
  bookingClashes.sort((x, y) => x.entry.date.localeCompare(y.entry.date) || x.entry.startMinutes - y.entry.startMinutes);
  return { classClashes, bookingClashes };
}

function monthLabel(d) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
function dayLabel(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}
function shortDayLabel(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function AdminDashboard() {
  const [view, setView] = useState('today'); // today | day | week | month | all | staff
  const [currentUser, setCurrentUser] = useState(null); // { id, name, email, role }

  useEffect(() => {
    fetch('/api/admin/me').then(r => r.json()).then(body => {
      if (body.user) setCurrentUser(body.user);
    });
  }, []);

  async function handleLogout() {
    try {
      await fetch('/api/admin-logout', { method: 'POST' });
    } catch {
      // Even if the request fails, send them to the login page.
    }
    window.location.href = '/admin/login';
  }

  // Filter dropdowns: close when clicking outside, and only one open at a time.
  useEffect(() => {
    function onDown(ev) {
      document.querySelectorAll('details.room-multiselect[open]').forEach(d => {
        if (!d.contains(ev.target)) d.removeAttribute('open');
      });
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, []);

  // On phones the tab bar scrolls sideways; keep the selected tab in view.
  useEffect(() => {
    const el = document.querySelector('nav.tabs button.active');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [view]);

  const canManage = Boolean(currentUser) && currentUser.role !== 'staff'; // admin or super_admin
  const canManageStaff = Boolean(currentUser) && currentUser.role === 'super_admin';
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allBlocks, setAllBlocks] = useState([]); // all recurring_blocks, fetched once
  const [clashIncludeOnline, setClashIncludeOnline] = useState(false);

  // ---- Assistant (AI chat about room / teacher availability) ----
  const [chatMessages, setChatMessages] = useState([]); // { role: 'user' | 'assistant', content }
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState('');

  async function sendChat(text) {
    const question = (text ?? chatInput).trim();
    if (!question || chatSending) return;
    const next = [...chatMessages, { role: 'user', content: question }];
    setChatMessages(next);
    setChatInput('');
    setChatError('');
    setChatSending(true);
    try {
      const res = await fetch('/api/admin/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setChatError(body.error || 'The assistant could not answer.');
      else setChatMessages([...next, { role: 'assistant', content: body.reply, suggestions: body.suggestions || [] }]);
    } catch {
      setChatError('Could not reach the assistant. Check your connection.');
    }
    setChatSending(false);
  }
  const [clashChecking, setClashChecking] = useState(false);
  const [clashCheckedAt, setClashCheckedAt] = useState(null);
  const [bookings, setBookings] = useState([]); // bookings for the current visible range
  const [loading, setLoading] = useState(true);

  const [filterRooms, setFilterRooms] = useState([]); // empty array = all rooms
  function toggleFilterRoom(roomId) {
    setFilterRooms(prev => prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId]);
  }
  const [filterTeachers, setFilterTeachers] = useState([]); // empty = all teachers
  const [filterCourses, setFilterCourses] = useState([]); // empty = all courses
  const [filterType, setFilterType] = useState('all'); // all | class | booking

  const [showAddForm, setShowAddForm] = useState(false);
  const [convertingBooking, setConvertingBooking] = useState(null); // the booking row being turned into a class, if any
  const [addForm, setAddForm] = useState({
    room_id: '', days: [], dayTimes: {}, // dayTimes: { Monday: { start: '10:00', end: '11:00' }, ... }
    batch: '', teacher: '', course: '', start_date: '', ongoing: true, end_date: '',
  });
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  function toggleFormDay(day) {
    setAddForm(f => {
      if (f.days.includes(day)) {
        return { ...f, days: f.days.filter(d => d !== day) };
      }
      // Default a newly-checked day to whatever time was last used for
      // another day (if any), so re-checking a day after unchecking it, or
      // adding a second day, doesn't reset to a generic default every time.
      const lastUsed = f.days.length > 0 ? f.dayTimes[f.days[f.days.length - 1]] : null;
      const defaultTime = lastUsed || { start: '10:00', end: '11:00' };
      return {
        ...f,
        days: [...f.days, day],
        dayTimes: { ...f.dayTimes, [day]: f.dayTimes[day] || defaultTime },
      };
    });
  }

  function setDayTime(day, field, value) {
    setAddForm(f => ({
      ...f,
      dayTimes: { ...f.dayTimes, [day]: { ...f.dayTimes[day], [field]: value } },
    }));
  }

  // Parsed as local date parts (not `new Date(dateKey)`, which reads the
  // string as UTC midnight and can shift the day in some time zones).
  function dayNameFromDateKey(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return DAY_NAMES[new Date(y, m - 1, d).getDay()];
  }
  function minutesToTimeInput(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function openConvert(bk) {
    setConvertingBooking(bk);
    const day = dayNameFromDateKey(bk.date);
    setAddForm({
      room_id: bk.room_id,
      days: [day],
      dayTimes: { [day]: { start: minutesToTimeInput(bk.startMinutes), end: minutesToTimeInput(bk.endMinutes) } },
      batch: bk.purpose || '',
      teacher: '',
      course: '',
      start_date: bk.date,
      ongoing: true,
      end_date: '',
    });
    setAddError('');
    setShowAddForm(true);
  }

  function closeAddForm() {
    setShowAddForm(false);
    setConvertingBooking(null);
    setAddForm({ room_id: '', days: [], dayTimes: {}, batch: '', teacher: '', course: '', start_date: '', ongoing: true, end_date: '' });
  }

  function fetchBlocks() {
    return fetch('/api/admin/blocks')
      .then(r => r.json())
      .then(body => {
        if (body.error) { console.error('fetchBlocks error:', body.error); setAllBlocks([]); return; }
        setAllBlocks(body.blocks || []);
      })
      .catch(err => { console.error('fetchBlocks failed:', err); setAllBlocks([]); });
  }

  // Recurring classes are few enough (a few hundred rows) to fetch once and
  // filter client-side, rather than re-querying on every view/date change.
  // One-off changes to single sessions of regular classes (moved/cancelled dates).
  const [allExceptions, setAllExceptions] = useState([]);
  function fetchExceptions() {
    return fetch('/api/admin/class-exceptions')
      .then(r => r.json())
      .then(body => setAllExceptions(body.exceptions || []))
      .catch(() => setAllExceptions([]));
  }

  useEffect(() => { fetchBlocks(); fetchExceptions(); }, []);

  // "This date only" dialog: move or cancel ONE session of a regular class.
  const [sessionChange, setSessionChange] = useState(null); // { block, originalDate, existing }
  const [sessionForm, setSessionForm] = useState({ status: 'moved', new_date: '', new_start: '', new_end: '', new_room_id: '', note: '' });
  const [sessionError, setSessionError] = useState('');
  const [sessionSaving, setSessionSaving] = useState(false);

  function openSessionChange(entry) {
    const block = allBlocks.find(b => String(b.id) === String(entry.id));
    if (!block) return;
    const existing = entry.exception || null;
    const originalDate = existing ? existing.original_date : entry.date;
    setSessionChange({ block, originalDate, existing });
    setSessionForm({
      status: existing ? existing.status : 'moved',
      new_date: existing?.new_date || originalDate,
      new_start: (existing?.new_start || block.start_time).slice(0, 5),
      new_end: (existing?.new_end || block.end_time).slice(0, 5),
      new_room_id: existing?.new_room_id || block.room_id,
      note: existing?.note || '',
    });
    setSessionError('');
  }

  async function saveSessionChange(force = false) {
    const f = sessionForm;
    if (f.status === 'moved') {
      if (!f.new_date || !f.new_start || !f.new_end) { setSessionError('Pick the new date, start and end time.'); return; }
      if (f.new_end <= f.new_start) { setSessionError('End time must be after start time.'); return; }
    }
    setSessionSaving(true);
    setSessionError('');
    const res = await fetch('/api/admin/class-exceptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        block_id: sessionChange.block.id,
        original_date: sessionChange.originalDate,
        status: f.status,
        new_date: f.new_date,
        new_start: f.new_start,
        new_end: f.new_end,
        new_room_id: f.new_room_id,
        note: f.note,
        force,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSessionSaving(false);
    if (res.status === 409 && body.code === 'conflict') {
      if (window.confirm(`${body.error}\n\nMove it there anyway?`)) return saveSessionChange(true);
      return;
    }
    if (!res.ok) { setSessionError(body.error || 'Could not save this change.'); return; }
    setSessionChange(null);
    fetchExceptions();
  }

  async function undoSessionChange(exception) {
    if (!window.confirm('Undo this one-off change? The session goes back to its usual day, time and room.')) return;
    const res = await fetch('/api/admin/class-exceptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: exception.id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not undo this change.');
      return;
    }
    setSessionChange(null);
    fetchExceptions();
  }

  async function handleAddClass(e) {
    e.preventDefault();
    setAddError('');
    if (!addForm.room_id) { setAddError('Pick a room'); return; }
    if (addForm.days.length === 0) { setAddError('Pick at least one day of the week'); return; }
    for (const day of addForm.days) {
      const t = addForm.dayTimes[day];
      if (!t || !t.start || !t.end) { setAddError(`Set a start and end time for ${day}`); return; }
      if (t.start >= t.end) { setAddError(`${day}: end time must be after start time`); return; }
    }
    if (!addForm.ongoing && !addForm.end_date) { setAddError('Pick an end date, or mark this as ongoing'); return; }
    if (addForm.start_date && !addForm.ongoing && addForm.end_date && addForm.start_date > addForm.end_date) {
      setAddError('End date must be after start date'); return;
    }
    setSaving(true);

    // Days that share the exact same time go in one request; days with a
    // different time (e.g. Monday 3–4pm but Tuesday 5–6pm) get their own.
    const groups = {};
    for (const day of addForm.days) {
      const t = addForm.dayTimes[day];
      const key = `${t.start}|${t.end}`;
      if (!groups[key]) groups[key] = { start: t.start, end: t.end, days: [] };
      groups[key].days.push(day);
    }

    const results = await Promise.all(
      Object.values(groups).map(g =>
        fetch('/api/admin/blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: addForm.room_id,
            days: g.days,
            start_time: g.start + ':00',
            end_time: g.end + ':00',
            batch: addForm.batch,
            teacher: addForm.teacher,
            course: addForm.course,
            start_date: addForm.start_date || null,
            end_date: addForm.ongoing ? null : addForm.end_date,
          }),
        }).then(async res => ({ ok: res.ok, days: g.days, body: await res.json().catch(() => ({})) }))
      )
    );

    setSaving(false);
    const failed = results.filter(r => !r.ok);
    if (failed.length > 0) {
      setAddError(failed.map(f => `${f.days.join(', ')}: ${f.body.error || 'could not save'}`).join(' \u2014 '));
      return;
    }

    if (convertingBooking) {
      // The class now covers this slot going forward — remove the original
      // one-time booking so it isn't double-counted as both a class and a
      // booking. If this delete happens to fail, the class was still
      // created successfully; the old booking can be removed by hand.
      await fetch('/api/admin/bookings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: convertingBooking.ids }),
      }).catch(() => {});
      fetchBookings();
      refreshAllBookings();
    }

    closeAddForm();
    fetchBlocks();
  }

  async function handleDeleteBlock(id) {
    if (!window.confirm('Remove this class from the schedule? This cannot be undone.')) return;
    setDeletingId(id);
    const res = await fetch('/api/admin/blocks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setDeletingId(null);
    if (res.ok) fetchBlocks();
  }

  const rangeStart = useMemo(() => {
    if (view === 'week') return startOfWeek(selectedDate);
    if (view === 'month') {
      const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
      return startOfWeek(d);
    }
    return selectedDate; // today / day
  }, [view, selectedDate]);

  const rangeEnd = useMemo(() => {
    if (view === 'week') return addDays(rangeStart, 6);
    if (view === 'month') {
      // Sunday of the week containing the month's last day, so the grid
      // always shows every day of the month (e.g. 29 and 30 Sep 2026).
      const lastOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
      return addDays(startOfWeek(lastOfMonth), 6);
    }
    return selectedDate;
  }, [view, rangeStart, selectedDate]);

  useEffect(() => {
    fetchBookings();
  }, [rangeStart, rangeEnd]);

  const [allBookings, setAllBookings] = useState([]);
  const [allBookingsLoading, setAllBookingsLoading] = useState(false);
  const [allBookingsTruncated, setAllBookingsTruncated] = useState(false);
  const [allBookingsSearch, setAllBookingsSearch] = useState('');
  const [allBookingsWhen, setAllBookingsWhen] = useState('upcoming'); // upcoming | past | all

  const filteredAllBookings = useMemo(() => {
    const q = allBookingsSearch.trim().toLowerCase();
    return allBookings
      .filter(bk => filterRooms.length === 0 || filterRooms.includes(bk.room_id))
      .filter(bk => {
        if (!q) return true;
        return (bk.student_name || '').toLowerCase().includes(q)
          || (bk.email || '').toLowerCase().includes(q)
          || (bk.purpose || '').toLowerCase().includes(q);
      });
  }, [allBookings, filterRooms, allBookingsSearch]);

  // Newest date first, then by time within a day — same order as before,
  // but with back-to-back slots merged into single entries.
  // Upcoming = today onwards, soonest first. Past / All = newest first.
  const mergedAllBookings = useMemo(() => {
    const todayKey = toDateKey(new Date());
    const entries = mergeBookingRows(filteredAllBookings).filter(e =>
      allBookingsWhen === 'upcoming' ? e.date >= todayKey
        : allBookingsWhen === 'past' ? e.date < todayKey
          : true
    );
    return allBookingsWhen === 'upcoming'
      ? entries.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.room_id.localeCompare(b.room_id))
      : entries.sort((a, b) => b.date.localeCompare(a.date) || b.startMinutes - a.startMinutes || a.room_id.localeCompare(b.room_id));
  }, [filteredAllBookings, allBookingsWhen]);

  const [staffList, setStaffList] = useState([]);

  // ---- Booking requests (Room 9, Room 10, Basement Hall — see APPROVAL_ROOMS) ----
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestActionKey, setRequestActionKey] = useState(null); // ids.join of the request being approved/rejected

  function fetchRequests() {
    setRequestsLoading(true);
    return fetch('/api/admin/booking-requests')
      .then(r => r.json())
      .then(body => { setRequests(body.requests || []); setRequestsLoading(false); })
      .catch(() => setRequestsLoading(false));
  }

  // Load once as soon as we know the user can review requests (for the tab
  // badge), again whenever the tab is opened, and every 2 minutes so a new
  // request shows up without a page refresh.
  useEffect(() => {
    if (!canManage) return;
    fetchRequests();
    const timer = setInterval(fetchRequests, 120000);
    return () => clearInterval(timer);
  }, [canManage]);
  useEffect(() => { if (view === 'requests' && canManage) fetchRequests(); }, [view]);

  // Inline "Edit timing" form for one request at a time.
  const [editingRequestKey, setEditingRequestKey] = useState(null);
  const [requestEdit, setRequestEdit] = useState({ room_id: '', date: '', start: 0, end: 0 });

  function openRequestEdit(request) {
    setEditingRequestKey(request.ids.join());
    setRequestEdit({
      room_id: request.room_id,
      date: request.date,
      start: request.slots[0],
      end: request.slots[request.slots.length - 1] + 30,
    });
  }

  async function handleApproveWithChanges(request, force = false) {
    const { room_id, date, start, end } = requestEdit;
    if (!date || end <= start) { alert('The end time must be after the start time.'); return; }
    const newLabel = `${roomName(room_id)} on ${date}, ${minutesToLabel(start)} \u2013 ${minutesToLabel(end)}`;
    if (!force && !window.confirm(`Approve ${request.student_name}'s request as:\n\n${newLabel}\n\nThey'll get a confirmation email with the updated details.`)) return;

    const key = request.ids.join();
    setRequestActionKey(key);
    const res = await fetch('/api/admin/booking-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: request.ids, action: 'approve', changes: { room_id, date, start, end }, force }),
    });
    const body = await res.json().catch(() => ({}));
    setRequestActionKey(null);

    if (res.status === 409 && body.code === 'class_conflict') {
      if (window.confirm(`${body.error}\n\nApprove anyway?`)) return handleApproveWithChanges(request, true);
      return;
    }
    if (!res.ok) { alert(body.error || 'Could not approve this request.'); return; }

    setEditingRequestKey(null);
    await fetchRequests();
    fetchBookings();
    refreshAllBookings();
  }

  async function handleRequestAction(request, action) {
    let reason = '';
    if (action === 'reject') {
      const input = window.prompt(
        `Reject ${request.student_name}'s request for ${roomName(request.room_id)} on ${request.date}?\n\nOptional: add a reason (it will be included in the email to the student). Leave blank for no reason.`
      );
      if (input === null) return; // pressed Cancel
      reason = input.trim();
    } else if (!window.confirm(
      `Approve ${request.student_name}'s request for ${roomName(request.room_id)} on ${request.date}? They'll get a confirmation email.`
      + (request.conflicts && request.conflicts.length
        ? `\n\n\u26a0 This overlaps a regular class: ${request.conflicts.map(c => `${c.time} ${c.label}`).join('; ')}.`
        : '')
    )) {
      return;
    }

    setRequestActionKey(request.ids.join());
    const res = await fetch('/api/admin/booking-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: request.ids, action, reason }),
    });
    const body = await res.json().catch(() => ({}));
    setRequestActionKey(null);
    if (!res.ok) alert(body.error || 'Could not update this request.');
    await fetchRequests();
    if (action === 'approve') { fetchBookings(); refreshAllBookings(); }
  }

  function requestTimeLabel(slots) {
    const runs = [];
    let start = slots[0];
    let end = slots[0] + 30;
    for (let i = 1; i < slots.length; i++) {
      if (slots[i] === end) end = slots[i] + 30;
      else { runs.push([start, end]); start = slots[i]; end = slots[i] + 30; }
    }
    runs.push([start, end]);
    return runs.map(([a, b]) => `${minutesToLabel(a)} \u2013 ${minutesToLabel(b)}`).join(', ');
  }

  const [activityEntries, setActivityEntries] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activitySearch, setActivitySearch] = useState('');

  function fetchActivity() {
    setActivityLoading(true);
    fetch('/api/admin/activity')
      .then(r => r.json())
      .then(body => { setActivityEntries(body.entries || []); setActivityLoading(false); })
      .catch(() => setActivityLoading(false));
  }

  useEffect(() => { if (view === 'activity') fetchActivity(); }, [view]);

  const filteredActivity = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    if (!q) return activityEntries;
    return activityEntries.filter(e =>
      (e.summary || '').toLowerCase().includes(q) || (e.user_name || '').toLowerCase().includes(q)
    );
  }, [activityEntries, activitySearch]);

  const [staffLoading, setStaffLoading] = useState(false);
  const [staffForm, setStaffForm] = useState({ name: '', email: '', password: '', role: 'staff' });
  const [staffError, setStaffError] = useState('');
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffDeletingId, setStaffDeletingId] = useState(null);

  // Google sign-in access requests (super admin only).
  const [accessRequests, setAccessRequests] = useState([]);
  const [accessRoles, setAccessRoles] = useState({}); // request id -> 'staff' | 'admin'
  const [accessBusyId, setAccessBusyId] = useState(null);

  function fetchAccessRequests() {
    return fetch('/api/admin/access-requests')
      .then(r => r.json())
      .then(body => setAccessRequests(body.requests || []))
      .catch(() => {});
  }

  useEffect(() => {
    if (!canManageStaff) return;
    fetchAccessRequests();
    const timer = setInterval(fetchAccessRequests, 120000);
    return () => clearInterval(timer);
  }, [canManageStaff]);

  async function handleAccessRequest(r, action) {
    const role = accessRoles[r.id] || 'staff';
    const msg = action === 'approve'
      ? `Give ${r.name || r.email} (${r.email}) access as ${role === 'admin' ? 'Admin' : 'Staff'}? They'll get an email.`
      : `Decline ${r.name || r.email}'s access request? They'll get an email.`;
    if (!window.confirm(msg)) return;
    setAccessBusyId(r.id);
    const res = await fetch('/api/admin/access-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, action, role }),
    });
    const body = await res.json().catch(() => ({}));
    setAccessBusyId(null);
    if (!res.ok) alert(body.error || 'Could not update this request.');
    fetchAccessRequests();
    if (action === 'approve') fetchStaff();
  }

  function fetchStaff() {
    setStaffLoading(true);
    fetch('/api/admin/staff')
      .then(r => r.json())
      .then(body => { setStaffList(body.staff || []); setStaffLoading(false); })
      .catch(() => setStaffLoading(false));
  }

  useEffect(() => { if (view === 'staff') fetchStaff(); }, [view]);

  async function handleAddStaff(e) {
    e.preventDefault();
    setStaffError('');
    if (!staffForm.name || !staffForm.email) {
      setStaffError('Name and email are required.'); return;
    }
    if (staffForm.password && staffForm.password.length < 8) {
      setStaffError('Password must be at least 8 characters (or leave it blank for Google sign-in only).'); return;
    }
    setStaffSaving(true);
    const res = await fetch('/api/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(staffForm),
    });
    const body = await res.json();
    setStaffSaving(false);
    if (!res.ok) { setStaffError(body.error || 'Could not add this staff member.'); return; }
    setStaffForm({ name: '', email: '', password: '', role: 'staff' });
    fetchStaff();
  }

  async function handleDeleteStaff(id) {
    if (!window.confirm('Remove this staff member\u2019s access? This cannot be undone.')) return;
    setStaffDeletingId(id);
    const res = await fetch('/api/admin/staff', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const body = await res.json().catch(() => ({}));
    setStaffDeletingId(null);
    if (res.ok) fetchStaff();
    else alert(body.error || 'Could not remove this staff member.');
  }


  useEffect(() => {
    if (view !== 'all') return;
    setAllBookingsLoading(true);
    fetch('/api/admin/bookings?all=true')
      .then(r => r.json())
      .then(body => {
        setAllBookings(body.bookings || []);
        setAllBookingsTruncated(Boolean(body.truncated));
        setAllBookingsLoading(false);
      });
  }, [view]);

  function refreshAllBookings() {
    if (view !== 'all' && view !== 'clashes') return;
    fetch('/api/admin/bookings?all=true')
      .then(r => r.json())
      .then(body => {
        setAllBookings(body.bookings || []);
        setAllBookingsTruncated(Boolean(body.truncated));
      });
  }

  // "Check now": reloads classes and bookings fresh, then the list below
  // recalculates from them.
  async function runClashCheck() {
    setClashChecking(true);
    await Promise.all([
      fetchBlocks(),
      fetchExceptions(),
      fetch('/api/admin/bookings?all=true')
        .then(r => r.json())
        .then(body => { setAllBookings(body.bookings || []); setAllBookingsTruncated(Boolean(body.truncated)); })
        .catch(() => {}),
    ]);
    setClashCheckedAt(new Date());
    setClashChecking(false);
  }
  useEffect(() => { if (view === 'clashes' && canManage) runClashCheck(); }, [view]);

  const scheduleClashes = useMemo(() => findScheduleClashes(
    allBlocks,
    mergeBookingRows(allBookings),
    { includeNonPhysical: clashIncludeOnline, todayKey: toDateKey(new Date()), exceptions: allExceptions },
  ), [allBlocks, allBookings, clashIncludeOnline, allExceptions]);

  // The room filter at the top of the dashboard also narrows the clash list.
  const visibleClashes = useMemo(() => {
    const keep = id => filterRooms.length === 0 || filterRooms.includes(id);
    return {
      classClashes: scheduleClashes.classClashes.filter(c => keep(c.room_id)),
      bookingClashes: scheduleClashes.bookingClashes.filter(c => keep(c.entry.room_id)),
    };
  }, [scheduleClashes, filterRooms]);

  // Clash count per room (all rooms, ignoring the filter), for the summary chips.
  const clashesByRoom = useMemo(() => {
    const counts = new Map();
    scheduleClashes.classClashes.forEach(c => counts.set(c.room_id, (counts.get(c.room_id) || 0) + 1));
    scheduleClashes.bookingClashes.forEach(c => counts.set(c.entry.room_id, (counts.get(c.entry.room_id) || 0) + 1));
    return ROOMS.filter(r => counts.has(r.id)).map(r => ({ id: r.id, name: r.name, count: counts.get(r.id) }));
  }, [scheduleClashes]);

  function classClashLine(b) {
    const who = [b.batch || b.course || 'Class', b.teacher].filter(Boolean).join(' \u2014 ');
    const dates = (b.start_date || b.end_date) ? ` \u00b7 ${b.start_date || 'any date'} \u2192 ${b.end_date || 'ongoing'}` : '';
    return `${minutesToLabel(timeToMinutes(b.start_time))}\u2013${minutesToLabel(timeToMinutes(b.end_time))} \u00b7 ${who}${b.batch && b.course ? ` (${b.course})` : ''}${dates}`;
  }

  function fetchBookings() {
    setLoading(true);
    const from = toDateKey(rangeStart);
    const to = toDateKey(rangeEnd);
    fetch(`/api/admin/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(r => r.json())
      .then(body => {
        setBookings(body.bookings || []);
        setLoading(false);
      });
  }

  async function handleDeleteBooking(entry) {
    if (!window.confirm(`Cancel this booking (${minutesToLabel(entry.startMinutes)} \u2013 ${minutesToLabel(entry.endMinutes)})? This cannot be undone.`)) return;
    setDeletingId(entry.id);
    const res = await fetch('/api/admin/bookings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: entry.ids }),
    });
    setDeletingId(null);
    if (res.ok) { fetchBookings(); refreshAllBookings(); }
    else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not cancel this booking.');
    }
  }

  const [editingBooking, setEditingBooking] = useState(null); // the booking row being rescheduled
  const [editingBlock, setEditingBlock] = useState(null); // the regular class being edited
  const [blockEditForm, setBlockEditForm] = useState({
    room_id: '', day_of_week: '', start_time: '', end_time: '',
    batch: '', teacher: '', course: '', start_date: '', ongoing: true, end_date: '',
  });
  const [blockEditError, setBlockEditError] = useState('');
  const [savingBlockEdit, setSavingBlockEdit] = useState(false);

  function openEditBlock(e) {
    setEditingBlock(e);
    setBlockEditForm({
      room_id: e.room_id,
      day_of_week: e.day_of_week,
      start_time: e.start_time.slice(0, 5),
      end_time: e.end_time.slice(0, 5),
      batch: e.batch || '',
      teacher: e.teacher || '',
      course: e.course || '',
      start_date: e.start_date || '',
      ongoing: !e.end_date,
      end_date: e.end_date || '',
    });
    setBlockEditError('');
  }

  async function handleSaveEditBlock(ev) {
    ev.preventDefault();
    setBlockEditError('');
    if (!blockEditForm.room_id) { setBlockEditError('Pick a room'); return; }
    if (!blockEditForm.day_of_week) { setBlockEditError('Pick a day'); return; }
    if (blockEditForm.start_time >= blockEditForm.end_time) { setBlockEditError('End time must be after start time'); return; }
    if (!blockEditForm.ongoing && !blockEditForm.end_date) { setBlockEditError('Pick an end date, or mark this as ongoing'); return; }

    setSavingBlockEdit(true);
    const res = await fetch('/api/admin/blocks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingBlock.id,
        room_id: blockEditForm.room_id,
        day_of_week: blockEditForm.day_of_week,
        start_time: blockEditForm.start_time + ':00',
        end_time: blockEditForm.end_time + ':00',
        batch: blockEditForm.batch,
        teacher: blockEditForm.teacher,
        course: blockEditForm.course,
        start_date: blockEditForm.start_date || null,
        end_date: blockEditForm.ongoing ? null : blockEditForm.end_date,
      }),
    });
    const body = await res.json();
    setSavingBlockEdit(false);
    if (!res.ok) { setBlockEditError(body.error || 'Could not save this change.'); return; }
    setEditingBlock(null);
    fetchBlocks();
  }
  const [editForm, setEditForm] = useState({ room_id: '', date: '', start: 0, end: 0 });
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  function openEdit(bk) {
    setEditingBooking(bk);
    setEditForm({ room_id: bk.room_id, date: bk.date, start: bk.startMinutes, end: bk.endMinutes });
    setEditError('');
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setEditError('');
    setSavingEdit(true);
    const res = await fetch('/api/admin/bookings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: editingBooking.ids,
        room_id: editForm.room_id,
        date: editForm.date,
        start: Number(editForm.start),
        end: Number(editForm.end),
      }),
    });
    const body = await res.json();
    setSavingEdit(false);
    if (!res.ok) { setEditError(body.error || 'Could not save this change.'); return; }
    setEditingBooking(null);
    fetchBookings();
    refreshAllBookings();
  }

  const teacherOptions = useMemo(
    () => [...new Set(allBlocks.map(b => b.teacher).filter(Boolean))].sort(),
    [allBlocks]
  );
  const courseOptions = useMemo(
    () => [...new Set(allBlocks.map(b => b.course).filter(Boolean))].sort(),
    [allBlocks]
  );

  function passesFilters(entry) {
    if (filterType !== 'all' && entry.type !== filterType) return false;
    if (filterRooms.length > 0 && !filterRooms.includes(entry.room_id)) return false;
    if (entry.type === 'class') {
      if (filterTeachers.length > 0 && !filterTeachers.includes(entry.teacher)) return false;
      if (filterCourses.length > 0 && !filterCourses.includes(entry.course)) return false;
    } else {
      // Teacher/course filters don't apply to student bookings — if either
      // is active, bookings are excluded rather than shown as false matches.
      if (filterTeachers.length > 0 || filterCourses.length > 0) return false;
    }
    return true;
  }

  // Build the merged, time-sorted schedule for one specific calendar date.
  function scheduleForDate(date) {
    const dateKey = toDateKey(date);
    const dayName = DAY_NAMES[date.getDay()];

    // includeInactive: sessions cancelled or moved away from this date are
    // still listed (greyed out) so admins can see and undo the change.
    const classEntries = classesOnDate(allBlocks, allExceptions, dateKey, { includeInactive: true })
      .map(b => ({
        type: 'class',
        id: b.id,
        date: dateKey,
        exception: b.exception || null,
        exceptionKind: b.exceptionKind || null,
        inactive: Boolean(b.inactive),
        room_id: b.room_id,
        day_of_week: b.day_of_week,
        start_time: b.start_time,
        end_time: b.end_time,
        startMinutes: timeToMinutes(b.start_time),
        endMinutes: timeToMinutes(b.end_time),
        teacher: b.teacher,
        course: b.course,
        batch: b.batch,
        label: b.label,
        start_date: b.start_date,
        end_date: b.end_date,
      }));

    const bookingEntries = mergeBookingRows(bookings.filter(bk => bk.date === dateKey));

    return [...classEntries, ...bookingEntries]
      .filter(passesFilters)
      .sort((a, b) => a.startMinutes - b.startMinutes || a.room_id.localeCompare(b.room_id));
  }

  // Turns one merged schedule entry (a class or a booking) into a flat row
  // for Excel export, given the calendar date it falls on.
  function entryToExportRow(dateLabel, e) {
    const time = `${minutesToLabel(e.startMinutes)} - ${minutesToLabel(e.endMinutes)}`;
    if (e.type === 'class') {
      const type = e.exceptionKind === 'cancelled' ? 'Regular class \u2014 cancelled this date'
        : e.exceptionKind === 'moved-away' ? `Regular class \u2014 moved to ${e.exception.new_date}`
          : e.exceptionKind === 'moved-here' ? `Regular class \u2014 moved here from ${e.exception.original_date}`
            : 'Regular class';
      return {
        Date: dateLabel, Time: time, Room: roomName(e.room_id), Type: type,
        Batch: e.batch || '', Teacher: e.teacher || '', Course: e.course || '',
      };
    }
    return {
      Date: dateLabel, Time: time, Room: roomName(e.room_id), Type: 'Booking',
      Batch: e.studentName || '', Teacher: '', Course: e.purpose || '',
    };
  }

  function downloadExcel(rows, filename) {
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Schedule');
    XLSX.writeFile(workbook, filename);
  }

  function exportDay() {
    const rows = scheduleForDate(selectedDate).map(e => entryToExportRow(toDateKey(selectedDate), e));
    downloadExcel(rows, `schedule-${toDateKey(selectedDate)}.xlsx`);
  }

  function exportWeek() {
    const rows = weekDays.flatMap(d => scheduleForDate(d).map(e => entryToExportRow(toDateKey(d), e)));
    downloadExcel(rows, `schedule-week-${toDateKey(weekDays[0])}.xlsx`);
  }

  function exportAllBookings() {
    const rows = mergedAllBookings.map(e => ({
      Date: e.date,
      Time: `${minutesToLabel(e.startMinutes)} - ${minutesToLabel(e.endMinutes)}`,
      Room: roomName(e.room_id),
      Student: e.studentName || '',
      Email: e.email || '',
      Phone: e.phone || '',
      Purpose: e.purpose || '',
    }));
    downloadExcel(rows, `${allBookingsWhen === 'upcoming' ? 'upcoming' : allBookingsWhen === 'past' ? 'past' : 'all'}-bookings.xlsx`);
  }

  function goToday() { setSelectedDate(new Date()); setView('today'); }
  function shiftDate(days) { setSelectedDate(d => addDays(d, days)); }
  function shiftMonth(delta) {
    setSelectedDate(d => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [selectedDate]);

  const monthGridDays = useMemo(() => {
    const start = rangeStart;
    const days = [];
    let cur = start;
    while (cur <= rangeEnd) {
      days.push(cur);
      cur = addDays(cur, 1);
    }
    return days;
  }, [rangeStart, rangeEnd]);

  // Selected merged entries for bulk reschedule: { entryKey: [row ids] }.
  const [selectedGroups, setSelectedGroups] = useState({});
  const selectedBookingIds = Object.values(selectedGroups).flat();
  const selectedCount = Object.keys(selectedGroups).length;
  const [bulkRescheduleOpen, setBulkRescheduleOpen] = useState(false);
  const [bulkNewDate, setBulkNewDate] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState('');

  function toggleSelectBooking(entry) {
    setSelectedGroups(prev => {
      const next = { ...prev };
      if (next[entry.key]) delete next[entry.key];
      else next[entry.key] = entry.ids;
      return next;
    });
  }

  function selectAllBookingsToday() {
    const next = {};
    scheduleForDate(selectedDate).filter(e => e.type === 'booking').forEach(e => { next[e.key] = e.ids; });
    setSelectedGroups(next);
  }

  function openBulkReschedule() {
    // Defaults to the same weekday next week — the exact case you described.
    setBulkNewDate(toDateKey(addDays(selectedDate, 7)));
    setBulkError('');
    setBulkRescheduleOpen(true);
  }

  async function handleBulkReschedule() {
    if (!bulkNewDate) { setBulkError('Pick a date'); return; }
    setBulkSaving(true);
    setBulkError('');

    const results = await Promise.all(
      selectedBookingIds.map(id =>
        fetch('/api/admin/bookings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, date: bulkNewDate }),
        }).then(async res => ({ id, ok: res.ok, body: await res.json().catch(() => ({})) }))
      )
    );

    setBulkSaving(false);
    const failed = results.filter(r => !r.ok);
    if (failed.length > 0) {
      setBulkError(`${results.length - failed.length} of ${results.length} moved successfully. ${failed.length} failed \u2014 likely because that room already has something else at the same time on the new date: ${failed.map(f => f.body.error || 'unknown error').join('; ')}`);
    } else {
      setBulkRescheduleOpen(false);
      setSelectedGroups({});
    }
    fetchBookings();
    refreshAllBookings();
  }

  function renderEntry(e, i) {
    const time = `${minutesToLabel(e.startMinutes)}–${minutesToLabel(e.endMinutes)}`;
    if (e.type === 'class') {
      const ex = e.exception;
      const usual = ex && e.exceptionKind === 'moved-here'
        ? allBlocks.find(b => String(b.id) === String(e.id))
        : null;
      return (
        <div className={`sched-row ${e.inactive ? 'sched-row-inactive' : ''}`} key={i}>
          <span className="sched-time">{time}</span>
          <span className="sched-room">{roomName(e.room_id)}</span>
          <span className="sched-title">
            {e.batch || e.course || 'Class'}
            {e.teacher ? ` — ${e.teacher}` : ''}
            {e.batch && e.course ? <span className="sched-subtitle"> ({e.course})</span> : null}
            {!ex && (e.start_date || e.end_date) ? (
              <span className="sched-subtitle"> · {e.start_date || 'any date'} → {e.end_date || 'ongoing'}</span>
            ) : null}
            {e.exceptionKind === 'moved-here' && usual && (
              <span className="sched-subtitle"> · usually {usual.day_of_week} {minutesToLabel(timeToMinutes(usual.start_time))}{usual.room_id !== e.room_id ? `, ${roomName(usual.room_id)}` : ''}</span>
            )}
            {e.exceptionKind === 'moved-away' && (
              <span className="sched-subtitle"> · moved to {prettyDateKey(ex.new_date)} {minutesToLabel(timeToMinutes(ex.new_start))}{ex.new_room_id && ex.new_room_id !== e.room_id ? `, ${roomName(ex.new_room_id)}` : ''}</span>
            )}
            {ex?.note ? <span className="sched-subtitle"> · {ex.note}</span> : null}
          </span>
          <span className={`sched-tag ${ex ? 'sched-tag-oneoff' : 'sched-tag-class'}`}>
            {e.exceptionKind === 'cancelled' ? 'Cancelled this date'
              : e.exceptionKind === 'moved-away' ? 'Moved (this date)'
                : e.exceptionKind === 'moved-here' ? 'Moved here (this date)'
                  : 'Regular class'}
          </span>
          {canManage && (
            <div style={{ display: 'flex', gap: 6 }}>
              {ex ? (
                <>
                  <button className="cta ghost sched-remove" onClick={() => openSessionChange(e)}>Change</button>
                  <button className="cta ghost sched-remove" onClick={() => undoSessionChange(ex)}>Undo</button>
                </>
              ) : (
                <>
                  <button className="cta ghost sched-remove" onClick={() => openSessionChange(e)} title="Move or cancel just this date's session">
                    This date only
                  </button>
                  <button className="cta ghost sched-remove" onClick={() => openEditBlock(e)} title="Change every week">
                    Edit
                  </button>
                  <button
                    className="cta ghost sched-remove"
                    onClick={() => handleDeleteBlock(e.id)}
                    disabled={deletingId === e.id}
                  >
                    {deletingId === e.id ? 'Removing…' : 'Remove'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="sched-row" key={i}>
        <span className="sched-time">{time}</span>
        <span className="sched-room">{roomName(e.room_id)}</span>
        <span className="sched-title">{e.studentName}{e.purpose ? ` — ${e.purpose}` : ''}</span>
        <span className="sched-tag sched-tag-booking">Booking</span>
        {canManage && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={Boolean(selectedGroups[e.key])}
              onChange={() => toggleSelectBooking(e)}
              style={{ marginRight: 4, width: 16, height: 16, accentColor: 'var(--brass-dark)' }}
              title="Select for bulk reschedule"
            />
            <button className="cta ghost sched-remove" onClick={() => openConvert(e)}>
              Convert to class
            </button>
            <button className="cta ghost sched-remove" onClick={() => openEdit(e)}>
              Reschedule
            </button>
            <button
              className="cta ghost sched-remove"
              onClick={() => handleDeleteBooking(e)}
              disabled={deletingId === e.id}
            >
              {deletingId === e.id ? 'Cancelling…' : 'Remove'}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <header>
        <div className="admin-header-top">
          <div>
            <p className="brand-eyebrow">Ajivasan Academy of Performing Arts</p>
            <h1 className="brand">Schedule dashboard</h1>
          </div>
          <div className="admin-user no-print">
            {currentUser && (
              <span className="admin-user-name">
                {currentUser.name}
                <span className="admin-user-role">
                  {currentUser.role === 'super_admin' ? 'Super admin' : currentUser.role === 'admin' ? 'Admin' : 'Staff'}
                </span>
              </span>
            )}
            <button type="button" className="cta ghost" onClick={handleLogout}>Log out</button>
          </div>
        </div>
        <nav className="tabs no-print">
          <button className={view === 'today' ? 'active' : ''} onClick={goToday}>Today</button>
          <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>Day</button>
          <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Week</button>
          <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Month</button>
          <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All bookings</button>
          {canManage && (
            <button className={view === 'requests' ? 'active' : ''} onClick={() => setView('requests')}>
              Requests{requests.length > 0 && <span className="tab-badge">{requests.length}</span>}
            </button>
          )}
          <button className={view === 'assistant' ? 'active' : ''} onClick={() => setView('assistant')}>Assistant</button>
          {canManage && (
            <button className={view === 'clashes' ? 'active' : ''} onClick={() => setView('clashes')}>
              Clash check
              {(scheduleClashes.classClashes.length + scheduleClashes.bookingClashes.length) > 0 && (
                <span className="tab-badge">{scheduleClashes.classClashes.length + scheduleClashes.bookingClashes.length}</span>
              )}
            </button>
          )}
          {canManage && (
            <button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}>Activity log</button>
          )}
          {canManageStaff && (
            <button className={view === 'staff' ? 'active' : ''} onClick={() => setView('staff')}>
              Staff{accessRequests.length > 0 && <span className="tab-badge">{accessRequests.length}</span>}
            </button>
          )}
        </nav>
      </header>

      <main>
        <div className="panel no-print filter-bar" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <details className="room-multiselect">
            <summary className={filterRooms.length ? 'has-selection' : ''}>
              {filterRooms.length === 0
                ? 'All rooms'
                : (ROOM_GROUPS.find(g => sameRoomSet(filterRooms, g.rooms))?.name
                  || `${filterRooms.length} room${filterRooms.length === 1 ? '' : 's'} selected`)}
            </summary>
            <div className="room-multiselect-panel">
              {filterRooms.length > 0 && (
                <button type="button" className="cta ghost" style={{ width: '100%', marginBottom: 8 }} onClick={() => setFilterRooms([])}>
                  Clear room selection
                </button>
              )}
              <div className="room-group-buttons">
                {ROOM_GROUPS.map(g => (
                  <button
                    type="button"
                    key={g.id}
                    className={`cta ghost ${sameRoomSet(filterRooms, g.rooms) ? 'active' : ''}`}
                    onClick={() => setFilterRooms(g.rooms)}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
              <div className="day-checkboxes" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                {ROOM_GROUPS.map(g => (
                  <div key={g.id} style={{ display: 'contents' }}>
                    <p className="room-group-heading">{g.name}</p>
                    {g.rooms.map(id => (
                      <label key={id} className={`day-checkbox ${filterRooms.includes(id) ? 'checked' : ''}`}>
                        <input type="checkbox" checked={filterRooms.includes(id)} onChange={() => toggleFilterRoom(id)} />
                        {roomName(id)}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </details>
          <MultiSelectFilter allLabel="All teachers" noun="teachers" options={teacherOptions} selected={filterTeachers} onChange={setFilterTeachers} />
          <MultiSelectFilter allLabel="All courses" noun="courses" options={courseOptions} selected={filterCourses} onChange={setFilterCourses} />
          <select value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">Classes + bookings</option>
            <option value="class">Regular classes only</option>
            <option value="booking">Student bookings only</option>
          </select>
          {(filterRooms.length > 0 || filterTeachers.length > 0 || filterCourses.length > 0 || filterType !== 'all') && (
            <button className="cta ghost" onClick={() => { setFilterRooms([]); setFilterTeachers([]); setFilterCourses([]); setFilterType('all'); }}>
              Clear filters
            </button>
          )}
          <button className="cta" style={{ marginLeft: 'auto' }} onClick={() => (showAddForm ? closeAddForm() : setShowAddForm(true))}>
            {showAddForm ? 'Cancel' : '+ Add regular class'}
          </button>
        </div>

        {showAddForm && (
          <form className="panel" onSubmit={handleAddClass}>
            <h3>{convertingBooking ? 'Convert booking to regular class' : 'New regular class'}</h3>
            {convertingBooking && (
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: -8, marginBottom: '1rem' }}>
                Was: {convertingBooking.studentName}{convertingBooking.purpose ? ` — ${convertingBooking.purpose}` : ''} on {convertingBooking.date}.
                Pick every day of the week this class actually runs on, and how far back/forward it should apply.
              </p>
            )}
            {addError && <div className="inline-error">{addError}</div>}
            <div className="field-row">
              <div className="field">
                <label htmlFor="add-room">Room</label>
                <select id="add-room" value={addForm.room_id} onChange={e => setAddForm({ ...addForm, room_id: e.target.value })}>
                  <option value="">Choose a room</option>
                  {ROOMS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Days of week</label>
              <div className="day-checkboxes">
                {DAY_NAMES.filter(d => d !== 'Sunday').concat('Sunday').map(d => (
                  <label key={d} className={`day-checkbox ${addForm.days.includes(d) ? 'checked' : ''}`}>
                    <input type="checkbox" checked={addForm.days.includes(d)} onChange={() => toggleFormDay(d)} />
                    {d.slice(0, 3)}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Time for each selected day</label>
              <div className="day-time-list">
                {DAY_NAMES.filter(d => d !== 'Sunday').concat('Sunday').filter(d => addForm.days.includes(d)).map(day => (
                  <div className="day-time-row" key={day}>
                    <span className="day-time-label">{day}</span>
                    <input
                      type="time"
                      value={addForm.dayTimes[day]?.start || ''}
                      onChange={e => setDayTime(day, 'start', e.target.value)}
                    />
                    <span className="day-time-sep">to</span>
                    <input
                      type="time"
                      value={addForm.dayTimes[day]?.end || ''}
                      onChange={e => setDayTime(day, 'end', e.target.value)}
                    />
                  </div>
                ))}
                {addForm.days.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>Pick a day above first.</p>
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor="add-batch">Batch name</label>
              <input id="add-batch" type="text" placeholder="e.g. BHIS - Guitar" value={addForm.batch} onChange={e => setAddForm({ ...addForm, batch: e.target.value })} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="add-teacher">Teacher</label>
                <input id="add-teacher" type="text" placeholder="e.g. Pradeep Sir" value={addForm.teacher} onChange={e => setAddForm({ ...addForm, teacher: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="add-course">Course</label>
                <input id="add-course" type="text" placeholder="e.g. Guitar" value={addForm.course} onChange={e => setAddForm({ ...addForm, course: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="add-startdate">Start date (optional)</label>
              <input id="add-startdate" type="date" value={addForm.start_date} onChange={e => setAddForm({ ...addForm, start_date: e.target.value })} />
            </div>
            <div className="field">
              <label className="ongoing-toggle">
                <input
                  type="checkbox"
                  checked={addForm.ongoing}
                  onChange={e => setAddForm({ ...addForm, ongoing: e.target.checked, end_date: e.target.checked ? '' : addForm.end_date })}
                />
                Regular class — runs indefinitely until removed
              </label>
            </div>
            {!addForm.ongoing && (
              <div className="field">
                <label htmlFor="add-enddate">End date</label>
                <input id="add-enddate" type="date" value={addForm.end_date} onChange={e => setAddForm({ ...addForm, end_date: e.target.value })} />
              </div>
            )}
            <button className="cta" type="submit" disabled={saving}>
              {saving ? 'Saving…' : convertingBooking ? 'Convert to regular class' : 'Save class'}
            </button>
          </form>
        )}

        {(view === 'today' || view === 'day') && (
          <div className="panel">
            <div className="period-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <button className="cta ghost no-print" onClick={() => shiftDate(-1)}>&larr; Prev</button>
              <h3 style={{ margin: 0, textTransform: 'none', fontSize: 15, color: 'var(--ink)' }}>{dayLabel(selectedDate)}</h3>
              <button className="cta ghost no-print" onClick={() => shiftDate(1)}>Next &rarr;</button>
            </div>
            {loading ? <p style={{ color: 'var(--ink-soft)' }}>Loading…</p> : (
              <div className="sched-list">
                {scheduleForDate(selectedDate).length === 0
                  ? <p style={{ color: 'var(--ink-soft)' }}>Nothing scheduled.</p>
                  : scheduleForDate(selectedDate).map(renderEntry)}
              </div>
            )}
            {canManage && (
              <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '1.5rem', flexWrap: 'wrap' }}>
                <button className="cta ghost" onClick={selectAllBookingsToday}>Select all bookings shown</button>
                {selectedCount > 0 && (
                  <>
                    <button className="cta ghost" onClick={() => setSelectedGroups({})}>Clear selection</button>
                    <button className="cta" onClick={openBulkReschedule}>
                      Reschedule {selectedCount} selected…
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
              <button className="cta ghost" onClick={exportDay}>Export to Excel</button>
              <button className="cta ghost" onClick={() => window.print()}>Print / Save as PDF</button>
            </div>
          </div>
        )}

        {view === 'week' && (
          <div className="panel">
            <div className="period-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <button className="cta ghost no-print" onClick={() => shiftDate(-7)}>&larr; Prev week</button>
              <h3 style={{ margin: 0, textTransform: 'none', fontSize: 15, color: 'var(--ink)' }}>
                {shortDayLabel(weekDays[0])} – {shortDayLabel(weekDays[6])}
              </h3>
              <button className="cta ghost no-print" onClick={() => shiftDate(7)}>Next week &rarr;</button>
            </div>
            {loading ? <p style={{ color: 'var(--ink-soft)' }}>Loading…</p> : (
              <div className="week-grid">
                {weekDays.map((d, i) => (
                  <div className="week-day" key={i}>
                    <div className="week-day-head">{shortDayLabel(d)}</div>
                    <div className="sched-list sched-list-compact">
                      {scheduleForDate(d).length === 0
                        ? <p style={{ color: 'var(--ink-soft)', fontSize: 12 }}>—</p>
                        : scheduleForDate(d).map((e, j) => (
                          <div
                            className={`sched-chip ${e.type === 'class' ? 'sched-chip-class' : 'sched-chip-booking'} ${e.inactive ? 'sched-chip-inactive' : ''} ${e.exceptionKind === 'moved-here' ? 'sched-chip-oneoff' : ''}`}
                            key={j}
                            title={e.type === 'class' ? [e.batch, e.course, e.teacher].filter(Boolean).join(' · ') : e.purpose}
                          >
                            <div>{minutesToLabel(e.startMinutes)} · {roomName(e.room_id)}</div>
                            <div>
                              {e.type === 'class' ? (e.batch || e.course || 'Class') : e.studentName}
                              {e.exceptionKind === 'cancelled' ? ' (cancelled)' : e.exceptionKind === 'moved-away' ? ' (moved)' : e.exceptionKind === 'moved-here' ? ' (moved here)' : ''}
                            </div>
                            {e.type === 'class' && e.teacher && (
                              <div className="sched-chip-teacher">{e.teacher}</div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: '1.5rem' }}>
              <button className="cta ghost" onClick={exportWeek}>Export to Excel</button>
              <button className="cta ghost" onClick={() => window.print()}>Print / Save as PDF</button>
            </div>
          </div>
        )}

        {view === 'month' && (
          <div className="panel">
            <div className="period-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <button className="cta ghost no-print" onClick={() => shiftMonth(-1)}>&larr; Prev month</button>
              <h3 style={{ margin: 0, textTransform: 'none', fontSize: 15, color: 'var(--ink)' }}>{monthLabel(selectedDate)}</h3>
              <button className="cta ghost no-print" onClick={() => shiftMonth(1)}>Next month &rarr;</button>
            </div>
            {loading ? <p style={{ color: 'var(--ink-soft)' }}>Loading…</p> : (
              <div className="month-grid">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div className="month-grid-head" key={d}>{d}</div>
                ))}
                {monthGridDays.map((d, i) => {
                  const entries = scheduleForDate(d);
                  const classCount = entries.filter(e => e.type === 'class' && !e.inactive).length;
                  const bookingCount = entries.filter(e => e.type === 'booking').length;
                  const inMonth = d.getMonth() === selectedDate.getMonth();
                  return (
                    <button
                      key={i}
                      className={`month-cell ${inMonth ? '' : 'month-cell-dim'}`}
                      onClick={() => { setSelectedDate(d); setView('day'); }}
                    >
                      <div className="month-cell-num">{d.getDate()}</div>
                      {classCount > 0 && <div className="month-cell-count sched-tag-class">{classCount} class{classCount === 1 ? '' : 'es'}</div>}
                      {bookingCount > 0 && <div className="month-cell-count sched-tag-booking">{bookingCount} booking{bookingCount === 1 ? '' : 's'}</div>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {view === 'all' && (
          <div className="panel">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>All bookings</h3>
              <select
                value={allBookingsWhen}
                onChange={e => setAllBookingsWhen(e.target.value)}
                aria-label="Which bookings to show"
                className="no-print"
                style={{
                  fontFamily: "'Inter',sans-serif", fontSize: 13, padding: '8px 12px', borderRadius: 7,
                  border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)',
                }}
              >
                <option value="upcoming">Upcoming bookings</option>
                <option value="past">Past bookings</option>
                <option value="all">All bookings (incl. past)</option>
              </select>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                {mergedAllBookings.length} {mergedAllBookings.length === 1 ? 'entry' : 'entries'}
              </span>
              <input
                type="text"
                placeholder="Search name, email or purpose…"
                value={allBookingsSearch}
                onChange={e => setAllBookingsSearch(e.target.value)}
                style={{
                  marginLeft: 'auto', fontFamily: "'Inter',sans-serif", fontSize: 13,
                  padding: '8px 12px', borderRadius: 7, border: '1px solid var(--line)',
                  background: 'var(--paper)', color: 'var(--ink)', minWidth: 220,
                }}
              />
            </div>
            {allBookingsTruncated && (
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 0 }}>
                Showing the most recent 1000 bookings. Use search or the Room filter above to narrow this down.
              </p>
            )}
            {allBookingsLoading ? (
              <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>
            ) : (
              <div className="sched-list">
                {mergedAllBookings.map(entry => (
                  <div className="sched-row" key={entry.key}>
                    <span className="sched-time">{`${entry.date} \u00b7 ${minutesToLabel(entry.startMinutes)} \u2013 ${minutesToLabel(entry.endMinutes)}`}</span>
                    <span className="sched-room">{roomName(entry.room_id)}</span>
                    <span className="sched-title">{entry.studentName}{entry.purpose ? ` — ${entry.purpose}` : ''}</span>
                    <span className="sched-tag sched-tag-booking">Booking</span>
                    {canManage && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="cta ghost sched-remove" onClick={() => openConvert(entry)}>Convert to class</button>
                        <button className="cta ghost sched-remove" onClick={() => openEdit(entry)}>Reschedule</button>
                        <button
                          className="cta ghost sched-remove"
                          onClick={() => handleDeleteBooking(entry)}
                          disabled={deletingId === entry.id}
                        >
                          {deletingId === entry.id ? 'Cancelling…' : 'Remove'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {mergedAllBookings.length === 0 && (
                  <p style={{ color: 'var(--ink-soft)' }}>
                    {allBookingsWhen === 'upcoming' ? 'No upcoming bookings match.' : allBookingsWhen === 'past' ? 'No past bookings match.' : 'No bookings match.'}
                  </p>
                )}
              </div>
            )}
            <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: '1.5rem' }}>
              <button className="cta ghost" onClick={exportAllBookings}>Export to Excel</button>
              <button className="cta ghost" onClick={() => window.print()}>Print / Save as PDF</button>
            </div>
          </div>
        )}

        {view === 'requests' && canManage && (
          <div className="panel">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Booking requests</h3>
              <button className="cta ghost" style={{ marginLeft: 'auto' }} onClick={fetchRequests} disabled={requestsLoading}>
                {requestsLoading ? 'Refreshing\u2026' : 'Refresh'}
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 0 }}>
              Requests for Room No 9, Room No 10 and Basement Hall wait here until approved. A pending request holds its slot so nobody else can request the same time, but it doesn&rsquo;t appear on the schedule views until it&rsquo;s approved. Rejecting frees the slot again. The student is emailed either way.
            </p>
            {requestsLoading && requests.length === 0 ? (
              <p style={{ color: 'var(--ink-soft)' }}>Loading&hellip;</p>
            ) : requests.length === 0 ? (
              <p style={{ color: 'var(--ink-soft)' }}>No pending requests.</p>
            ) : (
              <div className="sched-list">
                {requests.map(r => {
                  const key = r.ids.join();
                  const busy = requestActionKey === key;
                  return (
                    <div className="booking-row" key={key}>
                      <div className="meta">
                        <b>{r.student_name}</b>
                        <span className="status-pill status-pending" style={{ marginLeft: 8 }}>Awaiting approval</span>
                        <br />
                        <b>{roomName(r.room_id)}</b> &middot; {r.date} &middot; {requestTimeLabel(r.slots)}
                        <br />
                        {r.email}{r.phone ? ` \u00b7 ${r.phone}` : ''}
                        {r.purpose && (<><br />Purpose: {r.purpose}</>)}
                        {r.conflicts && r.conflicts.length > 0 && (
                          <span className="request-conflict">
                            &#9888; Overlaps with {r.conflicts.map(c => `${c.time} ${c.label}${c.moved ? ' (moved here for this date)' : ''}`).join('; ')} &mdash; use Edit timing or check before approving.
                          </span>
                        )}
                        <br />
                        <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                          Requested {new Date(r.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="request-actions">
                        <button className="cta" disabled={busy || editingRequestKey === key} onClick={() => handleRequestAction(r, 'approve')}>
                          {busy && editingRequestKey !== key ? 'Saving\u2026' : 'Approve'}
                        </button>
                        <button className="cta ghost" disabled={busy} onClick={() => (editingRequestKey === key ? setEditingRequestKey(null) : openRequestEdit(r))}>
                          {editingRequestKey === key ? 'Close edit' : 'Edit timing'}
                        </button>
                        <button className="cta ghost" disabled={busy} onClick={() => handleRequestAction(r, 'reject')}>
                          Reject
                        </button>
                      </div>
                      {editingRequestKey === key && (
                        <div className="request-edit">
                          <div className="request-edit-fields">
                            <label>
                              Room
                              <select value={requestEdit.room_id} onChange={e => setRequestEdit({ ...requestEdit, room_id: e.target.value })}>
                                {BOOKABLE_ROOMS.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                              </select>
                            </label>
                            <label>
                              Date
                              <input type="date" value={requestEdit.date} onChange={e => setRequestEdit({ ...requestEdit, date: e.target.value })} />
                            </label>
                            <label>
                              From
                              <select
                                value={requestEdit.start}
                                onChange={e => {
                                  const start = Number(e.target.value);
                                  setRequestEdit({ ...requestEdit, start, end: Math.max(requestEdit.end, start + 30) });
                                }}
                              >
                                {ADMIN_TIME_OPTIONS.slice(0, -1).map(m => <option key={m} value={m}>{minutesToLabel(m)}</option>)}
                              </select>
                            </label>
                            <label>
                              To
                              <select value={requestEdit.end} onChange={e => setRequestEdit({ ...requestEdit, end: Number(e.target.value) })}>
                                {ADMIN_TIME_OPTIONS.filter(m => m > requestEdit.start).map(m => <option key={m} value={m}>{minutesToLabel(m)}</option>)}
                              </select>
                            </label>
                          </div>
                          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '8px 0' }}>
                            Was: {roomName(r.room_id)} &middot; {r.date} &middot; {requestTimeLabel(r.slots)}. You can set times outside public hours (7am&ndash;11pm).
                          </p>
                          <button className="cta" disabled={busy} onClick={() => handleApproveWithChanges(r)}>
                            {busy ? 'Saving\u2026' : 'Approve with changes'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {view === 'assistant' && (
          <div className="panel">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Assistant</h3>
              {chatMessages.length > 0 && (
                <button className="cta ghost" style={{ marginLeft: 'auto' }} onClick={() => { setChatMessages([]); setChatError(''); }}>
                  New chat
                </button>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 0 }}>
              Ask about room or teacher availability. It checks live classes, bookings and pending requests. It can only look things up &mdash; it can&rsquo;t book or change anything.
            </p>

            <div className="chat-log">
              {chatMessages.length === 0 && (
                <div className="chat-examples">
                  {[
                    'Is Room No 10 available on Saturday at 6pm?',
                    'Which rooms are free tomorrow 5pm to 7pm?',
                    'Is Ansh free on Friday between 4 and 6pm?',
                    'Which teachers match \u201cShra\u201d?',
                    'What is on in Basement Hall this Sunday?',
                  ].map(q => (
                    <button type="button" key={q} className="chat-example" onClick={() => sendChat(q)}>{q}</button>
                  ))}
                </div>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  <div className={`chat-bubble chat-${m.role}`}>{m.content}</div>
                  {m.suggestions && m.suggestions.length > 0 && i === chatMessages.length - 1 && (
                    <div className="chat-examples">
                      <span style={{ fontSize: 12, color: 'var(--ink-soft)', alignSelf: 'center' }}>Did you mean:</span>
                      {m.suggestions.map(name => (
                        <button type="button" key={name} className="chat-example" disabled={chatSending} onClick={() => sendChat(`I mean ${name}`)}>
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {chatSending && <div className="chat-bubble chat-assistant chat-typing">Checking the schedule&hellip;</div>}
              {chatError && <p className="inline-error" style={{ color: 'var(--maroon)', fontSize: 13 }}>{chatError}</p>}
            </div>

            <form
              className="chat-form"
              onSubmit={e => { e.preventDefault(); sendChat(); }}
            >
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="e.g. Is Room 10 free on Saturday at 6pm?"
                maxLength={500}
                disabled={chatSending}
              />
              <button className="cta" type="submit" disabled={chatSending || !chatInput.trim()}>
                {chatSending ? 'Asking\u2026' : 'Ask'}
              </button>
            </form>
          </div>
        )}

        {view === 'clashes' && canManage && (
          <div className="panel">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Clash check</h3>
              <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', color: 'var(--ink-soft)' }}>
                <input type="checkbox" checked={clashIncludeOnline} onChange={e => setClashIncludeOnline(e.target.checked)} />
                Include online, private &amp; school class groups
              </label>
              <button className="cta" style={{ marginLeft: 'auto' }} onClick={runClashCheck} disabled={clashChecking}>
                {clashChecking ? 'Checking\u2026' : 'Check now'}
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 0 }}>
              Finds regular classes in the same space, on the same day, at overlapping times (and whose date ranges overlap), plus upcoming bookings that sit on top of a regular class. Classes that have already ended are ignored.
              {clashCheckedAt && <> Last checked {clashCheckedAt.toLocaleTimeString()}.</>}
            </p>

            {clashesByRoom.length > 0 && (
              <div className="clash-rooms">
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Clashes by room:</span>
                <button
                  type="button"
                  className={`clash-room-chip ${filterRooms.length === 0 ? 'active' : ''}`}
                  onClick={() => setFilterRooms([])}
                >
                  All rooms <b>{scheduleClashes.classClashes.length + scheduleClashes.bookingClashes.length}</b>
                </button>
                {clashesByRoom.map(r => (
                  <button
                    type="button"
                    key={r.id}
                    className={`clash-room-chip ${filterRooms.length === 1 && filterRooms[0] === r.id ? 'active' : ''}`}
                    onClick={() => setFilterRooms([r.id])}
                  >
                    {r.name} <b>{r.count}</b>
                  </button>
                ))}
              </div>
            )}
            {filterRooms.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                Showing {filterRooms.length === 1 ? roomName(filterRooms[0]) : (ROOM_GROUPS.find(g => sameRoomSet(filterRooms, g.rooms))?.name || `${filterRooms.length} selected rooms`)} only (room filter at the top).{' '}
                <button type="button" className="link-button" onClick={() => setFilterRooms([])}>Show all rooms</button>
              </p>
            )}

            <h4 className="clash-heading">
              Class vs class
              <span className="clash-count">{visibleClashes.classClashes.length}</span>
            </h4>
            {visibleClashes.classClashes.length === 0 ? (
              <p style={{ color: 'var(--ink-soft)' }}>No clashing regular classes. &#10003;</p>
            ) : (
              <div className="sched-list">
                {visibleClashes.classClashes.map(c => (
                  <div className="clash-card" key={c.key}>
                    <div className="clash-card-head">
                      <b>{roomName(c.room_id)}</b> &middot; {c.kind === 'one-off' ? `on ${prettyDateKey(c.date)}` : `every ${c.day}`} &middot; overlap {minutesToLabel(c.overlapStart)}&ndash;{minutesToLabel(c.overlapEnd)}
                      {c.spaces > 1 && c.kind === 'overlap' && (
                        <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                          &middot; {c.items.length} classes at once, only {c.spaces} rooms
                        </span>
                      )}
                      <span className={`clash-kind clash-kind-${c.kind === 'one-off' ? 'overlap' : c.kind}`}>{c.kind === 'duplicate' ? 'Duplicate entry' : c.kind === 'one-off' ? 'Moved session' : 'Overlap'}</span>
                    </div>
                    {c.items.map(b => (
                      <div className="clash-item" key={`${b.id}|${b.exceptionKind || ''}`}>
                        <span>
                          {classClashLine(b)}
                          {b.exceptionKind === 'moved-here' ? ` \u00b7 moved here from ${prettyDateKey(b.exception.original_date)}` : ''}
                        </span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {b.exceptionKind === 'moved-here' ? (
                            <button className="cta ghost sched-remove" onClick={() => openSessionChange({ id: b.id, exception: b.exception })}>Change this date</button>
                          ) : (
                            <button className="cta ghost sched-remove" onClick={() => openEditBlock(b)}>Edit</button>
                          )}
                          {b.exceptionKind !== 'moved-here' && (
                            <button className="cta ghost sched-remove" disabled={deletingId === b.id} onClick={() => handleDeleteBlock(b.id)}>
                              {deletingId === b.id ? 'Removing\u2026' : 'Remove'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <h4 className="clash-heading">
              Booking vs class (upcoming)
              <span className="clash-count">{visibleClashes.bookingClashes.length}</span>
            </h4>
            {visibleClashes.bookingClashes.length === 0 ? (
              <p style={{ color: 'var(--ink-soft)' }}>No upcoming bookings clash with a regular class. &#10003;</p>
            ) : (
              <div className="sched-list">
                {visibleClashes.bookingClashes.map(({ key, entry, block }) => (
                  <div className="clash-card" key={key}>
                    <div className="clash-card-head">
                      <b>{roomName(entry.room_id)}</b> &middot; {entry.date}
                      <span className="clash-kind clash-kind-overlap">Overlap</span>
                    </div>
                    <div className="clash-item">
                      <span>
                        <span className="sched-tag sched-tag-booking" style={{ marginRight: 8 }}>Booking</span>
                        {minutesToLabel(entry.startMinutes)}&ndash;{minutesToLabel(entry.endMinutes)} &middot; {entry.studentName}{entry.purpose ? ` \u2014 ${entry.purpose}` : ''}
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="cta ghost sched-remove" onClick={() => openEdit(entry)}>Reschedule</button>
                        <button className="cta ghost sched-remove" disabled={deletingId === entry.id} onClick={() => handleDeleteBooking(entry)}>
                          {deletingId === entry.id ? 'Cancelling\u2026' : 'Remove'}
                        </button>
                      </div>
                    </div>
                    <div className="clash-item">
                      <span>
                        <span className="sched-tag sched-tag-class" style={{ marginRight: 8 }}>Class</span>
                        {classClashLine(block)}
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="cta ghost sched-remove" onClick={() => openEditBlock(block)}>Edit</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'activity' && (
          <div className="panel">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Activity log</h3>
              <input
                type="text"
                placeholder="Search by person or what changed…"
                value={activitySearch}
                onChange={e => setActivitySearch(e.target.value)}
                style={{
                  marginLeft: 'auto', fontFamily: "'Inter',sans-serif", fontSize: 13,
                  padding: '8px 12px', borderRadius: 7, border: '1px solid var(--line)',
                  background: 'var(--paper)', color: 'var(--ink)', minWidth: 220,
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 0 }}>
              Showing the most recent 500 changes made from this dashboard. Bookings students make themselves aren't logged here — only staff actions are: adding/editing/removing classes, rescheduling/cancelling bookings, and adding/removing staff accounts.
            </p>
            {activityLoading ? (
              <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>
            ) : (
              <div className="sched-list">
                {filteredActivity.map(e => (
                  <div className="booking-row" key={e.id}>
                    <div className="meta">
                      <b>{e.user_name}</b>
                      <span className="status-pill" style={{ marginLeft: 8 }}>
                        {e.action === 'create' ? 'Added' : e.action === 'update' ? 'Edited' : 'Removed'}
                      </span>
                      <br />
                      {e.summary}
                      <br />
                      <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                        {new Date(e.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
                {filteredActivity.length === 0 && <p style={{ color: 'var(--ink-soft)' }}>No activity recorded yet.</p>}
              </div>
            )}
          </div>
        )}

        {view === 'staff' && (
          <div className="panel">
            <h3>Access requests</h3>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: -6 }}>
              People who signed in with Google but aren&rsquo;t staff yet. Approving creates their account &mdash; they then sign in with Google, no password needed.
            </p>
            {accessRequests.length === 0 ? (
              <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>No pending requests.</p>
            ) : (
              <div className="sched-list" style={{ marginBottom: '1.6rem' }}>
                {accessRequests.map(r => (
                  <div className="booking-row" key={r.id}>
                    <div className="meta">
                      <b>{r.name || r.email}</b>
                      <span className="status-pill status-pending" style={{ marginLeft: 8 }}>Awaiting approval</span>
                      <br />
                      {r.email}
                      <br />
                      <span style={{ fontSize: 11 }}>Requested {new Date(r.requested_at).toLocaleString()}</span>
                    </div>
                    <div className="request-actions">
                      <select
                        value={accessRoles[r.id] || 'staff'}
                        onChange={e => setAccessRoles({ ...accessRoles, [r.id]: e.target.value })}
                        aria-label="Access level"
                      >
                        <option value="staff">Staff</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button className="cta" disabled={accessBusyId === r.id} onClick={() => handleAccessRequest(r, 'approve')}>
                        {accessBusyId === r.id ? 'Saving\u2026' : 'Approve'}
                      </button>
                      <button className="cta ghost" disabled={accessBusyId === r.id} onClick={() => handleAccessRequest(r, 'reject')}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3 style={{ marginTop: '1.6rem' }}>Add a staff member</h3>
            {staffError && <div className="inline-error">{staffError}</div>}
            <form onSubmit={handleAddStaff}>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="staff-name">Name</label>
                  <input id="staff-name" type="text" placeholder="e.g. Priya Sharma" value={staffForm.name} onChange={e => setStaffForm({ ...staffForm, name: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="staff-email">Email</label>
                  <input id="staff-email" type="email" placeholder="priya@ajivasan.com" value={staffForm.email} onChange={e => setStaffForm({ ...staffForm, email: e.target.value })} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="staff-password">Password</label>
                  <input id="staff-password" type="password" placeholder="Optional \u2014 blank = Google sign-in only" value={staffForm.password} onChange={e => setStaffForm({ ...staffForm, password: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="staff-role">Access level</label>
                  <select id="staff-role" value={staffForm.role} onChange={e => setStaffForm({ ...staffForm, role: e.target.value })}>
                    <option value="staff">Staff — can only add a regular class</option>
                    <option value="admin">Admin — can edit/remove classes and bookings</option>
                  </select>
                </div>
              </div>
              <button className="cta" type="submit" disabled={staffSaving}>{staffSaving ? 'Adding…' : 'Add staff member'}</button>
            </form>

            <h3 style={{ marginTop: '2rem' }}>Current staff</h3>
            {staffLoading ? (
              <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>
            ) : (
              <div className="sched-list">
                {staffList.map(s => (
                  <div className="booking-row" key={s.id}>
                    <div className="meta">
                      <b>{s.name}</b>
                      <span className="status-pill" style={{ marginLeft: 8 }}>
                        {s.role === 'super_admin' ? 'Super admin' : s.role === 'admin' ? 'Admin' : 'Staff'}
                      </span>
                      <br />
                      {s.email}
                    </div>
                    {s.role !== 'super_admin' && (
                      <button className="cta ghost sched-remove" onClick={() => handleDeleteStaff(s.id)} disabled={staffDeletingId === s.id}>
                        {staffDeletingId === s.id ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                  </div>
                ))}
                {staffList.length === 0 && <p style={{ color: 'var(--ink-soft)' }}>No staff accounts yet.</p>}
              </div>
            )}
          </div>
        )}
      </main>

      {editingBooking && (
        <div className="modal-backdrop" onClick={() => setEditingBooking(null)}>
          <div className="modal-panel panel" onClick={e => e.stopPropagation()}>
            <h3>Reschedule booking</h3>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: -8, marginBottom: '1rem' }}>
              {editingBooking.studentName}{editingBooking.purpose ? ` — ${editingBooking.purpose}` : ''}
            </p>
            <form onSubmit={handleSaveEdit}>
              {editError && <div className="inline-error">{editError}</div>}
              <div className="field">
                <label htmlFor="edit-room">Room</label>
                <select id="edit-room" value={editForm.room_id} onChange={e => setEditForm({ ...editForm, room_id: e.target.value })}>
                  {BOOKABLE_ROOMS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="edit-date">Date</label>
                  <input id="edit-date" type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="edit-start">From</label>
                  <select
                    id="edit-start"
                    value={editForm.start}
                    onChange={e => {
                      const start = Number(e.target.value);
                      // Keep the same length when only the start moves.
                      const length = editForm.end - editForm.start;
                      setEditForm({ ...editForm, start, end: Math.min(start + length, 23 * 60) });
                    }}
                  >
                    {ADMIN_TIME_OPTIONS.slice(0, -1).map(m => <option key={m} value={m}>{minutesToLabel(m)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="edit-end">To</label>
                  <select id="edit-end" value={editForm.end} onChange={e => setEditForm({ ...editForm, end: Number(e.target.value) })}>
                    {ADMIN_TIME_OPTIONS.filter(m => m > editForm.start).map(m => <option key={m} value={m}>{minutesToLabel(m)}</option>)}
                  </select>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: -4 }}>
                Was: {roomName(editingBooking.room_id)} &middot; {editingBooking.date} &middot; {minutesToLabel(editingBooking.startMinutes)} &ndash; {minutesToLabel(editingBooking.endMinutes)}
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="cta" type="submit" disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save new time'}</button>
                <button className="cta ghost" type="button" onClick={() => setEditingBooking(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {sessionChange && (
        <div className="modal-backdrop" onClick={() => !sessionSaving && setSessionChange(null)}>
          <div className="modal-panel panel" onClick={e => e.stopPropagation()}>
            <h3>Change this date only</h3>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: -8, marginBottom: '1rem' }}>
              <b style={{ color: 'var(--ink)' }}>
                {sessionChange.block.batch || sessionChange.block.course || 'Class'}
                {sessionChange.block.teacher ? ` \u2014 ${sessionChange.block.teacher}` : ''}
              </b>
              <br />
              Usually {sessionChange.block.day_of_week}s, {minutesToLabel(timeToMinutes(sessionChange.block.start_time))}&ndash;{minutesToLabel(timeToMinutes(sessionChange.block.end_time))}, {roomName(sessionChange.block.room_id)}.
              <br />
              This change applies to <b style={{ color: 'var(--ink)' }}>{prettyDateKey(sessionChange.originalDate)}</b> only &mdash; every other week stays as it is.
            </p>
            {sessionError && <div className="inline-error">{sessionError}</div>}

            <div className="field">
              <div className="day-checkboxes">
                <label className={`day-checkbox ${sessionForm.status === 'moved' ? 'checked' : ''}`}>
                  <input type="radio" name="session-status" checked={sessionForm.status === 'moved'} onChange={() => setSessionForm({ ...sessionForm, status: 'moved' })} />
                  Move this session
                </label>
                <label className={`day-checkbox ${sessionForm.status === 'cancelled' ? 'checked' : ''}`}>
                  <input type="radio" name="session-status" checked={sessionForm.status === 'cancelled'} onChange={() => setSessionForm({ ...sessionForm, status: 'cancelled' })} />
                  Cancel this session
                </label>
              </div>
            </div>

            {sessionForm.status === 'moved' && (
              <>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="session-date">New date</label>
                    <input id="session-date" type="date" value={sessionForm.new_date} onChange={e => setSessionForm({ ...sessionForm, new_date: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="session-room">Room</label>
                    <select id="session-room" value={sessionForm.new_room_id} onChange={e => setSessionForm({ ...sessionForm, new_room_id: e.target.value })}>
                      {ROOMS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="session-start">Start time</label>
                    <input id="session-start" type="time" value={sessionForm.new_start} onChange={e => setSessionForm({ ...sessionForm, new_start: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="session-end">End time</label>
                    <input id="session-end" type="time" value={sessionForm.new_end} onChange={e => setSessionForm({ ...sessionForm, new_end: e.target.value })} />
                  </div>
                </div>
              </>
            )}

            <div className="field">
              <label htmlFor="session-note">Note (optional)</label>
              <input id="session-note" type="text" maxLength={300} placeholder="e.g. Teacher on leave, made up on Thursday" value={sessionForm.note} onChange={e => setSessionForm({ ...sessionForm, note: e.target.value })} />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="cta" onClick={() => saveSessionChange(false)} disabled={sessionSaving}>
                {sessionSaving ? 'Saving\u2026' : sessionForm.status === 'moved' ? 'Move this session' : 'Cancel this session'}
              </button>
              {sessionChange.existing && (
                <button className="cta ghost" onClick={() => undoSessionChange(sessionChange.existing)} disabled={sessionSaving}>
                  Undo change (back to usual)
                </button>
              )}
              <button className="cta ghost" onClick={() => setSessionChange(null)} disabled={sessionSaving}>Close</button>
            </div>
          </div>
        </div>
      )}

      {editingBlock && (
        <div className="modal-backdrop" onClick={() => setEditingBlock(null)}>
          <div className="modal-panel panel" onClick={e => e.stopPropagation()}>
            <h3>Edit regular class</h3>
            <form onSubmit={handleSaveEditBlock}>
              {blockEditError && <div className="inline-error">{blockEditError}</div>}
              <div className="field">
                <label htmlFor="block-edit-room">Room</label>
                <select id="block-edit-room" value={blockEditForm.room_id} onChange={e => setBlockEditForm({ ...blockEditForm, room_id: e.target.value })}>
                  {ROOMS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="block-edit-day">Day of week</label>
                  <select id="block-edit-day" value={blockEditForm.day_of_week} onChange={e => setBlockEditForm({ ...blockEditForm, day_of_week: e.target.value })}>
                    {DAY_NAMES.filter(d => d !== 'Sunday').concat('Sunday').map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="block-edit-start">Start time</label>
                  <input id="block-edit-start" type="time" value={blockEditForm.start_time} onChange={e => setBlockEditForm({ ...blockEditForm, start_time: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="block-edit-end">End time</label>
                  <input id="block-edit-end" type="time" value={blockEditForm.end_time} onChange={e => setBlockEditForm({ ...blockEditForm, end_time: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="block-edit-batch">Batch name</label>
                <input id="block-edit-batch" type="text" value={blockEditForm.batch} onChange={e => setBlockEditForm({ ...blockEditForm, batch: e.target.value })} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="block-edit-teacher">Teacher</label>
                  <input id="block-edit-teacher" type="text" value={blockEditForm.teacher} onChange={e => setBlockEditForm({ ...blockEditForm, teacher: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="block-edit-course">Course</label>
                  <input
                    id="block-edit-course"
                    type="text"
                    list="course-suggestions"
                    placeholder="e.g. Hindustani Classical Vocals"
                    value={blockEditForm.course}
                    onChange={e => setBlockEditForm({ ...blockEditForm, course: e.target.value })}
                  />
                  <datalist id="course-suggestions">
                    {courseOptions.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>
              <div className="field">
                <label htmlFor="block-edit-startdate">Start date (optional)</label>
                <input id="block-edit-startdate" type="date" value={blockEditForm.start_date} onChange={e => setBlockEditForm({ ...blockEditForm, start_date: e.target.value })} />
              </div>
              <div className="field">
                <label className="ongoing-toggle">
                  <input
                    type="checkbox"
                    checked={blockEditForm.ongoing}
                    onChange={e => setBlockEditForm({ ...blockEditForm, ongoing: e.target.checked, end_date: e.target.checked ? '' : blockEditForm.end_date })}
                  />
                  Regular class — runs indefinitely until removed
                </label>
              </div>
              {!blockEditForm.ongoing && (
                <div className="field">
                  <label htmlFor="block-edit-enddate">End date</label>
                  <input id="block-edit-enddate" type="date" value={blockEditForm.end_date} onChange={e => setBlockEditForm({ ...blockEditForm, end_date: e.target.value })} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="cta" type="submit" disabled={savingBlockEdit}>{savingBlockEdit ? 'Saving…' : 'Save changes'}</button>
                <button className="cta ghost" type="button" onClick={() => setEditingBlock(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bulkRescheduleOpen && (
        <div className="modal-backdrop" onClick={() => !bulkSaving && setBulkRescheduleOpen(false)}>
          <div className="modal-panel panel" onClick={e => e.stopPropagation()}>
            <h3>Reschedule {selectedCount} booking{selectedCount === 1 ? '' : 's'}</h3>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: -8, marginBottom: '1rem' }}>
              Each one keeps its own room and time — only the date changes, for all of them at once.
            </p>
            {bulkError && <div className="inline-error">{bulkError}</div>}
            <div className="field">
              <label htmlFor="bulk-new-date">New date</label>
              <input id="bulk-new-date" type="date" value={bulkNewDate} onChange={e => setBulkNewDate(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="cta" onClick={handleBulkReschedule} disabled={bulkSaving}>
                {bulkSaving ? 'Rescheduling…' : `Reschedule ${selectedCount} booking${selectedCount === 1 ? '' : 's'}`}
              </button>
              <button className="cta ghost" onClick={() => setBulkRescheduleOpen(false)} disabled={bulkSaving}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
