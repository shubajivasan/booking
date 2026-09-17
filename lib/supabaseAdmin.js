import { createClient } from '@supabase/supabase-js';

// Server-only. The service role key bypasses row-level security entirely,
// so this file must NEVER be imported from a component that runs in the
// browser — only from pages/api/** routes, and only after confirming
// isAdminAuthenticated(req) first. Do not add "use client" or import this
// from components/.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
