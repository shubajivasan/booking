import { useEffect, useMemo, useState } from 'react';

const ROOMS = [
  { id: 'R1', name: 'Room No 1', type: 'Practice room', code: '01', capacity: 12, price: 300, desc: 'Practice room set up for individual and small-group sessions.' },
  { id: 'R2', name: 'Room No 2', type: 'Practice room', code: '02', capacity: 12, price: 300, desc: 'Practice room set up for individual and small-group sessions.' },
  { id: 'R3', name: 'Room No 3', type: 'Practice room', code: '03', capacity: 12, price: 300, desc: 'Practice room set up for individual and small-group sessions.' },
  { id: 'R4', name: 'Room No 4', type: 'Practice room', code: '04', capacity: 12, price: 300, desc: 'Practice room set up for individual and small-group sessions.' },
  { id: 'R5', name: 'Room No 5', type: 'Practice room', code: '05', capacity: 15, price: 350, desc: 'Practice room with extra floor space for small-group classes.' },
  { id: 'R6', name: 'Room No 6', type: 'Practice room', code: '06', capacity: 15, price: 350, desc: 'Practice room with extra floor space for small-group classes.' },
  { id: 'R7', name: 'Room No 7', type: 'Practice room', code: '07', capacity: 15, price: 350, desc: 'Practice room with extra floor space for small-group classes.' },
  { id: 'R8', name: 'Room No 8', type: 'Practice room', code: '08', capacity: 18, price: 400, desc: 'Larger practice room, suited to group classes and rehearsal.' },
  { id: 'R9', name: 'Room No 9', type: 'Practice room', code: '09', capacity: 18, price: 400, desc: 'Larger practice room, suited to group classes and rehearsal.' },
  { id: 'R10', name: 'Room No 10', type: 'Practice room', code: '10', capacity: 18, price: 400, desc: 'Larger practice room, suited to group classes and rehearsal.' },
  { id: 'BH', name: 'Basement Hall', type: 'Multi-purpose hall', code: 'BH', capacity: 80, price: 1200, desc: 'Open hall on the basement level, set up for full rehearsals, workshops and larger gatherings.' },
  { id: 'GTR', name: 'Guitar Room', type: 'Instrument room', code: 'GTR', capacity: 8, price: 350, desc: 'Dedicated room fitted out for guitar lessons and practice, with amps and stands on hand.' },
  { id: 'KEY', name: 'Keyboard Room', type: 'Instrument room', code: 'KEY', capacity: 8, price: 350, desc: 'Fitted with keyboards and a piano bench setup for individual and paired keyboard lessons.' },
  { id: 'DRM', name: 'Drum Room', type: 'Instrument room · soundproofed', code: 'DRM', capacity: 6, price: 400, desc: 'Soundproofed room with a full drum kit, built for drum lessons and practice sessions.' },
  { id: 'MLB', name: 'Music Lab Room', type: 'Recording and production lab', code: 'MLB', capacity: 10, price: 500, desc: 'Recording and production lab with audio workstations, used for production classes and studio sessions.' },
];

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const LAST_HOUR = Math.max(...HOURS);

// Every bookable 1-hour slot's start time, in minutes-from-midnight, at
// 30-minute resolution: 9:00, 9:30, 10:00, ... up to 8:00pm (the last
// half-hour start, 8:30pm, is excluded since that slot would run past
// closing time at 9pm).
const SLOT_STARTS = HOURS.flatMap(h => (h < LAST_HOUR ? [h * 60, h * 60 + 30] : [h * 60]));

function fmtHour(h) {
  const ap = h >= 12 ? 'pm' : 'am';
  let d = h % 12;
  if (d === 0) d = 12;
  return d + ap;
}

// Same idea as fmtHour but for an exact start time in minutes-from-midnight
// (e.g. 630 -> "10:30am"), needed now that a booking can start on the
// half-hour, not just on the hour.
function minutesToLabel(mins) {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  let d = h % 12;
  if (d === 0) d = 12;
  return m === 0 ? `${d}${ap}` : `${d}:${String(m).padStart(2, '0')}${ap}`;
}

