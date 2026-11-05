import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const path = process.env.DB_PATH ?? fileURLToPath(new URL('../data/elevenroute.db', import.meta.url));
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

export const db = new DatabaseSync(path);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    conversation_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    language TEXT NOT NULL,
    use_case TEXT NOT NULL,
    turn_type TEXT NOT NULL,
    model_id TEXT,
    vendor TEXT,
    tokens_in INTEGER NOT NULL,
    tokens_out INTEGER NOT NULL,
    cost REAL NOT NULL,
    latency_ms REAL NOT NULL,
    overhead_ms REAL NOT NULL,
    failover INTEGER NOT NULL,
    failover_from TEXT,
    failover_reason TEXT,
    synthetic INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS turns_ts ON turns(ts);
  CREATE TABLE IF NOT EXISTS test_runs (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, mode TEXT NOT NULL, scores TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS test_results (
    run_id INTEGER NOT NULL, model_id TEXT NOT NULL, case_id TEXT NOT NULL,
    use_case TEXT NOT NULL, language TEXT NOT NULL, turn_type TEXT NOT NULL,
    completed INTEGER NOT NULL, accuracy REAL NOT NULL, tone REAL NOT NULL,
    latency_ms REAL NOT NULL, score REAL NOT NULL, reply TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS results_run ON test_results(run_id);
  CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, model_id TEXT NOT NULL, message TEXT NOT NULL);
`);

export function kvGet<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function kvSet(key: string, value: unknown): void {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
