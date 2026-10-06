import { getAdminUser } from '../../../lib/adminAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { logActivity } from '../../../lib/activityLog';
import { loadSpaceDetails } from '../../../lib/spaceDetails';
import { SPACE_CARDS, mergeSpaceDetails } from '../../../lib/spaces';

// Space details shown on the booking page (name, badge, type, seats, price,
// description).
//   GET                 → saved edits (any signed-in staff)
//   POST { id, ... }    → save the details for one space (super admin only)
//   DELETE { id }       → back to the original details (super admin only)

const FIELDS = { name: 'Name', code: 'Badge', type: 'Type', capacity: 'Seats', price_per_hour: 'Price per hour', description: 'Description' };

function describe(card) {
  return {
    name: card.name, code: card.code, type: card.type,
    capacity: card.capacity, price_per_hour: card.price, description: card.desc,
  };
}

export default async function handler(req, res) {
  const user = await getAdminUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('space_details').select('*');
    if (error) {
      if (error.code === '42P01' || /space_details/.test(error.message || '')) {
        return res.status(200).json({ spaces: [], missingTable: true });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ spaces: data || [] });
  }

  if (user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only the super admin can change space details.' });
  }

  const id = String(req.body?.id || '');
  const card = SPACE_CARDS.find(c => c.id === id);
  if (!card) return res.status(400).json({ error: 'Unknown space.' });

  const current = await loadSpaceDetails({ fresh: true });
  const before = describe(mergeSpaceDetails(current).find(c => c.id === id));

  if (req.method === 'POST') {
    const b = req.body || {};
    const text = (v, max) => String(v ?? '').trim().slice(0, max);
    const row = {
      id,
      name: text(b.name, 60),
      code: text(b.code, 5),
      type: text(b.type, 80),
      capacity: Number(b.capacity),
      price_per_hour: Number(b.price_per_hour),
      description: text(b.description, 400),
      updated_by: user.name,
      updated_at: new Date().toISOString(),
    };
    if (!row.name) return res.status(400).json({ error: 'The name can’t be empty.' });
    if (!row.code) return res.status(400).json({ error: 'The badge can’t be empty.' });
    if (!row.type) return res.status(400).json({ error: 'The type can’t be empty.' });
    if (!Number.isInteger(row.capacity) || row.capacity < 1 || row.capacity > 1000) {
      return res.status(400).json({ error: 'Seats must be a whole number from 1 to 1000.' });
    }
    if (!Number.isInteger(row.price_per_hour) || row.price_per_hour < 0 || row.price_per_hour > 1000000) {
      return res.status(400).json({ error: 'Price must be a whole number of rupees (0 = not set).' });
    }
    if (!row.description) return res.status(400).json({ error: 'The description can’t be empty.' });

    const { data, error } = await supabaseAdmin.from('space_details').upsert([row]).select();
    if (error) {
      if (error.code === '42P01' || /space_details/.test(error.message || '')) {
        return res.status(500).json({ error: 'The database is missing the space details table. Run migration-space-details.sql in Supabase first.' });
      }
      return res.status(500).json({ error: error.message });
    }
    await loadSpaceDetails({ fresh: true });

    const changes = Object.keys(FIELDS)
      .filter(k => String(before[k]) !== String(row[k]))
      .map(k => `${FIELDS[k]}: "${before[k]}" → "${row[k]}"`);
    if (changes.length) {
      await logActivity({
        user, action: 'update', entity_type: 'space',
        summary: `Changed space details of ${before.name} — ${changes.join('; ')}`,
      });
    }
    return res.status(200).json({ space: data[0] });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabaseAdmin.from('space_details').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    await loadSpaceDetails({ fresh: true });
    await logActivity({
      user, action: 'update', entity_type: 'space',
      summary: `Reset ${before.name} to its original details (${card.name})`,
    });
    return res.status(200).json({ ok: true });
  }

  res.status(405).end();
}
