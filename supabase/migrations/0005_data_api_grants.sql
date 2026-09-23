-- OpsMatrix — explicit Data API grants (2026-09-23)
-- ============================================================================
-- On 2026-10-30 Supabase stops auto-granting Data API access to NEW tables
-- in the public schema. Existing tables on the live project keep their
-- grants — but every migration in this repo was silently relying on the
-- auto-grant, so a FRESH environment built from these migrations after that
-- date (a new customer project, disaster recovery, `supabase db reset`,
-- a preview branch) would come up with every table unreachable through
-- supabase-js/PostgREST.
--
-- This migration makes the grants explicit. Two deliberate choices:
--   1. NO grants to `anon`. Every policy in 0001/0002 requires an
--      authenticated org member (invite redemption goes through a
--      security-definer function), so anon never got past RLS anyway —
--      dropping its table grants is a small hardening, not a change in
--      behavior.
--   2. RLS remains the ONLY security boundary, exactly as before. Grants
--      decide whether the API may talk to a table at all; the org-scoped
--      policies decide which ROWS — and supabase/tests/rls-isolation.test.sql
--      keeps proving that.
--
-- Safe to run on the live project at any time: re-granting an existing
-- grant is a no-op.
--
-- ⚠ CONVENTION FOR EVERY FUTURE MIGRATION: a `create table` MUST be
-- followed, in the SAME migration, by
--     alter table public.<t> enable row level security;
--     grant select, insert, update, delete on public.<t> to authenticated;
--     grant all on public.<t> to service_role;
-- (plus its policies). From 2026-10-30 a table without the grant is
-- unreachable through the Data API — the API error names the missing GRANT.
-- ============================================================================

grant usage on schema public to authenticated, service_role;

-- every table the migrations have created so far
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- sequences back identity/serial columns; harmless where unused
grant usage, select on all sequences in schema public to authenticated;
grant all on all sequences in schema public to service_role;
