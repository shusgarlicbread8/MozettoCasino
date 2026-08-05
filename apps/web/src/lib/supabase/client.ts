import { createBrowserClient } from "@supabase/ssr";
import { getPublishableKey, getSupabaseUrl, supabaseConfigured } from "./env";

export { supabaseConfigured };

/** Browser client — publishable key only (never the secret key). */
export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getPublishableKey());
}
