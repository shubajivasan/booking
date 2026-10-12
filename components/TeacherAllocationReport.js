import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { toDateKey, minutesToLabel, ROOM_GROUPS, CLASS_TYPES } from '../lib/schedule';
import { computeTeacherAllocation, NO_TEACHER } from '../lib/teacherAllocation';
import { rangeFor, periodLabel, PeriodControls } from './ReportPeriod';

// Reports → Teacher allocation: each teacher's regular classes in a day,
// week or month (one-off moves/cancellations applied).

const hours = min => {
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
};
const fmtDate = key => new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const span = (s, e) => `${minutesToLabel(s)}–${minutesToLabel(e)}`;

export default function TeacherAllocationReport({ blocks, exceptions }) {
  const [period, setPeriod] = useState('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [group, setGroup] = useState('all');
  const [classType, setClassType] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('hours');
  const [open, setOpen] = useState({}); // teacher name -> expanded

  const dates = useMemo(() => rangeFor(period, anchor), [period, anchor]);
  const dateKeys = useMemo(() => dates.map(toDateKey), [dates]);

  const report = useMemo(
    () => computeTeacherAllocation({ blocks, exceptions, dates: dateKeys, group, classType }),
    [blocks, exceptions, dateKeys, group, classType]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = report.teachers.filter(t => !q || t.name.toLowerCase().includes(q));
    list.sort((a, b) => {
      if (a.name === NO_TEACHER) return 1;
      if (b.name === NO_TEACHER) return -1;
      return sort === 'name' ? a.name.localeCompare(b.name) : b.minutes - a.minutes || a.name.localeCompare(b.name);
    });
    return list;
  }, [report, search, sort]);

  const maxMinutes = Math.max(1, ...rows.map(r => r.minutes));
  const clashCount = rows.reduce((a, r) => a + r.clashes.length, 0);

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(t => ({
      Teacher: t.name,
      Hours: Math.round(t.minutes / 6) / 10,
      Sessions: t.sessions,
      Batches: t.batchCount,
      Locations: t.locations.map(([l, m]) => `${l} (${hours(m)})`).join(', '),
      'Class types': t.types.map(([ty, m]) => `${ty} (${hours(m)})`).join(', '),
      'Overlapping sessions': t.clashes.length,
    }))), 'Teachers');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.flatMap(t => t.items.map(i => ({
      Teacher: t.name, Date: i.date, Time: span(i.start, i.end), Hours: Math.round(i.minutes / 6) / 10,
      Room: i.room, Batch: i.batch, Course: i.course, 'Class type': i.type, 'Moved this date': i.moved ? 'Yes' : '',
    })))), 'Sessions');
    XLSX.writeFile(wb, `teacher-allocation-${period}-${dateKeys[0]}${dateKeys.length > 1 ? `-to-${dateKeys[dateKeys.length - 1]}` : ''}.xlsx`);
  }

  return (
    <div className="occ-report">
      <div className="occ-controls">
        <PeriodControls period={period} setPeriod={setPeriod} anchor={anchor} setAnchor={setAnchor} />
        <button type="button" className="cta ghost occ-export" onClick={exportExcel}>Export to Excel</button>
      </div>
      <div className="occ-controls" style={{ marginTop: 10 }}>
        <select value={group} onChange={e => setGroup(e.target.value)} aria-label="Location">
          <option value="all">All locations</option>
          {ROOM_GROUPS.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select value={classType} onChange={e => setClassType(e.target.value)} aria-label="Class type">
          <option value="all">All class types</option>
          {CLASS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          <option value="Not set">Not set</option>
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
          <option value="hours">Most hours first</option>
          <option value="name">A–Z</option>
        </select>
        <input className="ta-search" type="text" placeholder="Search teacher…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <p className="occ-period">{periodLabel(period, dates)} &middot; regular classes</p>

      <div className="occ-tiles">
        <div className="occ-tile">
          <span className="occ-tile-label">Teachers with classes</span>
          <span className="occ-hero">{report.totals.teachers}</span>
        </div>
        <div className="occ-tile">
          <span className="occ-tile-label">Class hours</span>
          <span className="occ-num">{hours(report.totals.minutes)}</span>
        </div>
        <div className="occ-tile">
          <span className="occ-tile-label">Sessions</span>
          <span className="occ-num">{report.totals.sessions}</span>
        </div>
        <div className="occ-tile">
          <span className="occ-tile-label">Average per teacher</span>
          <span className="occ-num">{report.totals.teachers ? hours(Math.round(report.totals.minutes / report.totals.teachers)) : '0 h'}</span>
        </div>
      </div>

      {clashCount > 0 && (
        <div className="request-conflict" style={{ display: 'block', marginBottom: 10 }}>
          &#9888; {clashCount} time{clashCount === 1 ? '' : 's'} a teacher has two classes overlapping. Open the teachers marked &#9888; to see them.
        </div>
      )}

      <div className="occ-table-wrap">
        <table className="occ-table ta-table">
          <thead>
            <tr>
              <th>Teacher</th>
              <th className="occ-bar-col">Class hours</th>
              <th className="num">Hours</th>
              <th className="num occ-hide-sm">Sessions</th>
              <th className="num occ-hide-sm">Batches</th>
              <th className="occ-hide-sm">Where</th>
              <th className="occ-hide-sm">Class types</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--ink-soft)', padding: '14px 10px' }}>No classes in this period{search ? ' for that search' : ''}.</td></tr>
            )}
            {rows.map(t => {
              const isOpen = Boolean(open[t.name]);
              return [
                <tr key={t.name} className="ta-row" onClick={() => setOpen(o => ({ ...o, [t.name]: !o[t.name] }))} aria-expanded={isOpen}>
                  <td className="occ-name">
                    <span className="ta-caret">{isOpen ? '▾' : '▸'}</span> {t.name}
                    {t.clashes.length > 0 && <span className="ta-warn" title="Has overlapping classes"> &#9888;</span>}
                  </td>
                  <td className="occ-bar-col">
                    <div className="occ-bar" title={`${t.name}: ${hours(t.minutes)} in ${t.sessions} sessions`}>
                      <span className="occ-seg occ-class" style={{ width: `${(t.minutes / maxMinutes) * 100}%` }} />
                    </div>
                  </td>
                  <td className="num occ-strong">{hours(t.minutes)}</td>
                  <td className="num occ-hide-sm">{t.sessions}</td>
                  <td className="num occ-hide-sm">{t.batchCount}</td>
                  <td className="occ-hide-sm ta-wrap">{t.locations.slice(0, 3).map(([l]) => l).join(', ')}{t.locations.length > 3 ? ` +${t.locations.length - 3}` : ''}</td>
                  <td className="occ-hide-sm ta-wrap">{t.types.map(([ty]) => ty).join(', ')}</td>
                </tr>,
                isOpen && (
                  <tr key={`${t.name}-detail`} className="ta-detail">
                    <td colSpan={7}>
                      {t.clashes.length > 0 && (
                        <div className="request-conflict" style={{ display: 'block', marginBottom: 8 }}>
                          &#9888; Overlapping: {t.clashes.map(([a, b]) => `${fmtDate(a.date)} ${span(a.start, a.end)} ${a.room} and ${span(b.start, b.end)} ${b.room}`).join('; ')}
                        </div>
                      )}
                      <div className="ta-summary">
                        <span><b>Where:</b> {t.locations.map(([l, m]) => `${l} ${hours(m)}`).join(' · ')}</span>
                        <span><b>Class types:</b> {t.types.map(([ty, m]) => `${ty} ${hours(m)}`).join(' · ')}</span>
                        <span><b>Batches ({t.batchCount}):</b> {t.batches.join(', ')}</span>
                      </div>
                      <table className="ta-sessions">
                        <tbody>
                          {t.items.map((i, k) => (
                            <tr key={k}>
                              {period !== 'day' && <td className="ta-date">{fmtDate(i.date)}</td>}
                              <td className="ta-time">{span(i.start, i.end)}</td>
                              <td>{i.batch || i.course || 'Class'}{i.batch && i.course ? <span className="ta-muted"> ({i.course})</span> : null}{i.moved ? <span className="ta-muted"> &middot; moved here this date</span> : null}</td>
                              <td className="ta-muted">{i.room}</td>
                              <td className="ta-muted occ-hide-sm">{i.type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="occ-note">
        Counts regular classes only (student bookings have no teacher), with one-off moves and cancellations applied. Click a teacher to see every session. The bar compares teachers with each other (longest bar = most hours in this view).
      </p>
    </div>
  );
}
