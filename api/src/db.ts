// Storage: Supabase Postgres when DATABASE_URL is set, otherwise an embedded Postgres (PGlite)
// in api/data/pglite (or in memory for tests). Same SQL on both, so tests exercise the real queries.
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | undefined>;
  /** Runs fn in a transaction (nested calls reuse the outer one). */
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
}

export type Backend = 'supabase' | 'local';

interface Driver {
  backend: Backend;
  sql: Sql;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

async function postgresDriver(url: string): Promise<Driver> {
  const { default: postgres } = await import('postgres');
  // prepare: false works with Supabase's transaction pooler (port 6543) as well as direct connections.
  const pg = postgres(url, { max: Number(process.env.DB_POOL_SIZE) || 10, prepare: false, onnotice: () => {} });
  type Conn = { unsafe: (q: string, p?: any[]) => Promise<any> };
  const wrap = (c: Conn, inTx: boolean): Sql => {
    const self: Sql = {
      query: async (text, params = []) => [...(await c.unsafe(text, params as any[]))],
      one: async (text, params = []) => (await c.unsafe(text, params as any[]))[0],
      tx: (fn) => (inTx ? fn(self) : (pg.begin((t) => fn(wrap(t as unknown as Conn, true))) as Promise<any>)),
    };
    return self;
  };
  return {
    backend: 'supabase',
    sql: wrap(pg as unknown as Conn, false),
    exec: async (text) => void (await pg.unsafe(text)),
    close: () => pg.end({ timeout: 5 }),
  };
}

async function pgliteDriver(path: string): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (path !== ':memory:') mkdirSync(path, { recursive: true });
  const pg = await PGlite.create(path === ':memory:' ? undefined : path);
  type Conn = { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> };
  const wrap = (c: Conn, inTx: boolean): Sql => {
    const self: Sql = {
      query: async (text, params = []) => (await c.query(text, params)).rows,
      one: async (text, params = []) => (await c.query(text, params)).rows[0],
      tx: (fn) => (inTx ? fn(self) : pg.transaction((t) => fn(wrap(t as unknown as Conn, true)))),
    };
    return self;
  };
  return {
    backend: 'local',
    sql: wrap(pg as unknown as Conn, false),
    exec: async (text) => void (await pg.exec(text)),
    close: () => pg.close(),
  };
}

const driver = process.env.DATABASE_URL
  ? await postgresDriver(process.env.DATABASE_URL)
  : await pgliteDriver(process.env.DB_PATH ?? fileURLToPath(new URL('../data/pglite', import.meta.url)));

export const db = driver.sql;
export const backend = driver.backend;
export const closeDb = () => driver.close();

/** Applies api/migrations/*.sql once each, in order. `*.supabase.sql` files run only on Supabase. */
async function migrate(): Promise<void> {
  await driver.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  const applied = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    if (file.endsWith('.supabase.sql') && backend !== 'supabase') continue;
    const text = readFileSync(dir + file, 'utf8');
    // One simple-protocol message runs as a single implicit transaction: the migration and its
    // bookkeeping row commit together or not at all. File names come from our own folder.
    await driver.exec(`${text}\n;\ninsert into schema_migrations (name) values ('${file.replace(/'/g, "''")}');`);
    console.log(`Applied migration ${file}`);
  }
}
await migrate();

/** Multi-row insert in chunks, keeping each statement under Postgres's 65k-parameter limit. */
export async function insertMany(q: Sql, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  const per = Math.max(1, Math.floor(60_000 / columns.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const values = chunk.map((_, r) => `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(', ')})`).join(', ');
    await q.query(`insert into ${table} (${columns.join(', ')}) values ${values}`, chunk.flat());
  }
}
