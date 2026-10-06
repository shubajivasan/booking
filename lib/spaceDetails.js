import { supabaseAdmin } from './supabaseAdmin';
import { applySpaceNames } from './schedule';

// Server side: loads the super admin's edits to space details (space_details
// table) and applies any new names, so emails, WhatsApp alerts, the activity
// log and the assistant use them. Cached for 30 seconds per server instance.
// If the table doesn't exist yet, everything keeps its default details.
let cache = null;
let cachedAt = 0;

export async function loadSpaceDetails({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < 30000) return cache;
  const { data, error } = await supabaseAdmin.from('space_details').select('*');
  if (error) {
    if (cache) return cache; // keep the last good copy
    return [];
  }
  cache = data || [];
  cachedAt = Date.now();
  applySpaceNames(Object.fromEntries(cache.filter(r => r.name).map(r => [r.id, r.name])));
  return cache;
}
