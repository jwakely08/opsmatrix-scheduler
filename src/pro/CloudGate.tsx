// The cloud sign-in shell — loaded LAZILY so local/demo builds never download
// supabase-js or the QR library (AuthGate only imports this chunk when the
// build is cloud-configured). See AuthGate.tsx for the mode explanation.
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { cloud } from "./cloud";
import { SyncEngine, clearSyncMeta, type SyncState } from "./syncEngine";
import { WORKSPACE_KEYS } from "./workspaceStore";

interface Profile { organization_id: string; role: string; display_name: string }

type Step = "loading" | "signin" | "mfa-challenge" | "mfa-enroll" | "org-setup" | "ready" | "error";

export default function CloudGate({ children }: { children: React.ReactNode }) {
  const sb = cloud()!;
  const [step, setStep] = useState<Step>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState("");
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncDetail, setSyncDetail] = useState("");
  const engineRef = useRef<SyncEngine | null>(null);
  // did THIS page load walk through sign-in/setup screens? Then the person
  // just signed in — land them on the Dashboard (classic.html), the app's
  // real front page, instead of dropping them into the hub.
  const cameToSignIn = useRef(false);

  const resolve = useCallback(async (s: Session | null) => {
    setErr("");
    if (!s) { cameToSignIn.current = true; setStep("signin"); setProfile(null); return; }
    setSession(s);
    // MFA: if a verified TOTP factor exists but this session is still aal1,
    // the code must be entered before anything else
    const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal.error && aal.data.nextLevel === "aal2" && aal.data.currentLevel !== "aal2") {
      cameToSignIn.current = true;
      setStep("mfa-challenge");
      return;
    }
    const prof = await sb.from("profiles").select("organization_id, role, display_name")
      .eq("user_id", s.user.id).maybeSingle();
    if (prof.error) { setErr(prof.error.message); setStep("error"); return; }
    if (!prof.data) { cameToSignIn.current = true; setStep("org-setup"); return; }
    setProfile(prof.data as Profile);
    // directors must have two-step verification — enroll before entering
    if ((prof.data as Profile).role === "director" &&
        !(aal.error) && aal.data.nextLevel !== "aal2") {
      cameToSignIn.current = true;
      setStep("mfa-enroll");
      return;
    }
    if (cameToSignIn.current) {
      // fresh sign-in → the Dashboard is the front door
      window.location.replace("./classic.html");
      return;
    }
    setStep("ready");
  }, [sb]);

  useEffect(() => {
    void sb.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT") { setSession(null); setProfile(null); setStep("signin"); }
      else if (event === "SIGNED_IN") void resolve(s);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the sync engine runs exactly while the app is visible
  useEffect(() => {
    if (step !== "ready" || !session || !profile) return;
    const engine = new SyncEngine({
      sb,
      orgId: profile.organization_id,
      userId: session.user.id,
      role: profile.role,
      onConflict: async () =>
        confirm(
          "This data was changed on another device since this one last synced.\n\n" +
          "OK = load the newest version (recommended)\nCancel = keep THIS device's version"
        ) ? "server" : "local",
      onState: (s, d) => { setSyncState(s); setSyncDetail(d ?? ""); }
    });
    engineRef.current = engine;
    void engine.start();
    return () => { engine.stop(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, profile?.organization_id, session?.user.id]);

  const signOut = async () => {
    if (!confirm("Sign out? Synced data is removed from this device (it stays safe in your organization's account).")) return;
    await engineRef.current?.flush();
    engineRef.current?.stop();
    await sb.auth.signOut();
    // a shared computer must not keep the previous org's data
    for (const k of WORKSPACE_KEYS) localStorage.removeItem(k);
    clearSyncMeta();
    window.location.reload();
  };

  if (step === "ready") {
    return (
      <>
        {children}
        <SyncPill state={syncState} detail={syncDetail} onSignOut={signOut} email={session?.user.email ?? ""} />
      </>
    );
  }
  return (
    <div className="authshell">
      <div className="authcard">
        <h1>OpsMatrix</h1>
        {step === "loading" && <p className="pnote">Loading…</p>}
        {step === "error" && <p className="warntext">⚠ {err} — refresh to try again.</p>}
        {step === "signin" && <SignIn sb={sb} />}
        {step === "mfa-challenge" && <MfaChallenge sb={sb} onDone={() => void sb.auth.getSession().then(({ data }) => resolve(data.session))} />}
        {step === "mfa-enroll" && <MfaEnroll sb={sb} onDone={() => void sb.auth.getSession().then(({ data }) => resolve(data.session))} />}
        {step === "org-setup" && <OrgSetup sb={sb} onDone={() => void sb.auth.getSession().then(({ data }) => resolve(data.session))} />}
      </div>
    </div>
  );
}

// ── sign in / create account ────────────────────────────────────────────────
function SignIn({ sb }: { sb: SupabaseClient }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true); setMsg("");
    try {
      if (mode === "in") {
        const r = await sb.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (r.error) setMsg(r.error.message);
      } else {
        const r = await sb.auth.signUp({ email: email.trim(), password: pw });
        if (r.error) setMsg(r.error.message);
        else if (!r.data.session) setMsg("✓ Check your email to confirm the account, then sign in here.");
      }
    } finally { setBusy(false); }
  };

  return (
    <>
      <p className="pnote">{mode === "in" ? "Sign in to your organization's OpsMatrix." : "Create your account — you'll set up or join your organization next."}</p>
      <label className="pfield">Email
        <input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="pfield">Password
        <input type="password" value={pw} autoComplete={mode === "in" ? "current-password" : "new-password"}
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void go(); }} />
      </label>
      {msg && <p className={msg.startsWith("✓") ? "pnote keysaved" : "warntext"}>{msg}</p>}
      <button className="pbtn primary wide" disabled={busy || !email.trim() || pw.length < 8} onClick={() => void go()}>
        {mode === "in" ? "Sign in" : "Create account"}
      </button>
      {pw.length > 0 && pw.length < 8 && <small className="pnote">Passwords are at least 8 characters.</small>}
      <button className="plink" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(""); }}>
        {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </>
  );
}

