import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
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
  const [view, setView] = useState('today'); // today | day | week | month
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allBlocks, setAllBlocks] = useState([]); // all recurring_blocks, fetched once
  const [bookings, setBookings] = useState([]); // bookings for the current visible range
  const [loading, setLoading] = useState(true);

  const [filterRoom, setFilterRoom] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterCourse, setFilterCourse] = useState('');
  const [filterType, setFilterType] = useState('all'); // all | class | booking

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    room_id: '', days: [], start_time: '10:00', end_time: '11:00',
    batch: '', teacher: '', course: '', start_date: '', ongoing: true, end_date: '',
  });
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  function toggleFormDay(day) {
    setAddForm(f => ({
      ...f,
      days: f.days.includes(day) ? f.days.filter(d => d !== day) : [...f.days, day],
    }));
  }

  function fetchBlocks() {
    return supabase.from('recurring_blocks').select('*').then(({ data, error }) => {
      if (!error) setAllBlocks(data || []);
    });
  }

  // Recurring classes are few enough (a few hundred rows) to fetch once and
  // filter client-side, rather than re-querying on every view/date change.
  useEffect(() => { fetchBlocks(); }, []);

  async function handleAddClass(e) {
    e.preventDefault();
    setAddError('');
    if (!addForm.room_id) { setAddError('Pick a room'); return; }
    if (addForm.days.length === 0) { setAddError('Pick at least one day of the week'); return; }
    if (addForm.start_time >= addForm.end_time) { setAddError('End time must be after start time'); return; }
    if (!addForm.ongoing && !addForm.end_date) { setAddError('Pick an end date, or mark this as ongoing'); return; }
    if (addForm.start_date && !addForm.ongoing && addForm.end_date && addForm.start_date > addForm.end_date) {
      setAddError('End date must be after start date'); return;
    }
    setSaving(true);
    const res = await fetch('/api/admin/blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: addForm.room_id,
        days: addForm.days,
        start_time: addForm.start_time + ':00',
        end_time: addForm.end_time + ':00',
        batch: addForm.batch,
        teacher: addForm.teacher,
        course: addForm.course,
        start_date: addForm.start_date || null,
        end_date: addForm.ongoing ? null : addForm.end_date,
      }),
    });
    const body = await res.json();
    setSaving(false);
    if (!res.ok) { setAddError(body.error || 'Could not save this class.'); return; }
    setAddForm({ room_id: '', days: [], start_time: '10:00', end_time: '11:00', batch: '', teacher: '', course: '', start_date: '', ongoing: true, end_date: '' });
    setShowAddForm(false);
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
    setLoading(true);
    const from = toDateKey(rangeStart);
    const to = toDateKey(rangeEnd);
    fetch(`/api/admin/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(r => r.json())
      .then(body => {
        setBookings(body.bookings || []);
        setLoading(false);
      });
  }, [rangeStart, rangeEnd]);

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
        room_id: bk.room_id,
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
          <button className="cta" style={{ marginLeft: 'auto' }} onClick={() => setShowAddForm(s => !s)}>
            {showAddForm ? 'Cancel' : '+ Add regular class'}
          </button>
        </div>

        {showAddForm && (
          <form className="panel" onSubmit={handleAddClass}>
            <h3>New regular class</h3>
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
            <div className="field-row">
              <div className="field">
                <label htmlFor="add-start">Start time</label>
                <input id="add-start" type="time" value={addForm.start_time} onChange={e => setAddForm({ ...addForm, start_time: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="add-end">End time</label>
                <input id="add-end" type="time" value={addForm.end_time} onChange={e => setAddForm({ ...addForm, end_time: e.target.value })} />
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
            <button className="cta" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save class'}</button>
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
      </main>
    </>
  );
}
