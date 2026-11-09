-- Supabase only. Allow the API to run with sign-in off (open access) against Supabase Postgres:
-- every request then acts as the fixed local user (auth.ts LOCAL_USER), which has no row in auth.users,
-- so workspace_members.user_id can no longer require one. Row-level security is unchanged: members can
-- still only read their own workspaces through the public API, and nobody can write through it.
alter table workspace_members drop constraint if exists workspace_members_user_fk;
