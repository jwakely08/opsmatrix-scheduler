// The client's workspace store list and the database's workspaces_key_check
// whitelist MUST agree — drift means every cloud push fails with a check-
// constraint error (exactly what hit staging on 2026-08-31 when the
// Calibration Editor's store shipped without its migration). This test
// parses the real migration files, so adding a store without a migration
// fails CI instead of failing Josh.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_KEYS } from "./workspaceStore";

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

/** the LAST workspaces_key_check definition across migrations wins */
function dbWhitelist(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let latest: string[] | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    // every "key in ( 'a', 'b', ... )" block tied to the workspaces key check
    const blocks = sql.match(/key\s+in\s*\(([^)]+)\)/gi) ?? [];
    for (const b of blocks) {
      const keys = [...b.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      if (keys.some((k) => k.startsWith("opsmatrix_"))) latest = keys;
    }
  }
  return latest ?? [];
}

describe("workspace stores ↔ database whitelist", () => {
  it("every client store the sync engine pushes is allowed by the schema", () => {
    const db = dbWhitelist();
    expect(db.length).toBeGreaterThan(0);
    for (const key of WORKSPACE_KEYS) {
      expect(db, `"${key}" is missing from workspaces_key_check — write a migration before shipping this store`).toContain(key);
    }
  });

  it("and the schema lists nothing the client no longer ships", () => {
    const db = dbWhitelist();
    for (const key of db) {
      expect([...WORKSPACE_KEYS] as string[],
        `schema allows "${key}" but the client no longer syncs it — intentional?`).toContain(key);
    }
  });
});
