// Who is using this device? The first brick of the role system (Josh will
// spec the full admin/director/manager/supervisor matrix later — see
// PRODUCTION_ROADMAP). Today it gates exactly one thing: the general
// cleaning formula in Scope is the account administrator's business.
//   • LOCAL build (no cloud env): the device owner IS the administrator.
//   • CLOUD build: the signed-in profile's role decides — directors
//     administer their organization; supervisors and staff don't see the
//     formula. (Staff are already view-only at the sync layer.)
import { cloudConfigured } from "./cloudConfig";

export type AccountRole = "owner" | "director" | "supervisor" | "staff";

export function canEditFormula(role: AccountRole): boolean {
  return role === "owner" || role === "director";
}

export async function fetchAccountRole(): Promise<AccountRole> {
  if (!cloudConfigured) return "owner";
  try {
    const { cloud } = await import("./cloud");
    const sb = cloud();
    if (!sb) return "staff";
    const { data } = await sb.auth.getSession();
    if (!data.session) return "staff";
    const prof = await sb.from("profiles").select("role")
      .eq("user_id", data.session.user.id).maybeSingle();
    const r = String(prof.data?.role ?? "staff");
    return r === "director" ? "director" : r === "supervisor" ? "supervisor" : "staff";
  } catch {
    return "staff"; // when unsure, show less — never more
  }
}
