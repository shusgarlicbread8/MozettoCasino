import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublishableKey, getSupabaseUrl } from "./env";

/** Server Components / Route Handlers — publishable key + cookie session. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(getSupabaseUrl(), getPublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* called from a Server Component where cookies are read-only */
        }
      },
    },
  });
}
