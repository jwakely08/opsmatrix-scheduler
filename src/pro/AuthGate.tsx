// The cloud sign-in shell around the hub. In LOCAL mode (no Supabase env
// baked into the build — the demo, GitHub Pages, plain dev) this renders its
// children untouched: zero behavior change, no login anywhere, and the cloud
// code (supabase-js, QR) is never even downloaded — CloudGate is a lazy
// chunk that only cloud-configured builds fetch.
//
// In CLOUD mode CloudGate walks the user through, in plain language:
//   1. sign in / create account (Supabase Auth)
//   2. two-step verification — REQUIRED for directors (TOTP via any
//      authenticator app; native Supabase MFA, nothing custom)
//   3. first run: create the organization, or join one with an invite code
//   4. then the app — with the sync engine mirroring this device's workspace
//      to the organization, and a small status pill (bottom-right)
import React, { Suspense } from "react";
import { cloudConfigured } from "./cloudConfig";

const CloudGate = React.lazy(() => import("./CloudGate"));

export function AuthGate({ children }: { children: React.ReactNode }) {
  if (!cloudConfigured) return <>{children}</>;
  return (
    <Suspense fallback={<div className="authshell"><div className="authcard"><h1>OpsMatrix</h1><p className="pnote">Loading…</p></div></div>}>
      <CloudGate>{children}</CloudGate>
    </Suspense>
  );
}