// ── two-step verification: enter the 6-digit code ───────────────────────────
function MfaChallenge({ sb, onDone }: { sb: SupabaseClient; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setBusy(true); setMsg("");
    try {
      const factors = await sb.auth.mfa.listFactors();
      const totp = factors.data?.totp?.[0];
      if (!totp) { setMsg("No authenticator is set up on this account."); return; }
      const ch = await sb.auth.mfa.challenge({ factorId: totp.id });
      if (ch.error) { setMsg(ch.error.message); return; }
      const ver = await sb.auth.mfa.verify({ factorId: totp.id, challengeId: ch.data.id, code: code.trim() });
      if (ver.error) setMsg("That code didn't match — check the app and try again.");
      else onDone();
    } finally { setBusy(false); }
  };

  return (
    <>
      <h2>Two-step verification</h2>
      <p className="pnote">Enter the 6-digit code from your authenticator app.</p>
      <label className="pfield">Code
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") void verify(); }} autoFocus />
      </label>
      {msg && <p className="warntext">⚠ {msg}</p>}
      <button className="pbtn primary wide" disabled={busy || code.length !== 6} onClick={() => void verify()}>Verify</button>
      <button className="plink" onClick={() => void sb.auth.signOut()}>Sign out</button>
    </>
  );
}