function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  if (dd.getTime() === today.getTime()) return 'Today';
  if (dd.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// selectedSlots holds each 1-hour booking's START TIME as minutes-from-
// midnight (e.g. 600 for 10:00, 630 for 10:30) rather than a plain hour
// number, since a booking can now start on the half-hour. This groups
// consecutive 1-hour blocks into readable runs, e.g. selecting 10:00 and
// 11:00 together reads as "10am – 12pm" rather than two separate lines.
function timeRangeLabel(startMinutesList) {
  if (!startMinutesList || startMinutesList.length === 0) return '';
  const sorted = [...startMinutesList].sort((a, b) => a - b);

  const runs = [];
  let runStart = sorted[0];
  let runEnd = sorted[0] + 60;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === runEnd) {
      runEnd = sorted[i] + 60;
    } else {
      runs.push([runStart, runEnd]);
      runStart = sorted[i];
      runEnd = sorted[i] + 60;
    }
  }
  runs.push([runStart, runEnd]);

  return runs.map(([start, end]) => `${minutesToLabel(start)} \u2013 ${minutesToLabel(end)}`).join(', ');
}

const MY_BOOKINGS_KEY = 'ajivasan_my_booking_ids';

export default function BookingApp() {
  const days = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      return d;
    });
  }, []);

  const [tab, setTab] = useState('browse'); // 'browse' | 'mybookings'
  const [view, setView] = useState('browse'); // 'browse' | 'room' | 'form' | 'confirm'
  const [roomId, setRoomId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [selectedSlots, setSelectedSlots] = useState([]); // start-minutes values
  const [bookedSlots, setBookedSlots] = useState([]); // start-minutes values taken by other bookings
  const [classSlots, setClassSlots] = useState({}); // start-minutes -> label, for recurring classes
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', purpose: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [myBookings, setMyBookings] = useState([]);
  const [myBookingsLoading, setMyBookingsLoading] = useState(false);

  const room = ROOMS.find(r => r.id === roomId);

  // Load availability whenever the selected room or day changes. Two sources
  // make a start time unavailable: a confirmed one-time booking in
  // `bookings`, or a recurring weekly class in `recurring_blocks` that
  // overlaps that 1-hour window.
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setLoadingSlots(true);
    const dateKey = toDateKey(selectedDate);

    fetch(`/api/check-availability?roomId=${encodeURIComponent(roomId)}&date=${encodeURIComponent(dateKey)}`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return;
        if (body.error) {
          setLoadingSlots(false);
          setAvailabilityError('Could not load availability. Please refresh and try again.');
          return;
        }
        setBookedSlots(body.bookedSlots || []);
        setClassSlots(body.classSlots || {});
        setLoadingSlots(false);
        setAvailabilityError('');
      }).catch(err => {
        if (cancelled) return;
        console.error(err);
        setLoadingSlots(false);
        setAvailabilityError('Could not load availability. Please refresh and try again.');
      });

    return () => { cancelled = true; };
  }, [roomId, selectedDate]);

  function openRoom(id) {
    setRoomId(id);
    setSelectedDate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
    setSelectedSlots([]);
    setSubmitError('');
    setView('room');
  }

  function toggleSlot(startMinutes) {
    if (bookedSlots.includes(startMinutes) || classSlots[startMinutes]) return;
    setSelectedSlots(prev =>
      prev.includes(startMinutes) ? prev.filter(x => x !== startMinutes) : [...prev, startMinutes].sort((a, b) => a - b)
    );
  }

  function validateForm() {
    const next = {};
    if (!form.name.trim()) next.name = 'Enter your name';
    if (!form.email.trim() || !/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'Enter a valid email';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleConfirmBooking() {
    if (!validateForm()) return;
    setSubmitting(true);
    setSubmitError('');

    const dateKey = toDateKey(selectedDate);

    const res = await fetch('/api/create-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        date: dateKey,
        slots: selectedSlots,
        price: room.price,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        purpose: form.purpose.trim() || null,
        // TODO(payment): once Razorpay is wired in, this call moves into a
        // flow that (1) creates a 'pending' hold via this same API, (2)
        // creates a Razorpay order, and only flips status to 'confirmed'
        // inside the webhook after payment is verified server-side.
        // See backend-architecture-plan.md.
      }),
    });
    const body = await res.json();

    if (!res.ok) {
      setSubmitting(false);
      if (res.status === 409) {
        // Someone else booked one of these exact times in the moment between
        // this page loading and the button being clicked. Refresh availability.
        setSubmitError(body.error || 'One or more of those times were just booked by someone else. Please pick different slots.');
        const freshRes = await fetch(`/api/check-availability?roomId=${encodeURIComponent(roomId)}&date=${encodeURIComponent(dateKey)}`).then(r => r.json());
        setBookedSlots(freshRes.bookedSlots || []);
        setSelectedSlots([]);
        setView('room');
      } else {
        setSubmitError(body.error || 'Something went wrong saving your booking. Please try again.');
      }
      return;
    }

    const ids = body.ids;
    try {
      const existing = JSON.parse(localStorage.getItem(MY_BOOKINGS_KEY) || '[]');
      localStorage.setItem(MY_BOOKINGS_KEY, JSON.stringify([...existing, ...ids]));
    } catch (e) {
      // localStorage can fail in private browsing on some browsers — the
      // booking itself still succeeded, so this is non-fatal.
      console.warn('Could not save booking locally', e);
    }

    setConfirmation({
      id: ids[0],
      room: room.name,
      code: room.code,
      date: selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      hours: timeRangeLabel(selectedSlots),
      total: selectedSlots.length * room.price,
      name: form.name.trim(),
    });
    setSubmitting(false);
    setView('confirm');
  }

  async function loadMyBookings() {
    setMyBookingsLoading(true);
    let ids = [];
    try {
      ids = JSON.parse(localStorage.getItem(MY_BOOKINGS_KEY) || '[]');
    } catch (e) {
      ids = [];
    }
    if (ids.length === 0) {
      setMyBookings([]);
      setMyBookingsLoading(false);
      return;
    }
    const res = await fetch('/api/my-bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const body = await res.json();
    if (res.ok) setMyBookings(body.bookings || []);
    setMyBookingsLoading(false);
  }

  function goToTab(nextTab) {
    setTab(nextTab);
    if (nextTab === 'browse') {
      setView('browse');
      setRoomId(null);
    } else {
      loadMyBookings();
    }
  }

  function stepProgress(step) {
    return (
      <div className="step-progress">
        {[1, 2].map(s => <div key={s} className={s <= step ? 'done' : ''} />)}
      </div>
    );
  }

  return (
    <>
      <header>
        <div>
          <p className="brand-eyebrow">Ajivasan Academy of Performing Arts</p>
          <h1 className="brand">Rooms &amp; Halls</h1>
        </div>
        <nav className="tabs">
          <button className={tab === 'browse' ? 'active' : ''} onClick={() => goToTab('browse')}>Browse spaces</button>
          <button className={tab === 'mybookings' ? 'active' : ''} onClick={() => goToTab('mybookings')}>My bookings</button>
        </nav>
      </header>

      <main>
        {tab === 'browse' && view === 'browse' && (
          <>
            <div className="intro">
              <p>Book a studio, hall or classroom for rehearsal, performance or class time. Pick a space to see availability for the next seven days.</p>
            </div>
            <div className="room-grid">
              {ROOMS.map(r => (
                <div
                  key={r.id}
                  className="room-card"
                  tabIndex={0}
                  role="button"
                  aria-label={`View ${r.name}`}
                  onClick={() => openRoom(r.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRoom(r.id); } }}
                >
                  <div className="room-visual">
                    <span className="room-tag">{r.capacity} cap</span>
                    <span className="room-code">{r.code}</span>
                  </div>
                  <div className="room-body">
                    <p className="room-name">{r.name}</p>
                    <p className="room-type">{r.type}</p>
                    <div className="room-meta">
                      <span>SEATS {r.capacity}</span>
                      <span>9AM&ndash;9PM</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'browse' && view === 'room' && room && (
          <>
            <button className="back-link" onClick={() => setView('browse')}>&larr; All spaces</button>
            <div className="detail-head">
              <div>
                <h2>{room.name}</h2>
                <p className="room-type">{room.type} &middot; seats {room.capacity}</p>
              </div>
              <div className="detail-code-badge">{room.code}</div>
            </div>
            <div className="panel" style={{ marginBottom: '1.6rem' }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6 }}>{room.desc}</p>
            </div>
            <div className="panel">
              <h3>Choose a day</h3>
              <div className="day-strip">
                {days.map((d, i) => (
                  <button
                    key={i}
                    className={`day-chip ${toDateKey(d) === toDateKey(selectedDate) ? 'active' : ''}`}
                    onClick={() => { setSelectedDate(d); setSelectedSlots([]); }}
                  >
                    {dayLabel(d)}
                  </button>
                ))}
                <label className="day-chip date-picker-chip">
                  Pick a date
                  <input
                    type="date"
                    min={toDateKey(days[0])}
                    value={toDateKey(selectedDate)}
                    onChange={e => {
                      if (!e.target.value) return;
                      const [y, m, dNum] = e.target.value.split('-').map(Number);
                      setSelectedDate(new Date(y, m - 1, dNum));
                      setSelectedSlots([]);
                    }}
                  />
                </label>
              </div>
              <h3 style={{ marginTop: '1.6rem' }}>Available times</h3>
              {loadingSlots ? (
                <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Checking availability&hellip;</p>
              ) : availabilityError ? (
                <div className="inline-error">{availabilityError}</div>
              ) : (
                <div className="slot-board">
                  {SLOT_STARTS.map(start => {
                    const isBooked = bookedSlots.includes(start);
                    const isClass = Boolean(classSlots[start]);
                    const isBlocked = isBooked || isClass;
                    const isSel = selectedSlots.includes(start);
                    const label = isClass
                      ? `${minutesToLabel(start)} \u2014 regular class (${classSlots[start]})`
                      : `${minutesToLabel(start)} ${isBooked ? 'unavailable' : isSel ? 'selected' : 'available'}`;

                    return (
                      <div
                        key={start}
                        className={`slot ${isBooked ? 'booked' : ''} ${isClass ? 'class-block' : ''} ${isSel ? 'selected' : ''}`}
                        tabIndex={isBlocked ? -1 : 0}
                        role="button"
                        aria-label={label}
                        title={isClass ? classSlots[start] : undefined}
                        onClick={() => toggleSlot(start)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSlot(start); } }}
                      >
                        {minutesToLabel(start)}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="legend">
                <span><span className="dot" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }} />Open</span>
                <span><span className="dot" style={{ background: 'var(--brass)' }} />Selected</span>
                <span><span className="dot" style={{ background: 'var(--booked-green-bg)', border: '1px solid var(--booked-green)' }} />Booked</span>
                <span><span className="dot" style={{ background: 'var(--booked-green-bg)', border: '1px solid var(--booked-green)' }} />Regular class</span>
              </div>
            </div>
            <div className="summary-bar">
              <div className="total">
                {selectedSlots.length > 0 ? timeRangeLabel(selectedSlots) : '\u2014'}
                <span>{selectedSlots.length} hour{selectedSlots.length === 1 ? '' : 's'} selected</span>
              </div>
              <button className="cta" disabled={selectedSlots.length === 0} onClick={() => setView('form')}>
                Continue to details
              </button>
            </div>
          </>
        )}

        {tab === 'browse' && view === 'form' && room && (
          <>
            <button className="back-link" onClick={() => setView('room')}>&larr; Back to availability</button>
            {stepProgress(1)}
            <div className="detail-head">
              <div>
                <h2>Your details</h2>
                <p className="room-type">{room.name} &middot; {dayLabel(selectedDate)} &middot; {timeRangeLabel(selectedSlots)}</p>
              </div>
            </div>
            {submitError && <div className="inline-error">{submitError}</div>}
            <div className="panel">
              <div className="field">
                <label htmlFor="f-name">Full name</label>
                <input id="f-name" type="text" placeholder="Ava Kapoor" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                {errors.name && <div className="error-text">{errors.name}</div>}
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="f-email">Email</label>
                  <input id="f-email" type="email" placeholder="ava@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                  {errors.email && <div className="error-text">{errors.email}</div>}
                </div>
                <div className="field">
                  <label htmlFor="f-phone">Phone</label>
                  <input id="f-phone" type="tel" placeholder="98765 43210" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="f-purpose">Purpose of booking</label>
                <textarea id="f-purpose" placeholder="Ensemble rehearsal for the winter recital" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} />
              </div>
            </div>
            <div className="summary-bar">
              <div className="total">
                {timeRangeLabel(selectedSlots)}
                <span>{selectedSlots.length} hour{selectedSlots.length === 1 ? '' : 's'} &middot; {room.name}</span>
              </div>
              <button className="cta" disabled={submitting} onClick={handleConfirmBooking}>
                {submitting ? 'Confirming\u2026' : 'Confirm booking'}
              </button>
            </div>
          </>
        )}

        {tab === 'browse' && view === 'confirm' && confirmation && (
          <div className="panel confirm-box">
            {stepProgress(2)}
            <div className="confirm-icon">&#10003;</div>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 600, margin: 0 }}>Booking confirmed</h2>
            <div className="confirm-code">{confirmation.id.slice(0, 8).toUpperCase()}</div>
            <div className="confirm-details">
              <div><span>Space</span><b>{confirmation.room} ({confirmation.code})</b></div>
              <div><span>Date</span><b>{confirmation.date}</b></div>
              <div><span>Hours</span><b>{confirmation.hours}</b></div>
              <div><span>Booked by</span><b>{confirmation.name}</b></div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="cta ghost" onClick={() => { setView('browse'); setRoomId(null); setSelectedSlots([]); setForm({ name: '', email: '', phone: '', purpose: '' }); }}>
                Book another space
              </button>
              <button className="cta" onClick={() => goToTab('mybookings')}>View my bookings</button>
            </div>
          </div>
        )}

        {tab === 'mybookings' && (
          <>
            {myBookingsLoading ? (
              <p style={{ color: 'var(--ink-soft)' }}>Loading your bookings&hellip;</p>
            ) : myBookings.length === 0 ? (
              <div className="empty-state">
                <p className="em-title">No bookings yet</p>
                <p style={{ marginBottom: '1.4rem' }}>Reserve a room or hall to see it listed here.</p>
                <button className="cta" onClick={() => goToTab('browse')}>Browse spaces</button>
              </div>
            ) : (
              <>
                <div className="intro"><p>Bookings made from this browser.</p></div>
                {myBookings.map(b => {
                  const r = ROOMS.find(x => x.id === b.room_id);
                  const startMinutes = b.hour * 60 + (b.minute || 0);
                  return (
                    <div className="booking-row" key={b.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <span className="code">{r ? r.code : b.room_id}</span>
                        <div className="meta">
                          <b>{r ? r.name : b.room_id}</b><br />
                          {b.date}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="meta">{minutesToLabel(startMinutes)} \u2013 {minutesToLabel(startMinutes + 60)}</span>
                        <span className="status-pill">{b.status}</span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
