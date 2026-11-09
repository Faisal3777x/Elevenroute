-- The demo customers Acme Health, Globex Retail and Initech Insurance were removed: drop them from every
-- workspace's saved policies, keeping the Default policy and any customer someone added themselves.
-- Logged turns that name them fall back to the Default policy (router.ts → policyFor).
update workspace_settings
set value = coalesce(
  (select jsonb_agg(p) from jsonb_array_elements(value) as p where p->>'id' not in ('acme', 'globex', 'initech')),
  '[]'::jsonb
)
where key = 'policies' and jsonb_typeof(value) = 'array';
