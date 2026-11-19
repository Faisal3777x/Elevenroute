-- Private sandboxes for open access (sign-in off, DEMO_ONLY=1). The shared demo workspace is read-only to the public;
-- a visitor's first change copies it into a sandbox of their own (sandbox_of = the demo it was copied from).
-- Sandboxes that nobody has used for a while are deleted (last_seen_at); their rows go with them (on delete cascade).
alter table workspaces add column if not exists sandbox_of uuid references workspaces(id) on delete cascade;
alter table workspaces add column if not exists last_seen_at timestamptz not null default now();
create index if not exists workspaces_sandbox_seen on workspaces(last_seen_at) where sandbox_of is not null;
