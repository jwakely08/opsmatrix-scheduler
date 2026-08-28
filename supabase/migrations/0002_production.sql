-- OpsMatrix — production activation (2026-08-26)
-- ============================================================================
-- Builds on 0001_init.sql (organizations / profiles / invites / RLS helpers),
-- which stays untouched. This migration adds what the FIRST production
-- deployment needs and nothing more:
--   1. workspaces      — the org's synced data (the same seven stores the
--                        client keeps in localStorage; see src/pro/workspaceStore.ts)
--   2. ai_usage        — per-org Claude metering, written ONLY by the
--                        claude-proxy edge function (service role)
--   3. audit_log       — who saved what, when (minimal, day-one auditability)
--   4. organization_id indexes on every RLS-filtered table
--   5. invite hardening — 24-char codes + 7-day expiry
--   6. delete_org_data extended to the new tables
--
-- SAME DESIGN RULES AS 0001: no PHI anywhere, every table org-scoped with
-- RLS, roles enforced in policies (server-side), privileged flows in
-- security-definer functions only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. workspaces — one row per (org, store). The client's localStorage stores
--    are synced verbatim as text (opsmatrix_v7_demo_stamp is a plain string,
--    the rest are JSON — the client owns the format, the server owns WHO may
--    read/write it). The org's existing state_rev (0001, bump_state_rev RPC)
--    is the optimistic-concurrency gate for the whole set.
--    The Anthropic API key NEVER appears here: the client strips it before
--    anything leaves the device (workspaceStore.collectWorkspace).
-- ---------------------------------------------------------------------------
create table public.workspaces (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key             text not null check (key in (
    'opsmatrix_v7',
    'opsmatrix_v7_plans',
    'opsmatrix_v7_demo_stamp',
    'opsmatrix_fusion_rules',
    'opsmatrix_fusion_nonspace',
    'opsmatrix_fusion_aliases',
    'opsmatrix_fusion_floorcare'
  )),
  content         text not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id),
  primary key (organization_id, key)
);

alter table public.workspaces enable row level security;

-- org members read; directors AND supervisors write (staff are read-only).
-- Note: v1 syncs whole stores, so write scope is store-level, not field-level
-- — a deliberate simplification, documented in the runbook.
create policy workspaces_select on public.workspaces
  for select using (organization_id = public.current_org_id());
create policy workspaces_insert on public.workspaces
  for insert with check (
    organization_id = public.current_org_id()
    and public.current_role_name() in ('director','supervisor')
    and updated_by = auth.uid()
  );
create policy workspaces_update on public.workspaces
  for update using (
    organization_id = public.current_org_id()
    and public.current_role_name() in ('director','supervisor')
  ) with check (
    organization_id = public.current_org_id()
    and updated_by = auth.uid()
  );
create policy workspaces_delete on public.workspaces
  for delete using (
    organization_id = public.current_org_id()
    and public.current_role_name() = 'director'
  );

-- ---------------------------------------------------------------------------
-- 2. ai_usage — Claude spend metering per org. Rows are written ONLY by the
--    claude-proxy edge function using the service role (which bypasses RLS);
--    there is deliberately NO insert/update/delete policy for signed-in
--    users, so clients can read their own org's usage but never fake it.
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null,
  endpoint        text not null default 'messages',   -- which app feature called
  model           text not null default '',
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  created_at      timestamptz not null default now()
);

alter table public.ai_usage enable row level security;

create policy ai_usage_select on public.ai_usage
  for select using (organization_id = public.current_org_id());
-- (no write policies on purpose — service role only)

-- month-to-date totals, RLS-respecting (security_invoker: the caller's
-- policies apply, so each org sees only its own line)
create view public.ai_usage_monthly
  with (security_invoker = true) as
  select organization_id,
         date_trunc('month', created_at) as month,
         count(*)                        as requests,
         sum(input_tokens)               as input_tokens,
         sum(output_tokens)              as output_tokens
    from public.ai_usage
   group by 1, 2;

-- ---------------------------------------------------------------------------
-- 3. audit_log — minimal day-one auditability: who saved which store when,
--    plus auth-adjacent events the app chooses to record. Append-only for
--    members (their own user_id, their own org); no update/delete policies,
--    so history cannot be rewritten from a client.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null,
  action          text not null,             -- e.g. workspace_push / restore / org_data_delete
  store_key       text,                      -- which workspace store, when relevant
  detail          jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy audit_select on public.audit_log
  for select using (organization_id = public.current_org_id());
