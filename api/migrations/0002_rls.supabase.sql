-- Supabase only (skipped on local PGlite, which has no auth schema).
-- Row-level security: a signed-in user can read only the workspaces they belong to.
-- There are no insert/update/delete policies, so the public API (anon/authenticated keys)
-- cannot write at all; writes go through the ElevenRoute API, which checks the user's token
-- and connects with the database role from DATABASE_URL.

alter table workspace_members
  add constraint workspace_members_user_fk foreign key (user_id) references auth.users(id) on delete cascade;

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table workspace_settings enable row level security;
alter table turns enable row level security;
alter table test_runs enable row level security;
alter table test_results enable row level security;
alter table alerts enable row level security;
alter table schema_migrations enable row level security;

-- security definer so the membership lookup itself isn't blocked by RLS on workspace_members.
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;

create policy "members read their workspaces" on workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy "users read their memberships" on workspace_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "members read settings" on workspace_settings
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members read turns" on turns
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members read test runs" on test_runs
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members read test results" on test_results
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members read alerts" on alerts
  for select to authenticated using (public.is_workspace_member(workspace_id));
