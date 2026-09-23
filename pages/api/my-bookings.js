import { supabaseAdmin } from '../../lib/supabaseAdmin';

// This is the one deliberate exception to "never expose booking details
// publicly": a visitor who has a booking's id (saved to their own browser
// when they made it — see MY_BOOKINGS_KEY in BookingApp.js) can look up
// that specific booking. ids are random UUIDs, not sequential or
// guessable, so knowing one is good evidence it's genuinely yours. This is
// the same trust model most e-commerce "track your order" pages use.
// It does NOT allow browsing or searching all bookings — only exact-id
// lookups for ids the caller already has.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(200).json({ bookings: [] });
  }

  const safeIds = ids.filter(id => typeof id === 'string').slice(0, 200);

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('*')
    .in('id', safeIds)
    .order('date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // When an admin approves a request with a LONGER timing, the extra
  // 30-min slots are new rows this browser never saw. They share the
  // original request's email and created_at, so include those siblings too
  // — they belong to the same request the caller already holds an id for.
  let bookings = data;
  if (data.length > 0) {
    const known = new Set(data.map(b => b.id));
    const pairs = new Set(data.map(b => `${b.email}|${b.created_at}`));
    const { data: siblings } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .in('email', [...new Set(data.map(b => b.email))])
      .in('created_at', [...new Set(data.map(b => b.created_at))]);
    (siblings || []).forEach(b => {
      if (!known.has(b.id) && pairs.has(`${b.email}|${b.created_at}`)) bookings.push(b);
    });
    bookings = bookings.sort((a, b) =>
      b.date.localeCompare(a.date) || (a.hour * 60 + (a.minute || 0)) - (b.hour * 60 + (b.minute || 0))
    );
  }

  res.status(200).json({ bookings });
}
