import { toDateKey, startOfWeek, addDays } from '../lib/schedule';

// Shared by the reports: Day / Week / Month picker with ← → and a date box.

export function rangeFor(period, anchor) {
  if (period === 'day') return [new Date(anchor)];
  if (period === 'week') {
    const s = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const days = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  return Array.from({ length: days }, (_, i) => addDays(first, i));
}

export function periodLabel(period, dates) {
  const opt = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  if (period === 'day') return dates[0].toLocaleDateString('en-IN', opt);
  if (period === 'week') return `${dates[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${dates[6].toLocaleDateString('en-IN', opt)}`;
  return dates[0].toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function PeriodControls({ period, setPeriod, anchor, setAnchor }) {
  function shift(dir) {
    if (period === 'day') setAnchor(a => addDays(a, dir));
    else if (period === 'week') setAnchor(a => addDays(a, 7 * dir));
    else setAnchor(a => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  }
  const dateValue = period === 'month'
    ? `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`
    : toDateKey(anchor);
  return (
    <>
      <div className="occ-seg-buttons" role="group" aria-label="Period">
        {['day', 'week', 'month'].map(p => (
          <button key={p} type="button" className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>
            {p === 'day' ? 'Day' : p === 'week' ? 'Week' : 'Month'}
          </button>
        ))}
      </div>
      <div className="occ-nav">
        <button type="button" className="cta ghost" onClick={() => shift(-1)} aria-label="Previous">&larr;</button>
        <input
          type={period === 'month' ? 'month' : 'date'}
          value={dateValue}
          onChange={e => {
            if (!e.target.value) return;
            const [y, m, d] = e.target.value.split('-').map(Number);
            setAnchor(new Date(y, m - 1, d || 1));
          }}
          aria-label="Pick a date"
        />
        <button type="button" className="cta ghost" onClick={() => shift(1)} aria-label="Next">&rarr;</button>
        <button type="button" className="cta ghost" onClick={() => setAnchor(new Date())}>
          {period === 'day' ? 'Today' : period === 'week' ? 'This week' : 'This month'}
        </button>
      </div>
    </>
  );
}
