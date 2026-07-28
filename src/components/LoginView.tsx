import { useState } from "react";
import { supabase } from "../auth/supabaseClient";
import { useAuth } from "../auth/AuthContext";
import { LocalAdapter } from "../storage/localAdapter";
import { buildDemoState } from "../lib/demo";
import { log } from "../lib/logger";

type Mode = "signin" | "signup" | "invite";

export function LoginView() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!supabase) return;
    setErr(""); setBusy(true);
    try {
      if (mode === "signin") {
        const r = await supabase.auth.signInWithPassword({ email, password });
        if (r.error) throw r.error;
      } else {
        const r = await supabase.auth.signUp({ email, password });
        if (r.error) throw r.error;
        if (!r.data.session) {
          setErr("Check your email to confirm the account, then sign in.");
          setBusy(false);
          return;
        }
        if (mode === "signup") {
          const rpc = await supabase.rpc("create_organization", { org_name: orgName || "My Facility", user_display_name: displayName });
          if (rpc.error) throw rpc.error;
        } else {
          const rpc = await supabase.rpc("redeem_invite", { invite_code: inviteCode.trim(), user_display_name: displayName });
          if (rpc.error) throw rpc.error;
        }
      }
      await auth.refreshProfile();
    } catch (e: any) {
      log.warn("auth failed", e);
      setErr(e?.message ?? String(e));
    }
    setBusy(false);
  }

  async function tryDemo() {
    const local = new LocalAdapter();
    await local.save(buildDemoState());
    // simplest reliable way to boot into local mode with the demo data:
    window.location.search = "?demo=1";
  }

  const emailPw = (
    <>
      <div className="field"><label>Email</label>
        <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
      <div className="field"><label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signin" ? "current-password" : "new-password"} /></div>
    </>
  );

  return (
    <div className="authwrap">
      <div className="authcard">
        <div className="logo">OPS<b>MATRIX</b></div>
        <div className="sub">Scheduling for hospital EVS — import scans, set rates, build the schedule.</div>

        {mode === "signup" && (
          <>
            <div className="field"><label>Facility / organization name</label>
              <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. St. Mary's Medical Center" /></div>
            <div className="field"><label>Your name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          </>
        )}
        {mode === "invite" && (
          <>
            <div className="field"><label>Invite code</label>
              <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="8-character code" /></div>
            <div className="field"><label>Your name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          </>
        )}
        {emailPw}
        <button className="btn primary" disabled={busy} onClick={() => void submit()}>
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create organization" : "Join with invite"}
        </button>
        {err && <div className="err">{err}</div>}

        <div className="alt">
          {mode !== "signin" && <button onClick={() => setMode("signin")}>Have an account? Sign in</button>}
          {mode === "signin" && (
            <>
              <button onClick={() => setMode("signup")}>New here? Create your organization</button>
              {" · "}
              <button onClick={() => setMode("invite")}>Have an invite code?</button>
            </>
          )}
        </div>

        <div className="authdivider">or</div>
        <button className="btn" onClick={() => void tryDemo()}>Try the demo — no login</button>
      </div>
    </div>
  );
}
