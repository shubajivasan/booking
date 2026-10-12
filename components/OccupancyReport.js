import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { toDateKey } from '../lib/schedule';
import { rangeFor, periodLabel, PeriodControls } from './ReportPeriod';
import { computeOccupancy } from '../lib/occupancy';

// Reports → Occupancy % of spaces (9am–9pm), by day, week or month.
// Classes come from the dashboard (already loaded); confirmed bookings for the
// period are fetched here.

const HOUR_LABELS = ['9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm'];
const pctText = n => `${Math.round(n)}%`;
const hours = min => {
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
};

// Sequential (one hue, light → dark) for the heatmap.
const RAMP = [
  { max: 0, bg: 'transparent', fg: 'var(--ink-soft)', label: '0%' },
  { max: 20, bg: '#cde2fb', fg: 'var(--ink)', label: '1–20%' },
  { max: 40, bg: '#9ec5f4', fg: 'var(--ink)', label: '21–40%' },
  { max: 60, bg: '#6da7ec', fg: 'var(--ink)', label: '41–60%' },
  { max: 80, bg: '#2a78d6', fg: '#fff', label: '61–80%' },
  { max: 100, bg: '#1c5cab', fg: '#fff', label: '81–100%' },
];
function rampFor(p) {
  const r = Math.round(p);
  return RAMP.find(x => r <= x.max) || RAMP[RAMP.length - 1];
}

function Bar({ classPct, bookingPct, title }) {
  return (
    <div className="occ-bar" title={title} role="img" aria-label={title}>
      {classPct > 0 && <span className="occ-seg occ-class" style={{ width: `${classPct}%` }} />}
      {bookingPct > 0 && <span className="occ-seg occ-booking" style={{ width: `${bookingPct}%` }} />}
    </div>
  );
}

