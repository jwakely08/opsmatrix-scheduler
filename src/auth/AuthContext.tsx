import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { log } from "../lib/logger";

export type Role = "director" | "supervisor" | "staff";

export interface AuthInfo {
  /** local = no Supabase keys (offline/demo); remote = signed in against Supabase */
  mode: "local" | "remote";
  session: Session | null;
  role: Role;
  orgId: string | null;
  orgName: string;
  displayName: string;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const LOCAL_AUTH: AuthInfo = {
  mode: "local", session: null, role: "director", orgId: null,
  orgName: "Local workspace", displayName: "You (local)", loading: false,
  signOut: async () => {}, refreshProfile: async () => {}
};

const Ctx = createContext<AuthInfo>(LOCAL_AUTH);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>("staff");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(!!supabase);

  const refreshProfile = useCallback(async () => {
    if (!supabase) return;
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) { setOrgId(null); return; }
    const { data, error } = await supabase
      .from("profiles")
      .select("role, display_name, organization_id, organizations(name)")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) { log.error("profile load failed", error); return; }
    if (data) {
      setRole((data.role as Role) ?? "staff");
      setDisplayName(data.display_name ?? user.email ?? "");
      setOrgId(data.organization_id);
      const org = data.organizations as unknown as { name: string } | null;
      setOrgName(org?.name ?? "");
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void refreshProfile();
  }, [session, refreshProfile]);

  if (!supabase) return <Ctx.Provider value={LOCAL_AUTH}>{children}</Ctx.Provider>;
  const sb = supabase;

  const value: AuthInfo = {
    mode: "remote", session, role, orgId, orgName, displayName, loading,
    signOut: async () => { await sb.auth.signOut(); },
    refreshProfile
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthInfo {
  return useContext(Ctx);
}

/** what the current role may edit */
export function can(role: Role, action: "editFacility" | "editSchedule" | "editSettings" | "invite"): boolean {
  if (role === "director") return true;
  if (role === "supervisor") return action === "editSchedule";
  return false;
}
