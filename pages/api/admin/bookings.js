import { isAdminAuthenticated } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export default async function handler(req, res) {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ error: 'Sign in as staff to view bookings.' });
  }
  if (req.method !== 'GET') return res.status(405).end();

  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD).' });
  }

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .eq('status', 'confirmed');

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ bookings: data });
}
