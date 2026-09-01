// Which way should THIS page talk to Claude right now?
//   • cloud build + signed-in (and MFA-complete) session → the server-side
//     claude-proxy: the org's key stays on the server, usage is metered,
//     and the browser sends only its session token (fetched fresh per
//     operation — supabase-js refreshes it, so it never goes stale).
//   • anything else → null: the caller uses the classic direct mode with
//     the user's own key, exactly as before.
// supabase-js is imported dynamically so pages that never use AI (or local
// builds, where this returns before the import) don't pay for it.
import { cloudConfigured, claudeProxyUrl } from "./cloudConfig";
import type { AiProxy } from "../bridge/aiPlanImport";

export type { AiProxy };

export async function aiProxy(): Promise<AiProxy | null> {
  if (!cloudConfigured || !claudeProxyUrl) return null;
  try {
    const { cloud } = await import("./cloud");
    const sb = cloud();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal.error && aal.data.nextLevel === "aal2" && aal.data.currentLevel !== "aal2") return null;
    return { url: claudeProxyUrl, token: data.session.access_token };
  } catch {
    return null; // proxy unavailable → the direct path still works
  }
}
