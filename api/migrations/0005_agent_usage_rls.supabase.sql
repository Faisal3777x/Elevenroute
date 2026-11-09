-- Supabase only: keep agent_usage out of the public API (no policies, so anon/authenticated can't read or write it).
alter table agent_usage enable row level security;
