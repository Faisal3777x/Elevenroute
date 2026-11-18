process.env.DB_PATH = ':memory:';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const { db, execSql } = await import('../src/db.ts');
const { openWorkspace, workspaceIdFor } = await import('../src/store.ts');

// Migration 0008 already ran on this empty database at startup. Here it runs again over data saved before
// Spanish was removed, which also shows it is safe to run twice.
const sql = readFileSync(new URL('../migrations/0008_remove_spanish.sql', import.meta.url), 'utf8');

test('0008 removes Spanish data and rescores the latest test run on English results', async () => {
  const ws = (await openWorkspace(await workspaceIdFor({ id: crypto.randomUUID(), email: 'old@example.com' }))).id;
  const setting = (key: string, value: unknown) =>
    db.query('insert into workspace_settings (workspace_id, key, value) values ($1, $2, $3::jsonb)', [ws, key, JSON.stringify(value)]);
  const turn = (language: string) =>
    db.query(
      `insert into turns (workspace_id, ts, conversation_id, customer_id, language, use_case, turn_type, model_id, vendor, tokens_in, tokens_out, cost, latency_ms, overhead_ms, failover, synthetic)
       values ($1, 1, 'c', 'default', $2, 'faq', 'simple', 'gpt-5', 'openai', 10, 10, 0.001, 100, 1, false, true)`,
      [ws, language],
    );
  await turn('en');
  await turn('es');

  // One run: GPT-5 scored 0.9 in English and 0.5 in Spanish (saved overall 0.7); Haiku 0.6 and 0.6.
  const run = (await db.one<{ id: number }>("insert into test_runs (workspace_id, ts, mode, scores) values ($1, 1, 'demo', $2::jsonb) returning id", [ws, JSON.stringify({ 'gpt-5': 0.7, 'claude-haiku-5-5': 0.6 })]))!.id;
  const result = (model: string, language: string, score: number) =>
    db.query(
      `insert into test_results (run_id, workspace_id, model_id, case_id, use_case, language, turn_type, completed, accuracy, tone, latency_ms, score, reply)
       values ($1, $2, $3, 'x', 'faq', $4, 'simple', true, 4, 4, 100, $5, 'r')`,
      [run, ws, model, language, score],
    );
  await result('gpt-5', 'en', 0.9);
  await result('gpt-5', 'es', 0.5);
  await result('claude-haiku-5-5', 'en', 0.6);
  await result('claude-haiku-5-5', 'es', 0.6);

  await setting('languages', [{ language: 'en', qualityFloor: null, vendorOrder: ['anthropic'] }, { language: 'es', qualityFloor: 0.8, vendorOrder: ['openai'] }]);
  await setting('segments', { 'gpt-5': { 'en:simple': 0.9, 'es:simple': 0.5 } });
  await setting('models', [
    { id: 'gpt-5', languages: ['en', 'es'], testScore: 0.7, excluded: false },
    { id: 'claude-haiku-5-5', languages: ['en', 'es'], testScore: 0.6, excluded: true },
    { id: 'custom', languages: ['es', 'en'], testScore: null, excluded: false },
  ]);
  await setting('rules', [
    { id: 'dispute', phrases: ['refund', 'reembolso', 'queja', 'complaint'] },
    { id: 'confirmation', phrases: ['yes', 'sí', 'si', 'gracias', 'thanks'] },
    { id: 'long', words: 18 },
  ]);

  await execSql(sql);
  await execSql(sql);

  const get = async (key: string) => (await db.one<{ value: any }>('select value from workspace_settings where workspace_id = $1 and key = $2', [ws, key]))!.value;
  const langs = await db.query<{ language: string }>('select distinct language from turns where workspace_id = $1', [ws]);
  assert.deepEqual(langs.map((r) => r.language), ['en']);
  assert.equal((await db.one<{ n: number }>("select count(*)::int as n from test_results where workspace_id = $1 and language = 'es'", [ws]))!.n, 0);

  const scores = (await db.one<{ scores: Record<string, number> }>('select scores from test_runs where id = $1', [run]))!.scores;
  assert.ok(Math.abs(scores['gpt-5'] - 0.9) < 1e-9, 'rescored on the English result only');
  assert.ok(Math.abs(scores['claude-haiku-5-5'] - 0.6) < 1e-9);

  assert.deepEqual((await get('languages')).map((l: { language: string }) => l.language), ['en']);
  assert.deepEqual(await get('segments'), { 'gpt-5': { 'en:simple': 0.9 } });

  const models = await get('models');
  assert.deepEqual(models.map((m: { languages: string[] }) => m.languages), [['en'], ['en'], ['en']]);
  assert.ok(Math.abs(models[0].testScore - 0.9) < 1e-9);
  assert.equal(models[0].excluded, false);
  assert.equal(models[1].excluded, true, '0.6 is under the default 0.7 exclusion floor');
  assert.equal(models[2].testScore, null, 'a model the run did not score is left alone');

  const rules = await get('rules');
  assert.deepEqual(rules[0].phrases, ['refund', 'complaint']);
  assert.deepEqual(rules[1].phrases, ['yes', 'thanks']);
  assert.deepEqual(rules[2], { id: 'long', words: 18 });
});
