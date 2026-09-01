-- 0004: Max Sanitation and Max Policing keep their routes in a new workspace
-- store, opsmatrix_fusion_routes. Like every store, the DB whitelist has to
-- know about it BEFORE the client syncs one — a rejected row blocks the whole
-- push (that is exactly what broke staging on 2026-08-31, see 0003).
-- src/pro/workspaceSchema.test.ts fails CI if this file and WORKSPACE_KEYS
-- ever disagree again.
--
-- Run order: after 0001–0003, in each project (dev, staging, prod). Safe to
-- run once; re-running fails harmlessly on the drop if already applied.

alter table public.workspaces
  drop constraint workspaces_key_check;

alter table public.workspaces
  add constraint workspaces_key_check check (key in (
    'opsmatrix_v7',
    'opsmatrix_v7_plans',
    'opsmatrix_v7_demo_stamp',
    'opsmatrix_fusion_rules',
    'opsmatrix_fusion_nonspace',
    'opsmatrix_fusion_aliases',
    'opsmatrix_fusion_floorcare',
    'opsmatrix_fusion_planstudio',
    'opsmatrix_fusion_routes'
  ));
