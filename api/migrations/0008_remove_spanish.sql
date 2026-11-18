-- Spanish was removed: ElevenRoute supports English only. Delete Spanish traffic and test results, rescore the saved
-- test runs on the English results that remain, and strip Spanish from every workspace's saved settings.
-- Safe to run more than once.

delete from turns where language = 'es';
delete from test_results where language = 'es';

-- A run's score per model is the average of its case scores (evaluation.ts → runTests).
update test_runs r
set scores = coalesce(
  (select jsonb_object_agg(x.model_id, x.score)
   from (select model_id, avg(score) as score from test_results where run_id = r.id group by model_id) as x),
  '{}'::jsonb
);

-- Language preferences: drop the Spanish entry.
update workspace_settings
set value = coalesce(
  (select jsonb_agg(l order by i) from jsonb_array_elements(value) with ordinality as t(l, i) where l->>'language' is distinct from 'es'),
  '[]'::jsonb
)
where key = 'languages' and jsonb_typeof(value) = 'array';

-- Segment scores ("language:turnType" per model): drop the Spanish segments.
update workspace_settings
set value = coalesce(
  (select jsonb_object_agg(
     t.k,
     case when jsonb_typeof(t.v) = 'object'
       then coalesce((select jsonb_object_agg(s.sk, s.sv) from jsonb_each(t.v) as s(sk, sv) where s.sk not like 'es:%'), '{}'::jsonb)
       else t.v end)
   from jsonb_each(value) as t(k, v)),
  '{}'::jsonb
)
where key = 'segments' and jsonb_typeof(value) = 'object';

-- Models: no longer list Spanish.
update workspace_settings
set value = coalesce(
  (select jsonb_agg(
     case when jsonb_typeof(m->'languages') = 'array'
       then jsonb_set(m, '{languages}', coalesce((select jsonb_agg(l) from jsonb_array_elements(m->'languages') as l where l #>> '{}' <> 'es'), '[]'::jsonb))
       else m end
     order by i)
   from jsonb_array_elements(value) with ordinality as t(m, i)),
  '[]'::jsonb
)
where key = 'models' and jsonb_typeof(value) = 'array';

-- Models: test score and exclusion follow the rescored latest run, as a test run would set them.
update workspace_settings w
set value = coalesce(
  (select jsonb_agg(
     case when latest.scores ? (m->>'id')
       then m || jsonb_build_object(
         'testScore', latest.scores->(m->>'id'),
         'excluded', (latest.scores->>(m->>'id'))::float8 < coalesce(
           (select (s.value->>'exclusionFloor')::float8 from workspace_settings s where s.workspace_id = w.workspace_id and s.key = 'strategy'),
           0.7))
       else m end
     order by i)
   from jsonb_array_elements(w.value) with ordinality as t(m, i)),
  '[]'::jsonb
)
from (select distinct on (workspace_id) workspace_id, scores from test_runs order by workspace_id, id desc) as latest
where w.key = 'models' and jsonb_typeof(w.value) = 'array' and latest.workspace_id = w.workspace_id;

-- Classifier rules: drop the Spanish phrases the demo shipped with.
update workspace_settings
set value = coalesce(
  (select jsonb_agg(
     case when jsonb_typeof(r->'phrases') = 'array'
       then jsonb_set(r, '{phrases}', coalesce(
         (select jsonb_agg(p order by j) from jsonb_array_elements(r->'phrases') with ordinality as q(p, j)
          where p #>> '{}' not in ('reembolso', 'devolución', 'devolver', 'cobro', 'disputa', 'queja', 'cancelar',
                                   'sí', 'si', 'gracias', 'vale', 'de acuerdo', 'perfecto', 'claro')),
         '[]'::jsonb))
       else r end
     order by i)
   from jsonb_array_elements(value) with ordinality as t(r, i)),
  '[]'::jsonb
)
where key = 'rules' and jsonb_typeof(value) = 'array';
