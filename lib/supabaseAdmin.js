import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn(
    'SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is missing on the server. ' +
    'Admin write routes and the availability/booking API routes will fail until both are set in your deployment environment variables.'
  );
}

// SUPABASE_SERVICE_ROLE_KEY bypasses row-level security entirely — this
// file must only ever be imported from pages/api/** (server-side code),
// never from a component. It's how the admin dashboard can add/remove
// recurring classes even though the public anon key is read-only for that
// table.
export const supabaseAdmin = createClient(supabaseUrl, serviceKey);
