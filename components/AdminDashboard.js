import { useEffect, useMemo, useState } from 'react';
import {
  HOURS, DAY_NAMES, ROOMS, timeToMinutes, minutesToLabel, fmtHour,
  toDateKey, startOfWeek, addDays, roomName, blockAppliesOnDate,
} from '../lib/schedule';

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
  const [view, setView] = useState('today'); // today | day | week | month | all
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allBlocks, setAllBlocks] = useState([]); // all recurring_blocks, fetched once
  const [bookings, setBookings] = useState([]); // bookings for the current visible range
  const [loading, setLoading] = useState(true);

  const [filterRoom, setFilterRoom] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterCourse, setFilterCourse] = useState('');
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
  function hourToTimeInput(h) {
    return `${String(h).padStart(2, '0')}:00`;
  }

  function openConvert(bk) {
    setConvertingBooking(bk);
    const day = dayNameFromDateKey(bk.date);
    setAddForm({
      room_id: bk.room_id,
      days: [day],
      dayTimes: { [day]: { start: hourToTimeInput(bk.hour), end: hourToTimeInput(bk.hour + 1) } },
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
      .then(body => setAllBlocks(body.blocks || []));
  }

  // Recurring classes are few enough (a few hundred rows) to fetch once and
  // filter client-side, rather than re-querying on every view/date change.
  useEffect(() => { fetchBlocks(); }, []);

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
        body: JSON.stringify({ id: convertingBooking.id }),
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
      const lastOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
      return startOfWeek(addDays(lastOfMonth, 6 - lastOfMonth.getDay()));
      // covers the trailing days of the last displayed week
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
    if (view !== 'all') return;
    fetch('/api/admin/bookings?all=true')
      .then(r => r.json())
      .then(body => {
        setAllBookings(body.bookings || []);
        setAllBookingsTruncated(Boolean(body.truncated));
      });
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

  async function handleDeleteBooking(id) {
    if (!window.confirm('Cancel this booking? This cannot be undone.')) return;
    setDeletingId(id);
    const res = await fetch('/api/admin/bookings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setDeletingId(null);
    if (res.ok) { fetchBookings(); refreshAllBookings(); }
    else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not cancel this booking.');
    }
  }

  const [editingBooking, setEditingBooking] = useState(null); // the booking row being rescheduled
  const [editForm, setEditForm] = useState({ room_id: '', date: '', hour: 9 });
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  function openEdit(bk) {
    setEditingBooking(bk);
    setEditForm({ room_id: bk.room_id, date: bk.date, hour: bk.hour });
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
        id: editingBooking.id,
        room_id: editForm.room_id,
        date: editForm.date,
        hour: Number(editForm.hour),
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
    if (filterRoom && entry.room_id !== filterRoom) return false;
    if (entry.type === 'class') {
      if (filterTeacher && entry.teacher !== filterTeacher) return false;
      if (filterCourse && entry.course !== filterCourse) return false;
    } else {
      // Teacher/course filters don't apply to student bookings — if either
      // is active, bookings are excluded rather than shown as false matches.
      if (filterTeacher || filterCourse) return false;
    }
    return true;
  }

  // Build the merged, time-sorted schedule for one specific calendar date.
  function scheduleForDate(date) {
    const dateKey = toDateKey(date);
    const dayName = DAY_NAMES[date.getDay()];

    const classEntries = allBlocks
      .filter(b => b.day_of_week === dayName && blockAppliesOnDate(b, dateKey))
      .map(b => ({
        type: 'class',
        id: b.id,
        room_id: b.room_id,
        startMinutes: timeToMinutes(b.start_time),
        endMinutes: timeToMinutes(b.end_time),
        teacher: b.teacher,
        course: b.course,
        batch: b.batch,
        label: b.label,
        start_date: b.start_date,
        end_date: b.end_date,
      }));

    const bookingEntries = bookings
      .filter(bk => bk.date === dateKey)
      .map(bk => ({
        type: 'booking',
        id: bk.id,
        room_id: bk.room_id,
        date: bk.date,
        hour: bk.hour,
        startMinutes: bk.hour * 60,
        endMinutes: (bk.hour + 1) * 60,
        studentName: bk.student_name,
        purpose: bk.purpose,
        amount: bk.amount,
      }));

    return [...classEntries, ...bookingEntries]
      .filter(passesFilters)
      .sort((a, b) => a.startMinutes - b.startMinutes || a.room_id.localeCompare(b.room_id));
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

  function renderEntry(e, i) {
    const time = `${minutesToLabel(e.startMinutes)}–${minutesToLabel(e.endMinutes)}`;
    if (e.type === 'class') {
      return (
        <div className="sched-row" key={i}>
          <span className="sched-time">{time}</span>
          <span className="sched-room">{roomName(e.room_id)}</span>
          <span className="sched-title">
            {e.batch || e.course || 'Class'}
            {e.teacher ? ` — ${e.teacher}` : ''}
            {e.batch && e.course ? <span className="sched-subtitle"> ({e.course})</span> : null}
            {(e.start_date || e.end_date) ? (
              <span className="sched-subtitle"> · {e.start_date || 'any date'} → {e.end_date || 'ongoing'}</span>
            ) : null}
          </span>
          <span className="sched-tag sched-tag-class">Regular class</span>
          <button
            className="cta ghost sched-remove"
            onClick={() => handleDeleteBlock(e.id)}
            disabled={deletingId === e.id}
          >
            {deletingId === e.id ? 'Removing…' : 'Remove'}
          </button>
        </div>
      );
    }
    return (
      <div className="sched-row" key={i}>
        <span className="sched-time">{time}</span>
        <span className="sched-room">{roomName(e.room_id)}</span>
        <span className="sched-title">{e.studentName}{e.purpose ? ` — ${e.purpose}` : ''}</span>
        <span className="sched-tag sched-tag-booking">Booking</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="cta ghost sched-remove" onClick={() => openConvert(e)}>
            Convert to class
          </button>
          <button className="cta ghost sched-remove" onClick={() => openEdit(e)}>
            Reschedule
          </button>
          <button
            className="cta ghost sched-remove"
            onClick={() => handleDeleteBooking(e.id)}
            disabled={deletingId === e.id}
          >
            {deletingId === e.id ? 'Cancelling…' : 'Remove'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header>
        <div>
          <p className="brand-eyebrow">Ajivasan Academy of Performing Arts</p>
          <h1 className="brand">Schedule dashboard</h1>
        </div>
        <nav className="tabs">
          <button className={view === 'today' ? 'active' : ''} onClick={goToday}>Today</button>
          <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>Day</button>
          <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Week</button>
          <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Month</button>
          <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All bookings</button>
        </nav>
      </header>

      <main>
        <div className="panel" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)}>
            <option value="">All rooms</option>
            {ROOMS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)}>
            <option value="">All teachers</option>
            {teacherOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterCourse} onChange={e => setFilterCourse(e.target.value)}>
            <option value="">All courses</option>
            {courseOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">Classes + bookings</option>
            <option value="class">Regular classes only</option>
            <option value="booking">Student bookings only</option>
          </select>
          {(filterRoom || filterTeacher || filterCourse || filterType !== 'all') && (
            <button className="cta ghost" onClick={() => { setFilterRoom(''); setFilterTeacher(''); setFilterCourse(''); setFilterType('all'); }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <button className="cta ghost" onClick={() => shiftDate(-1)}>&larr; Prev</button>
              <h3 style={{ margin: 0, textTransform: 'none', fontSize: 15, color: 'var(--ink)' }}>{dayLabel(selectedDate)}</h3>
              <button className="cta ghost" onClick={() => shiftDate(1)}>Next &rarr;</button>
            </div>
            {loading ? <p style={{ color: 'var(--ink-soft)' }}>Loading…</p> : (
              <div className="sched-list">
                {scheduleForDate(selectedDate).length === 0
                  ? <p style={{ color: 'var(--ink-soft)' }}>Nothing scheduled.</p>
                  : scheduleForDate(selectedDate).map(renderEntry)}
              </div>
            )}
          </div>
        )}

        {view === 'week' && (
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <button className="cta ghost" onClick={() => shiftDate(-7)}>&larr; Prev week</button>
              <h3 style={{ margin: 0, textTransform: 'none', fontSize: 15, color: 'var(--ink)' }}>
                {shortDayLabel(weekDays[0])} – {shortDayLabel(weekDays[6])}
              </h3>
              <button className="cta ghost" onClick={() => shiftDate(7)}>Next week &rarr;</button>
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
                            className={`sched-chip ${e.type === 'class' ? 'sched-chip-class' : 'sched-chip-booking'}`}
                            key={j}
                            title={e.type === 'class' ? [e.batch, e.course, e.teacher].filter(Boolean).join(' · ') : e.purpose}
                          >
                            <div>{minutesToLabel(e.startMinutes)} · {roomName(e.room_id)}</div>
                            <div>{e.type === 'class' ? (e.batch || e.course || 'Class') : e.studentName}</div>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'month' && (
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <button className="cta ghost" onClick={() => shiftMonth(-1)}>&larr; Prev month</button>
              <h3 style={{ margin: 0, textTransform: 'none', fontSize: 15, color: 'var(--ink)' }}>{monthLabel(selectedDate)}</h3>
              <button className="cta ghost" onClick={() => shiftMonth(1)}>Next month &rarr;</button>
            </div>
            {loading ? <p style={{ color: 'var(--ink-soft)' }}>Loading…</p> : (
              <div className="month-grid">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div className="month-grid-head" key={d}>{d}</div>
                ))}
                {monthGridDays.map((d, i) => {
                  const entries = scheduleForDate(d);
                  const classCount = entries.filter(e => e.type === 'class').length;
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
                {allBookings
                  .filter(bk => !filterRoom || bk.room_id === filterRoom)
                  .filter(bk => {
                    if (!allBookingsSearch.trim()) return true;
                    const q = allBookingsSearch.trim().toLowerCase();
                    return (bk.student_name || '').toLowerCase().includes(q)
                      || (bk.email || '').toLowerCase().includes(q)
                      || (bk.purpose || '').toLowerCase().includes(q);
                  })
                  .map(bk => {
                    const entry = {
                      type: 'booking',
                      id: bk.id,
                      room_id: bk.room_id,
                      date: bk.date,
                      hour: bk.hour,
                      startMinutes: bk.hour * 60,
                      endMinutes: (bk.hour + 1) * 60,
                      studentName: bk.student_name,
                      purpose: bk.purpose,
                    };
                    return (
                      <div className="sched-row" key={bk.id}>
                        <span className="sched-time">{`${bk.date} \u00b7 ${minutesToLabel(entry.startMinutes)} \u2013 ${minutesToLabel(entry.endMinutes)}`}</span>
                        <span className="sched-room">{roomName(bk.room_id)}</span>
                        <span className="sched-title">{bk.student_name}{bk.purpose ? ` — ${bk.purpose}` : ''}</span>
                        <span className="sched-tag sched-tag-booking">Booking</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="cta ghost sched-remove" onClick={() => openConvert(entry)}>Convert to class</button>
                          <button className="cta ghost sched-remove" onClick={() => openEdit(entry)}>Reschedule</button>
                          <button
                            className="cta ghost sched-remove"
                            onClick={() => handleDeleteBooking(bk.id)}
                            disabled={deletingId === bk.id}
                          >
                            {deletingId === bk.id ? 'Cancelling…' : 'Remove'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                {allBookings.length === 0 && <p style={{ color: 'var(--ink-soft)' }}>No bookings yet.</p>}
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
                  {ROOMS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="edit-date">Date</label>
                  <input id="edit-date" type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="edit-hour">Hour</label>
                  <select id="edit-hour" value={editForm.hour} onChange={e => setEditForm({ ...editForm, hour: e.target.value })}>
                    {HOURS.map(h => <option key={h} value={h}>{`${fmtHour(h)} \u2013 ${fmtHour(h + 1)}`}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="cta" type="submit" disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save new time'}</button>
                <button className="cta ghost" type="button" onClick={() => setEditingBooking(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