// ── two-step verification: first-time setup (required for directors) ────────
function MfaEnroll({ sb, onDone }: { sb: SupabaseClient; onDone: () => void }) {
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      // clear any half-finished enrollment, then start fresh
      const existing = await sb.auth.mfa.listFactors();
      for (const f of existing.data?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") {
          await sb.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const r = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
      if (r.error) { setMsg(r.error.message); return; }
      setFactorId(r.data.id);
      setSecret(r.data.totp.secret);
      const QRCode = await import("qrcode");
      setQr(await QRCode.toDataURL(r.data.totp.uri, { margin: 1, width: 180 }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async () => {
    setBusy(true); setMsg("");
    try {
      const ch = await sb.auth.mfa.challenge({ factorId });
      if (ch.error) { setMsg(ch.error.message); return; }
      const ver = await sb.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: code.trim() });
      if (ver.error) setMsg("That code didn't match — check the app and try again.");
      else onDone();
    } finally { setBusy(false); }
  };

  return (
    <>
      <h2>Protect this account</h2>
      <p className="pnote">
        As an administrator, your account needs two-step verification. Open any authenticator app
        (Google Authenticator, Microsoft Authenticator, 1Password…), scan this code, then type the
        6 digits it shows.
      </p>
      {qr ? <img className="authqr" src={qr} alt="Scan with your authenticator app" /> : <p className="pnote">Preparing…</p>}
      {secret && <p className="pnote">Can't scan? Enter this key by hand: <code>{secret}</code></p>}
      <label className="pfield">6-digit code
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") void verify(); }} />
      </label>
      {msg && <p className="warntext">⚠ {msg}</p>}
      <button className="pbtn primary wide" disabled={busy || code.length !== 6 || !factorId} onClick={() => void verify()}>
        Turn on two-step verification
      </button>
      <button className="plink" onClick={() => void sb.auth.signOut()}>Sign out</button>
    </>
  );
}

// ── first run: create the organization or join with an invite code ──────────
function OrgSetup({ sb, onDone }: { sb: SupabaseClient; onDone: () => void }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true); setMsg("");
    try {
      const r = mode === "create"
        ? await sb.rpc("create_organization", { org_name: orgName.trim(), user_display_name: name.trim() })
        : await sb.rpc("redeem_invite", { invite_code: inviteCode.trim(), user_display_name: name.trim() });
      if (r.error) setMsg(r.error.message);
      else onDone();
    } finally { setBusy(false); }
  };

  return (
    <>
      <h2>{mode === "create" ? "Set up your organization" : "Join your organization"}</h2>
      <label className="pfield">Your name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Josh Wakely" />
      </label>
      {mode === "create" ? (
        <label className="pfield">Organization name
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Demo Medical Center EVS" />
        </label>
      ) : (
        <label className="pfield">Invite code <small>from your administrator</small>
          <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
        </label>
      )}
      {msg && <p className="warntext">⚠ {msg}</p>}
      <button className="pbtn primary wide"
        disabled={busy || (mode === "create" ? !orgName.trim() : !inviteCode.trim())}
        onClick={() => void go()}>
        {mode === "create" ? "Create organization" : "Join with this code"}
      </button>
      <button className="plink" onClick={() => { setMode(mode === "create" ? "join" : "create"); setMsg(""); }}>
        {mode === "create" ? "Have an invite code instead?" : "Setting up a new organization?"}
      </button>
    </>
  );
}

// ── the little status pill: sync state + sign out, never in the way ─────────
function SyncPill({ state, detail, email, onSignOut }: {
  state: SyncState; detail: string; email: string; onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    state === "synced" ? "☁ Saved to your organization" :
    state === "syncing" ? "☁ Saving…" :
    state === "view-only" ? "👁 View-only account" :
    state === "offline" ? "⚠ Offline — changes stay on this device until the connection returns" :
    state === "error" ? "⚠ Sync problem" : "☁";
  return (
    <div className={"syncpill " + state}>
      <button onClick={() => setOpen(!open)}>{label}</button>
      {open && (
        <div className="syncpill-menu">
          <p>{email}</p>
          {state === "error" && detail && <p className="warntext">{detail}</p>}
          <button className="pbtn small" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}
