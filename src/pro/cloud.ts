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
