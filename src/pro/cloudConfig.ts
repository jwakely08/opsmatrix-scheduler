// Build-time cloud configuration — deliberately free of any supabase-js
// import, so the LOCAL/demo bundle can check "is this a cloud build?" without
// downloading the cloud libraries (they live in the lazy CloudGate chunk and
// the fusion bundle only). See cloud.ts for the client factory.
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudConfigured: boolean = Boolean(supabaseUrl && supabaseAnonKey);

/** the Claude proxy endpoint (P7); empty = direct mode with the user's key */
export const claudeProxyUrl: string =
  (import.meta.env.VITE_CLAUDE_PROXY_URL as string | undefined) ??
  (cloudConfigured ? `${supabaseUrl}/functions/v1/claude-proxy` : "");
