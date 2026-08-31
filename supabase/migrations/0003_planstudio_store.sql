-- 0003: the Calibration Editor's saved sets (HANDOFF §12j–§12l) sync as a
-- new workspace store, opsmatrix_fusion_planstudio. 0002's whitelist
-- predates it, so every push carrying the new store was rejected with
-- workspaces_key_check — and because pushes are one batch, that blocked the
-- WHOLE push. This extends the whitelist; nothing else changes.
--
-- Run order: after 0001_init.sql and 0002_production.sql, in each project
-- (dev, staging, prod). Safe to run once; re-running fails harmlessly on
-- the drop if already applied.

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
    'opsmatrix_fusion_planstudio'
  ));
