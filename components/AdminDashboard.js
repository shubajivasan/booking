import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  HOURS, DAY_NAMES, ROOMS, BOOKABLE_ROOMS, timeToMinutes, minutesToLabel, fmtHour,
  toDateKey, startOfWeek, addDays, roomName, blockAppliesOnDate,
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

  const canManage = Boolean(currentUser) && currentUser.role !== 'staff'; // admin or super_admin
  const canManageStaff = Boolean(currentUser) && currentUser.role === 'super_admin';
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allBlocks, setAllBlocks] = useState([]); // all recurring_blocks, fetched once
  const [bookings, setBookings] = useState([]); // bookings for the current visible range
  const [loading, setLoading] = useState(true);

  const [filterRooms, setFilterRooms] = useState([]); // empty array = all rooms
  function toggleFilterRoom(roomId) {
    setFilterRooms(prev => prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId]);
  }
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
    } else if (!window.confirm(`Approve ${request.student_name}'s request for ${roomName(request.room_id)} on ${request.date}? They'll get a confirmation email.`)) {
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
    if (!staffForm.name || !staffForm.email || !staffForm.password) {
      setStaffError('Name, email and password are all required.'); return;
    }
    if (staffForm.password.length < 8) {
      setStaffError('Password must be at least 8 characters.'); return;
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
      return {
        Date: dateLabel, Time: time, Room: roomName(e.room_id), Type: 'Regular class',
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
          {canManage && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="cta ghost sched-remove" onClick={() => openEditBlock(e)}>
                Edit
              </button>
              <button
                className="cta ghost sched-remove"
                onClick={() => handleDeleteBlock(e.id)}
                disabled={deletingId === e.id}
              >
                {deletingId === e.id ? 'Removing…' : 'Remove'}
              </button>
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
        <div>
          <p className="brand-eyebrow">Ajivasan Academy of Performing Arts</p>
          <h1 className="brand">Schedule dashboard</h1>
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
          {canManage && (
            <button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}>Activity log</button>
          )}
          {canManageStaff && (
            <button className={view === 'staff' ? 'active' : ''} onClick={() => setView('staff')}>Staff</button>
          )}
        </nav>
      </header>

      <main>
        <div className="panel no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <details className="room-multiselect">
            <summary>
              {filterRooms.length === 0 ? 'All rooms' : `${filterRooms.length} room${filterRooms.length === 1 ? '' : 's'} selected`}
            </summary>
            <div className="room-multiselect-panel">
              {filterRooms.length > 0 && (
                <button type="button" className="cta ghost" style={{ width: '100%', marginBottom: 8 }} onClick={() => setFilterRooms([])}>
                  Clear room selection
                </button>
              )}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button type="button" className="cta ghost" style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}
                  onClick={() => setFilterRooms(ROOMS.filter(r => !r.branch).map(r => r.id))}>
                  This branch only
                </button>
                <button type="button" className="cta ghost" style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}
                  onClick={() => setFilterRooms(ROOMS.filter(r => r.branch).map(r => r.id))}>
                  Other branches only
                </button>
              </div>
              <div className="day-checkboxes" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                {ROOMS.map((r, i) => (
                  <div key={r.id} style={{ display: 'contents' }}>
                    {r.branch && !ROOMS[i - 1]?.branch && (
                      <p style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-soft)', margin: '10px 0 2px' }}>
                        Other branches
                      </p>
                    )}
                    <label className={`day-checkbox ${filterRooms.includes(r.id) ? 'checked' : ''}`}>
                      <input type="checkbox" checked={filterRooms.includes(r.id)} onChange={() => toggleFilterRoom(r.id)} />
                      {r.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </details>
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
          {(filterRooms.length > 0 || filterTeacher || filterCourse || filterType !== 'all') && (
            <button className="cta ghost" onClick={() => { setFilterRooms([]); setFilterTeacher(''); setFilterCourse(''); setFilterType('all'); }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
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
            <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: '1.5rem' }}>
              <button className="cta ghost" onClick={exportWeek}>Export to Excel</button>
              <button className="cta ghost" onClick={() => window.print()}>Print / Save as PDF</button>
            </div>
          </div>
        )}

        {view === 'month' && (
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
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
            <h3>Add a staff member</h3>
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
                  <input id="staff-password" type="password" placeholder="At least 8 characters" value={staffForm.password} onChange={e => setStaffForm({ ...staffForm, password: e.target.value })} />
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