create policy audit_insert on public.audit_log
  for insert with check (
    organization_id = public.current_org_id()
    and user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- 4. organization_id indexes — every RLS policy filters by org on every
--    query; these make that filter an index scan on all 0001 domain tables
--    and the new ones. (workspaces/rate_tables already lead their PK with
--    organization_id.)
-- ---------------------------------------------------------------------------
create index idx_profiles_org       on public.profiles       (organization_id);
create index idx_invites_org        on public.invites        (organization_id);
create index idx_buildings_org      on public.buildings      (organization_id);
create index idx_floors_org         on public.floors         (organization_id);
create index idx_rooms_org          on public.rooms          (organization_id);
create index idx_shifts_org         on public.shifts         (organization_id);
create index idx_employees_org      on public.employees      (organization_id);
create index idx_assignments_org    on public.assignments    (organization_id);
create index idx_non_space_jobs_org on public.non_space_jobs (organization_id);
create index idx_room_types_org     on public.room_types     (organization_id);
create index idx_imports_org        on public.imports        (organization_id);
create index idx_ai_usage_org_time  on public.ai_usage       (organization_id, created_at);
create index idx_audit_org_time     on public.audit_log      (organization_id, created_at);

-- ---------------------------------------------------------------------------
-- 5. invite hardening — 0001's codes were 8 hex chars (~32 bits) with no
--    expiry. Production codes are 24 hex chars (96 bits) and die after 7
--    days. redeem_invite enforces the expiry; create_invite generates the
--    longer code. Both replace the 0001 definitions.
-- ---------------------------------------------------------------------------
alter table public.invites
  add column expires_at timestamptz not null default (now() + interval '7 days');

create or replace function public.create_invite(invite_role text)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if public.current_role_name() <> 'director' then raise exception 'directors only'; end if;
  if invite_role not in ('supervisor', 'staff') then raise exception 'invalid role'; end if;
  code := encode(gen_random_bytes(12), 'hex');  -- 24 chars, 96 bits
  insert into public.invites (code, organization_id, role, created_by)
  values (code, public.current_org_id(), invite_role, auth.uid());
  return code;
end $$;

create or replace function public.redeem_invite(invite_code text, user_display_name text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where user_id = auth.uid()) then
    raise exception 'user already belongs to an organization';
  end if;
  select * into inv from public.invites
    where code = lower(invite_code) and redeemed_by is null and expires_at > now();
  if not found then
    -- 0001-era codes were uppercase; accept them too, same guards
    select * into inv from public.invites
      where code = upper(invite_code) and redeemed_by is null and expires_at > now();
  end if;
  if not found then raise exception 'invalid, expired, or already-used invite code'; end if;
  insert into public.profiles (user_id, organization_id, role, display_name)
  values (auth.uid(), inv.organization_id, inv.role, coalesce(user_display_name, ''));
  update public.invites set redeemed_by = auth.uid(), redeemed_at = now()
    where code = inv.code;
  return inv.organization_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6. delete_org_data covers the new tables (audit_log deliberately kept —
--    the deletion itself must remain auditable; it cascades away only if the
--    organization row itself is deleted).
-- ---------------------------------------------------------------------------
create or replace function public.delete_org_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'director' then raise exception 'directors only'; end if;
  insert into public.audit_log (organization_id, user_id, action, detail)
  values (public.current_org_id(), auth.uid(), 'org_data_delete', '{}');
  delete from public.workspaces     where organization_id = public.current_org_id();
  delete from public.ai_usage       where organization_id = public.current_org_id();
  delete from public.assignments    where organization_id = public.current_org_id();
  delete from public.non_space_jobs where organization_id = public.current_org_id();
  delete from public.rooms          where organization_id = public.current_org_id();
  delete from public.floors         where organization_id = public.current_org_id();
  delete from public.buildings      where organization_id = public.current_org_id();
  delete from public.employees      where organization_id = public.current_org_id();
  delete from public.shifts         where organization_id = public.current_org_id();
  delete from public.room_types     where organization_id = public.current_org_id();
  delete from public.rate_tables    where organization_id = public.current_org_id();
  delete from public.imports        where organization_id = public.current_org_id();
end $$;

-- ---------------------------------------------------------------------------
-- OPTIONAL HARDENING (documented, not enabled): require a verified second
-- factor (MFA, aal2) for director writes to workspaces. The app enforces MFA
-- enrollment for directors at sign-in; enable this once every director has
-- enrolled, otherwise un-enrolled directors lose write access mid-pilot.
--
--   drop policy workspaces_update on public.workspaces;
--   create policy workspaces_update on public.workspaces
--     for update using (
--       organization_id = public.current_org_id()
--       and public.current_role_name() in ('director','supervisor')
--       and (public.current_role_name() <> 'director'
--            or (auth.jwt()->>'aal') = 'aal2')
--     ) with check (organization_id = public.current_org_id() and updated_by = auth.uid());
-- ---------------------------------------------------------------------------
