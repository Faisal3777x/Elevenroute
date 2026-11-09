-- Real answers given by the Playground answer agent, per UTC day (server-wide, because the API keys are
-- server-wide). Enforces AGENT_DAILY_LIMIT so an open public link can't run up the provider bill.
create table if not exists agent_usage (
  day text primary key,
  answers integer not null default 0
);
