-- OpsMatrix Scheduler — initial schema
-- ============================================================================
-- DESIGN RULE — NO PHI, EVER:
-- This schema stores physical spaces, cleaning rates, shifts and staff work
-- assignments only. It must never hold patient names, room-occupant data,
-- census information, or any medical information. Do not add such columns.
-- ============================================================================
-- Multi-tenant: every domain table carries organization_id and RLS ensures one
-- org can never read or write another org's rows.
-- Roles: director (edits everything), supervisor (edits schedules),
--        staff (read-only "my day").

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- organizations & profiles
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- optimistic-concurrency revision; bumped on every state save
  state_rev   bigint not null default 0
);

create table public.profiles (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role            text not null check (role in ('director', 'supervisor', 'staff')),
  display_name    text not null default '',
  created_at      timestamptz not null default now()
);

create table public.invites (
  code            text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role            text not null check (role in ('supervisor', 'staff')),
  created_by      uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),
  redeemed_by     uuid references auth.users (id),
  redeemed_at     timestamptz
);

-- ---------------------------------------------------------------------------
-- helper functions (security definer so RLS policies can use them)
-- ---------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as
$$ select organization_id from public.profiles where user_id = auth.uid() $$;

create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as
$$ select role from public.profiles where user_id = auth.uid() $$;

-- ---------------------------------------------------------------------------
-- domain tables (text ids: the app generates ids like 'rm_ab12cd')
-- ---------------------------------------------------------------------------
create table public.buildings (
  id              text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null
);

create table public.floors (
  id              text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  building_id     text not null references public.buildings (id) on delete cascade,
  name            text not null,
  geometry        jsonb,            -- DXF walls/labels/openings (feet)
  gross_sqft      double precision, -- includes wall footprint: REFERENCE ONLY
  cleanable_sqft  double precision, -- interior only: the working number
  imported_at     timestamptz
);

create table public.rooms (
  id               text primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  floor_id         text not null references public.floors (id) on delete cascade,
  department       text not null default 'Unassigned',
  name             text not null,
  room_type        text not null default '(untyped)',
  floor_type       text not null default 'VCT',
  fixtures         integer not null default 0,
  cleanable_sqft   double precision not null, -- THE ONLY number used in workload math
  ceiling_height   text not null default '',
  perimeter        text not null default '',
  door_area_sqft   double precision not null default 0,
  window_area_sqft double precision not null default 0,
  tasks            jsonb not null default '[]',
  frequency        text not null default '7x',
  map_x            double precision,
  map_y            double precision,
  source           text not null default 'magicplan'
);

create table public.shifts (
  id              text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  start_time      text not null,
  end_time        text not null
);

create table public.employees (
  id              text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  role_title      text not null default 'EVS Tech',
  shift_id        text references public.shifts (id) on delete set null,
  pattern         jsonb not null default '[false,true,true,true,true,true,false]'
);

-- room → shift/employee scheduling (kept separate so supervisors can edit
-- schedules without write access to facility data)
create table public.assignments (
  id              text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  room_id         text not null unique references public.rooms (id) on delete cascade,
  shift_id        text references public.shifts (id) on delete set null,
  employee_id     text references public.employees (id) on delete set null
);

create table public.non_space_jobs (
  id               text primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  type             text not null default 'custom',
  mode             text not null check (mode in ('block', 'unit')),
  minutes          double precision not null default 0,
  units_per_day    double precision not null default 0,
  minutes_per_unit double precision not null default 0,
  shift_id         text references public.shifts (id) on delete set null,
  employee_id      text references public.employees (id) on delete set null
);

create table public.room_types (
  id              text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  floor_type      text not null,
  fixtures        integer not null default 0,
  frequency       text not null default '7x',
  tasks           jsonb not null default '[]'
);

-- rate tables and misc settings as keyed jsonb documents:
-- kinds: base_rates, modifiers, scalars, floor_types, frequencies, ui_prefs
create table public.rate_tables (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind            text not null,
  data            jsonb not null,
  primary key (organization_id, kind)
);

create table public.imports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  filenames       jsonb not null default '[]',
  room_count      integer not null default 0,
  cleanable_sqft  double precision
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organizations  enable row level security;
alter table public.profiles       enable row level security;
alter table public.invites        enable row level security;
alter table public.buildings      enable row level security;
alter table public.floors         enable row level security;
alter table public.rooms          enable row level security;
alter table public.shifts         enable row level security;
alter table public.employees      enable row level security;
alter table public.assignments    enable row level security;
alter table public.non_space_jobs enable row level security;
alter table public.room_types     enable row level security;
alter table public.rate_tables    enable row level security;
alter table public.imports        enable row level security;

