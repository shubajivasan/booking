import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  HOURS, DAY_NAMES, ROOMS, timeToMinutes, minutesToLabel, fmtHour,
  toDateKey, startOfWeek, addDays, roomName,
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

  // Recurring classes are few enough (a few hundred rows) to fetch once and
  // filter client-side, rather than re-querying on every view/date change.
  useEffect(() => {
    supabase.from('recurring_blocks').select('*').then(({ data, error }) => {
      if (!error) setAllBlocks(data || []);
    });
  }, []);

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
    supabase
      .from('bookings')
      .select('*')
      .gte('date', toDateKey(rangeStart))
      .lte('date', toDateKey(rangeEnd))
      .eq('status', 'confirmed')
      .then(({ data, error }) => {
        if (!error) setBookings(data || []);
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
      .filter(b => b.day_of_week === dayName)
      .map(b => ({
        type: 'class',
        room_id: b.room_id,
        startMinutes: timeToMinutes(b.start_time),
        endMinutes: timeToMinutes(b.end_time),
        teacher: b.teacher,
        course: b.course,
        batch: b.batch,
        label: b.label,
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
          <span className="sched-title">{e.course || 'Class'}{e.teacher ? ` — ${e.teacher}` : ''}</span>
          <span className="sched-tag sched-tag-class">Regular class</span>
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
        </div>

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
                          <div className={`sched-chip ${e.type === 'class' ? 'sched-chip-class' : 'sched-chip-booking'}`} key={j}>
                            <div>{minutesToLabel(e.startMinutes)} · {roomName(e.room_id)}</div>
                            <div>{e.type === 'class' ? (e.course || 'Class') : e.studentName}</div>
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
