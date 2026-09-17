import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Surfaces a clear error in the browser console instead of a cryptic
  // failure deep inside the Supabase client if .env.local isn't set up yet.
  console.warn(
    'Supabase env vars are missing. Copy .env.local.example to .env.local and fill in your project URL and anon key.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