-- organizations: members can read their own org; only directors update it
create policy org_select on public.organizations
  for select using (id = public.current_org_id());
create policy org_update on public.organizations
  for update using (id = public.current_org_id() and public.current_role_name() = 'director');

-- profiles: users see profiles in their org, and always their own row
create policy profiles_select on public.profiles
  for select using (organization_id = public.current_org_id() or user_id = auth.uid());

-- invites: directors manage; anyone authenticated may read a single code to
-- redeem it (redemption itself goes through the security-definer function)
create policy invites_select on public.invites
  for select using (organization_id = public.current_org_id() and public.current_role_name() = 'director');
create policy invites_insert on public.invites
  for insert with check (organization_id = public.current_org_id() and public.current_role_name() = 'director');
create policy invites_delete on public.invites
  for delete using (organization_id = public.current_org_id() and public.current_role_name() = 'director');

-- facility + settings tables: org members read; only directors write
do $$
declare t text;
begin
  foreach t in array array['buildings','floors','rooms','shifts','employees','room_types','rate_tables','imports']
  loop
    execute format('create policy %I_select on public.%I for select using (organization_id = public.current_org_id());', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (organization_id = public.current_org_id() and public.current_role_name() = ''director'');', t, t);
    execute format('create policy %I_update on public.%I for update using (organization_id = public.current_org_id() and public.current_role_name() = ''director'');', t, t);
    execute format('create policy %I_delete on public.%I for delete using (organization_id = public.current_org_id() and public.current_role_name() = ''director'');', t, t);
  end loop;
end $$;

-- schedule tables: org members read; directors AND supervisors write
do $$
declare t text;
begin
  foreach t in array array['assignments','non_space_jobs']
  loop
    execute format('create policy %I_select on public.%I for select using (organization_id = public.current_org_id());', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (organization_id = public.current_org_id() and public.current_role_name() in (''director'',''supervisor''));', t, t);
    execute format('create policy %I_update on public.%I for update using (organization_id = public.current_org_id() and public.current_role_name() in (''director'',''supervisor''));', t, t);
    execute format('create policy %I_delete on public.%I for delete using (organization_id = public.current_org_id() and public.current_role_name() in (''director'',''supervisor''));', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- First signup: create an org and become its director.
create or replace function public.create_organization(org_name text, user_display_name text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where user_id = auth.uid()) then
    raise exception 'user already belongs to an organization';
  end if;
  insert into public.organizations (name) values (org_name) returning id into new_org;
  insert into public.profiles (user_id, organization_id, role, display_name)
  values (auth.uid(), new_org, 'director', coalesce(user_display_name, ''));
  return new_org;
end $$;

-- Director generates an invite code for a supervisor or staff member.
create or replace function public.create_invite(invite_role text)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if public.current_role_name() <> 'director' then raise exception 'directors only'; end if;
  if invite_role not in ('supervisor', 'staff') then raise exception 'invalid role'; end if;
  code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  insert into public.invites (code, organization_id, role, created_by)
  values (code, public.current_org_id(), invite_role, auth.uid());
  return code;
end $$;

-- New user redeems an invite code to join the org with the invited role.
create or replace function public.redeem_invite(invite_code text, user_display_name text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where user_id = auth.uid()) then
    raise exception 'user already belongs to an organization';
  end if;
  select * into inv from public.invites
    where code = upper(invite_code) and redeemed_by is null;
  if not found then raise exception 'invalid or already-used invite code'; end if;
  insert into public.profiles (user_id, organization_id, role, display_name)
  values (auth.uid(), inv.organization_id, inv.role, coalesce(user_display_name, ''));
  update public.invites set redeemed_by = auth.uid(), redeemed_at = now()
    where code = inv.code;
  return inv.organization_id;
end $$;

-- Optimistic-concurrency bump: succeeds only when the caller saw the latest rev.
create or replace function public.bump_state_rev(expected_rev bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare new_rev bigint;
begin
  update public.organizations
     set state_rev = state_rev + 1, updated_at = now()
   where id = public.current_org_id() and state_rev = expected_rev
   returning state_rev into new_rev;
  if new_rev is null then
    return -1; -- conflict: someone saved since we loaded
  end if;
  return new_rev;
end $$;

-- Export / delete all org data (Settings > Data & Security).
create or replace function public.delete_org_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role_name() <> 'director' then raise exception 'directors only'; end if;
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
