// Supabase client — only created when env vars exist (.env.local).
// Without keys the app runs entirely on the local adapter (demo/offline mode).
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anon ? createClient(url, anon) : null;

export const supabaseConfigured = supabase !== null;