export default function OccupancyReport({ blocks, exceptions }) {
  const [period, setPeriod] = useState('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [includeBranches, setIncludeBranches] = useState(false);
  const [sortByPct, setSortByPct] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const dates = useMemo(() => rangeFor(period, anchor), [period, anchor]);
  const dateKeys = useMemo(() => dates.map(toDateKey), [dates]);
  const from = dateKeys[0];
  const to = dateKeys[dateKeys.length - 1];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/admin/bookings?from=${from}&to=${to}`)
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) setError(body.error || 'Could not load bookings.');
        setBookings(body.bookings || []);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError('Could not load bookings. Check your connection.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [from, to]);

  const report = useMemo(
    () => computeOccupancy({ blocks, exceptions, bookings, dates: dateKeys, includeBranches }),
    [blocks, exceptions, bookings, dateKeys, includeBranches]
  );

  const rows = useMemo(() => {
    const list = [...report.spaces];
    if (sortByPct) list.sort((a, b) => b.pct - a.pct);
    return list;
  }, [report, sortByPct]);

  // Heatmap columns: hours for a day, dates for a week or month.
  const columns = period === 'day'
    ? HOUR_LABELS.map((label, i) => ({ key: i, label, sub: '' }))
    : dates.map((d, i) => ({
      key: dateKeys[i],
      label: period === 'week' ? d.toLocaleDateString('en-IN', { weekday: 'short' }) : String(d.getDate()),
      sub: period === 'week' ? String(d.getDate()) : d.toLocaleDateString('en-IN', { weekday: 'narrow' }),
    }));
  const cellFor = (row, col) => (period === 'day' ? row.byHour[col.key] : row.byDate[col.key]);
  const colTitle = col => (period === 'day' ? `${col.label}–${HOUR_LABELS[col.key + 1] || '9pm'}` : new Date(`${col.key}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));

  function exportExcel() {
    const summary = rows.map(r => ({
      Space: r.name,
      'Occupancy %': Math.round(r.pct * 10) / 10,
      'Classes %': Math.round(r.classPct * 10) / 10,
      'Bookings %': Math.round(r.bookingPct * 10) / 10,
      'Used hours': Math.round(r.usedMin / 6) / 10,
      'Available hours': Math.round(r.capacityMin / 6) / 10,
    }));
    const grid = rows.map(r => {
      const o = { Space: r.name };
      columns.forEach(c => { o[period === 'day' ? c.label : c.key] = Math.round(cellFor(r, c).pct * 10) / 10; });
      return o;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Occupancy');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(grid), period === 'day' ? 'By hour (%)' : 'By day (%)');
    XLSX.writeFile(wb, `occupancy-${period}-${from}${from !== to ? `-to-${to}` : ''}.xlsx`);
  }

  const t = report.totals;
  return (
    <div className="occ-report">
      <div className="occ-controls">
        <PeriodControls period={period} setPeriod={setPeriod} anchor={anchor} setAnchor={setAnchor} />
        <label className="occ-check"><input type="checkbox" checked={includeBranches} onChange={e => setIncludeBranches(e.target.checked)} /> Include other branches</label>
        <label className="occ-check"><input type="checkbox" checked={sortByPct} onChange={e => setSortByPct(e.target.checked)} /> Busiest first</label>
        <button type="button" className="cta ghost occ-export" onClick={exportExcel}>Export to Excel</button>
      </div>

      <p className="occ-period">{periodLabel(period, dates)} &middot; 9am&ndash;9pm{loading ? ' · loading bookings…' : ''}</p>
      {error && <div className="inline-error">{error}</div>}

      <div className="occ-tiles">
        <div className="occ-tile">
          <span className="occ-tile-label">Juhu spaces occupied</span>
          <span className="occ-hero">{pctText(t.pct)}</span>
          <span className="occ-tile-sub">{hours(t.usedMin)} of {hours(t.capacityMin)}</span>
        </div>
        <div className="occ-tile">
          <span className="occ-tile-label"><i className="occ-key occ-class" /> Classes</span>
          <span className="occ-num">{pctText(t.classPct)}</span>
          <span className="occ-tile-sub">{hours(t.classMin)}</span>
        </div>
        <div className="occ-tile">
          <span className="occ-tile-label"><i className="occ-key occ-booking" /> Bookings</span>
          <span className="occ-num">{pctText(t.bookingPct)}</span>
          <span className="occ-tile-sub">{hours(t.bookingMin)}</span>
        </div>
        <div className="occ-tile">
          <span className="occ-tile-label">Free</span>
          <span className="occ-num">{pctText(100 - t.pct)}</span>
          <span className="occ-tile-sub">{hours(t.capacityMin - t.usedMin)}</span>
        </div>
        {report.branchTotals && (
          <div className="occ-tile">
            <span className="occ-tile-label">Other branches</span>
            <span className="occ-num">{pctText(report.branchTotals.pct)}</span>
            <span className="occ-tile-sub">{hours(report.branchTotals.usedMin)} of {hours(report.branchTotals.capacityMin)}</span>
          </div>
        )}
      </div>

      <h4 className="occ-h">Occupancy by space</h4>
      <div className="occ-legend">
        <span><i className="occ-key occ-class" /> Classes</span>
        <span><i className="occ-key occ-booking" /> Bookings</span>
      </div>
      <div className="occ-table-wrap">
        <table className="occ-table">
          <thead>
            <tr>
              <th>Space</th>
              <th className="occ-bar-col">Occupancy</th>
              <th className="num">%</th>
              <th className="num occ-hide-sm">Used / available</th>
              <th className="num occ-hide-sm">Classes</th>
              <th className="num occ-hide-sm">Bookings</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={r.branch ? 'occ-branch-row' : ''}>
                <td className="occ-name">{r.name}{r.units > 1 && !r.hall ? <span className="occ-units"> ({r.units} rooms)</span> : null}</td>
                <td className="occ-bar-col">
                  <Bar classPct={r.classPct} bookingPct={r.bookingPct} title={`${r.name}: ${pctText(r.pct)} — classes ${pctText(r.classPct)}, bookings ${pctText(r.bookingPct)}`} />
                </td>
                <td className="num occ-strong">{pctText(r.pct)}</td>
                <td className="num occ-hide-sm">{hours(r.usedMin)} / {hours(r.capacityMin)}</td>
                <td className="num occ-hide-sm">{hours(r.classMin)}</td>
                <td className="num occ-hide-sm">{hours(r.bookingMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="occ-h">{period === 'day' ? 'By hour' : 'By day'}</h4>
      <div className="occ-legend occ-ramp">
        {RAMP.map(x => (
          <span key={x.label}><i className="occ-key" style={{ background: x.bg, boxShadow: x.max === 0 ? 'inset 0 0 0 1px var(--line)' : 'none' }} /> {x.label}</span>
        ))}
      </div>
      <div className="occ-table-wrap">
        <table className={`occ-heat ${period === 'month' ? 'occ-heat-month' : ''}`}>
          <thead>
            <tr>
              <th className="occ-name">Space</th>
              {columns.map(c => (
                <th key={c.key} title={colTitle(c)}>{c.label}{c.sub ? <><br /><span className="occ-sub">{c.sub}</span></> : null}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="occ-name">{r.name}</td>
                {columns.map(c => {
                  const v = cellFor(r, c);
                  const ramp = rampFor(v.pct);
                  return (
                    <td
                      key={c.key}
                      className="occ-cell"
                      style={{ background: ramp.bg, color: ramp.fg }}
                      title={`${r.name} · ${colTitle(c)}: ${pctText(v.pct)} (classes ${pctText(v.classPct)}, bookings ${pctText(v.bookingPct)})`}
                    >
                      {v.pct > 0 ? Math.round(v.pct) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="occ-note">
        How it&rsquo;s worked out: each space is open 12 hours a day (9am&ndash;9pm), every day of the period. Time is &ldquo;used&rdquo; when a regular class (with one-off moves and cancellations applied) or a confirmed booking covers it; overlaps count once. Pending requests aren&rsquo;t counted. AAPA Hall counts its 4 partitions separately (one partition all day = 25%). Branches with 2 rooms count both rooms.
      </p>
    </div>
  );
}
