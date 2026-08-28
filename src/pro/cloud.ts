// The Supabase client factory. Anything that imports THIS file pulls
// supabase-js into its chunk — so only the lazy CloudGate chunk, the sync
// engine, and the fusion bundle import it. Cheap checks (cloudConfigured,
// claudeProxyUrl) live in cloudConfig.ts, which is import-safe everywhere.
//
// One client per page; classic.html and maps.html share the same origin, so
// a session signed in on the hub is automatically picked up by the fusion
// bundle on classic.html (supabase-js stores it in localStorage).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseAnonKey, cloudConfigured } from "./cloudConfig";

export { cloudConfigured, claudeProxyUrl } from "./cloudConfig";

let client: SupabaseClient | null = null;

export function cloud(): SupabaseClient | null {
  if (!cloudConfigured) return null;
  if (!client) client = createClient(supabaseUrl!, supabaseAnonKey!);
  return client;
}

/**
 * The localStorage key supabase-js stores the session under. Sign-out
 * removes it EXPLICITLY (belt and braces over supabase's own cleanup) so a
 * signed-out device can never come back up signed in.
 */
export function authStorageKey(): string | null {
  if (!cloudConfigured) return null;
  try { return "sb-" + new URL(supabaseUrl!).hostname.split(".")[0] + "-auth-token"; }
  catch { return null; }
}
