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
  res.status(200).json({ bookings: data });
}
