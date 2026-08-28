-- OpsMatrix — cross-tenant isolation test (the RLS proof)
-- ============================================================================
-- Proves, against the real migrations, that one organization can never read
-- or write another organization's rows — the guarantee everything else rests
-- on. Run it against a scratch database that has 0001 + 0002 applied and the
-- auth stub below (NEVER against production):
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls-isolation.test.sql
--
-- Prereq stub (what supabase provides for real; needed on plain Postgres):
--   create schema auth;
--   create table auth.users (id uuid primary key);
--   create function auth.uid() ... ;  -- replaced below with a settable one
--
-- The script replaces auth.uid() with a session-settable version, creates
-- two orgs with one director each, then switches to an UNPRIVILEGED role
-- (RLS enforced) and asserts every boundary. Any failed assertion aborts
-- with an exception — exit code 0 means the fence holds.
-- ============================================================================

begin;

-- auth.uid() reads a session setting so one connection can play both users
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

-- an unprivileged role that RLS actually applies to
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'rls_test_user') then
    create role rls_test_user login;
  end if;
end $$;
grant usage on schema public to rls_test_user;
grant select, insert, update, delete on all tables in schema public to rls_test_user;
grant execute on all functions in schema public to rls_test_user;

-- ── fixtures (as superuser: two orgs, a director in each, a workspace row each)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');
insert into public.organizations (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Org A'),
  ('20000000-0000-0000-0000-000000000002', 'Org B');
insert into public.profiles (user_id, organization_id, role, display_name) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'director', 'Alice'),
  ('00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000002', 'director', 'Bob');
insert into public.workspaces (organization_id, key, content, updated_by) values
  ('10000000-0000-0000-0000-000000000001', 'opsmatrix_v7', '{"org":"A"}', '00000000-0000-0000-0000-00000000000a'),
  ('20000000-0000-0000-0000-000000000002', 'opsmatrix_v7', '{"org":"B"}', '00000000-0000-0000-0000-00000000000b');
insert into public.buildings (id, organization_id, name)
  values ('bl_b1', '20000000-0000-0000-0000-000000000002', 'B building');
insert into public.floors (id, organization_id, building_id, name)
  values ('fl_b1', '20000000-0000-0000-0000-000000000002', 'bl_b1', '1');
insert into public.rooms (id, organization_id, floor_id, name, cleanable_sqft)
  values ('rm_b1', '20000000-0000-0000-0000-000000000002', 'fl_b1', 'B room', 100);
insert into public.ai_usage (organization_id, endpoint, model, input_tokens, output_tokens)
  values ('20000000-0000-0000-0000-000000000002', 'messages', 'claude-fable-5', 100, 50);

-- ── the assertions run as the unprivileged role
set role rls_test_user;

-- Alice's session
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

do $$
declare n int; content_seen text;
begin
  -- 1. Alice sees exactly one workspace row: her own org's
  select count(*), min(content) into n, content_seen from public.workspaces;
  if n <> 1 or content_seen <> '{"org":"A"}' then
    raise exception 'FAIL 1: Alice sees % workspace rows (content %)', n, content_seen;
  end if;

  -- 2. Alice sees none of Org B's facility rows
  select count(*) into n from public.rooms;
  if n <> 0 then raise exception 'FAIL 2: Alice sees % of org B''s rooms', n; end if;

  -- 3. Alice sees no ai_usage of org B
  select count(*) into n from public.ai_usage;
  if n <> 0 then raise exception 'FAIL 3: Alice sees % ai_usage rows of org B', n; end if;

  -- 4. Alice cannot UPDATE org B's workspace (0 rows affected — filtered, not errored)
  update public.workspaces set content = 'HACKED'
    where organization_id = '20000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4: Alice updated % of org B''s workspace rows', n; end if;

  -- 5. Alice cannot INSERT into org B (policy with-check must reject)
  begin
    insert into public.workspaces (organization_id, key, content, updated_by)
      values ('20000000-0000-0000-0000-000000000002', 'opsmatrix_fusion_rules', '{}',
              '00000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL 5: Alice inserted into org B''s workspace';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- 6. Alice cannot forge updated_by as Bob even in her own org
  begin
    insert into public.workspaces (organization_id, key, content, updated_by)
      values ('10000000-0000-0000-0000-000000000001', 'opsmatrix_fusion_rules', '{}',
              '00000000-0000-0000-0000-00000000000b');
    raise exception 'FAIL 6: Alice forged updated_by';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- 7. Alice cannot write ai_usage at all (service-role only)
  begin
    insert into public.ai_usage (organization_id) values ('10000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 7: client wrote ai_usage';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- 8. Alice cannot rewrite history in audit_log (no update policy)
  insert into public.audit_log (organization_id, user_id, action)
    values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'test');
  update public.audit_log set action = 'tampered';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 8: audit_log rows are client-editable'; end if;

  raise notice 'RLS ISOLATION: all 8 assertions passed for Alice';
end $$;

-- a user with NO profile (pre-onboarding) sees nothing at all
select set_config('test.uid', '', false);
do $$
declare n int;
begin
  select count(*) into n from public.workspaces;
  if n <> 0 then raise exception 'FAIL 9: anonymous session sees workspace rows'; end if;
  select count(*) into n from public.organizations;
  if n <> 0 then raise exception 'FAIL 10: anonymous session sees organizations'; end if;
  raise notice 'RLS ISOLATION: anonymous sees nothing (2 assertions passed)';
end $$;

reset role;
rollback;  -- leave the scratch database exactly as found

\echo 'RLS ISOLATION TEST: PASS'
