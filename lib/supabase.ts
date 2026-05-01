import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// This is a kiosk app: we avoid persisting auth sessions.
const supabase: SupabaseClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : // Build-time fallback if env isn't injected (kiosk runtime should provide it).
      (createClient("",
        "",
        { auth: { persistSession: false } }) as SupabaseClient);

export { supabase };

