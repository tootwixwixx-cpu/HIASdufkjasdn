// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

// SECURITY: this client is server-only and must use the service-role / secret key. It used to fall
// back to NEXT_PUBLIC_SUPABASE_ANON_KEY when the service key was missing, which silently ran the
// whole app on a public key (and, with permissive RLS, appeared to "work"). Never fall back: a missing
// key should leave the database unconfigured, not quietly downgrade to a key that ships to browsers.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: {
        transport: ws as any,
      },
    })
  : null;
