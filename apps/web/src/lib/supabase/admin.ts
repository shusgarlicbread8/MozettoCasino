import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "./env";

/** Server-only admin client — bypasses RLS. Never import from client components. */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Missing SUPABASE_SECRET_KEY");
  return createClient(getSupabaseUrl(), secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
