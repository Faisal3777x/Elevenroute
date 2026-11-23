// Night Bite Diner: the game simulation. Pure TypeScript with no React Native
// imports, so scripts/simulate.ts can run it in Node.
//
// The state is a plain object that `tick` mutates in place. Every timer is an
// absolute timestamp, so stoves keep cooking while the app is closed.

import {
  BASE_PATIENCE_MS,
  BASE_SPAWN_MS,
  CLEAN_MS,
  COUNTER_CAPACITY,
  DISHES,
  DOOR,
  EAT_MS,
  ENERGY_DRAIN_PER_MS,
  ESPRESSO_COST,
  GRID_H,
  GRID_W,
  GUEST_LOOKS,
  GUEST_STEP_MS,
  ITEMS,
  STAFF_LOOKS,
  STAFF_NAMES,
  STAFF_STEP_MS,
  STAFF_TIRED_STEP_MS,
  START_COINS,
  dishById,
  hireCost,
  maxOf,
  maxStaff,
  sellValue,
  xpForLevel,
} from './data.ts';
import type { DishId, ItemKind } from './data.ts';

export interface Pt {
  x: number;
  y: number;
}

export interface Item extends Pt {
  id: string;
  kind: ItemKind;
  /** Stoves: what is cooking, or ready and waiting to be carried out. */
  cook?: { dish: DishId; startedAt: number; readyAt: number; servings: number } | null;
  /** Counters: what is on offer. `reserved` servings are promised to guests, `incoming` are being carried here. */
  stock?: { dish: DishId; servings: number; reserved: number; incoming: number } | null;
  /** Tables: a guest has left and nobody has wiped it yet. */
  dirty?: boolean;
}

/** Where an entity is heading: next to an item, or to the door. */
export type Goal = { itemId: string } | 'door' | Pt;

export type Task =
  | { type: 'haul'; stoveId: string; counterId: string; phase: 'toStove' | 'toCounter' }
  | { type: 'serve'; counterId: string; guestId: string; phase: 'toCounter' | 'toTable' }
  | { type: 'clean'; tableId: string; phase: 'toTable' | 'cleaning' }
  | { type: 'wander' };

export interface Staff extends Pt {
  id: string;
  name: string;
  look: string;
  energy: number;
  task: Task | null;
  carrying: { dish: DishId; servings: number } | null;
  goal: Goal | null;
  path: Pt[];
  nextStepAt: number;
  busyUntil: number;
}

export interface Guest extends Pt {
  id: string;
  look: string;
  state: 'arriving' | 'waiting' | 'eating' | 'leaving';
  tableId: string;
  order: DishId | null;
  servedBy: string | null;
  patienceUntil: number;
  patienceMs: number;
  eatUntil: number;
  mood: 'happy' | 'angry' | null;
  goal: Goal | null;
  path: Pt[];
  nextStepAt: number;
}

export interface Fx extends Pt {
  id: string;
  text: string;
  tone: 'coin' | 'bad' | 'good' | 'xp';
  at: number;
}

export interface GameState {
  version: 1;
  coins: number;
  xp: number;
  level: number;
  rating: number;
  served: number;
  items: Item[];
  staff: Staff[];
  guests: Guest[];
  fx: Fx[];
  nextId: number;
  nextGuestAt: number;
  lastTick: number;
  seenIntro: boolean;
  toast: { text: string; at: number } | null;
  /** Set by tick when the player levels up, cleared by the UI. */
  levelUp: number | null;
}

export interface Result {
  ok: boolean;
  msg?: string;
}

// ---------------------------------------------------------------- setup

function uid(s: GameState, prefix: string): string {
  s.nextId += 1;
  return `${prefix}${s.nextId}`;
}

function newStaff(s: GameState, at: Pt, now: number): Staff {
  const n = s.staff.length;
  return {
    id: uid(s, 'z'),
    name: STAFF_NAMES[n % STAFF_NAMES.length],
    look: STAFF_LOOKS[n % STAFF_LOOKS.length],
    x: at.x,
    y: at.y,
    energy: 100,
    task: null,
    carrying: null,
    goal: null,
    path: [],
    nextStepAt: now,
    busyUntil: 0,
  };
}

export function newGame(now: number): GameState {
  const s: GameState = {
    version: 1,
    coins: START_COINS,
    xp: 0,
    level: 1,
    rating: 3,
    served: 0,
    items: [],
    staff: [],
    guests: [],
    fx: [],
    nextId: 0,
    nextGuestAt: now + 4_000,
    lastTick: now,
    seenIntro: false,
    toast: null,
    levelUp: null,
  };
  const add = (kind: ItemKind, x: number, y: number) => s.items.push({ id: uid(s, 'i'), kind, x, y, cook: null, stock: null, dirty: false });
  add('stove', 1, 0);
  add('counter', 3, 0);
  add('table', 1, 5);
  add('table', 5, 5);
  add('pumpkin', 6, 0);
  s.staff.push(newStaff(s, { x: 3, y: 3 }, now));
  return s;
}

/** Restore a saved game. People in motion are not saved: guests are sent home and staff start fresh. */
export function hydrate(raw: unknown, now: number): GameState {
  const s = raw as GameState;
  if (!s || s.version !== 1 || !Array.isArray(s.items)) return newGame(now);
  s.guests = [];
  s.fx = [];
  s.toast = null;
  s.levelUp = null;
  s.lastTick = now;
  s.nextGuestAt = now + 3_000;
  for (const it of s.items) {
    if (it.stock) {
      it.stock.reserved = 0;
      it.stock.incoming = 0;
      if (it.stock.servings <= 0) it.stock = null;
    }
  }
  s.staff.forEach((z, i) => {
    Object.assign(z, { task: null, carrying: null, goal: null, path: [], nextStepAt: now, busyUntil: 0, x: 2 + (i % 3), y: 3 + Math.floor(i / 3) });
  });
  return s;
}

export function serialize(s: GameState): string {
  const { fx: _fx, guests: _guests, toast: _toast, ...rest } = s;
  return JSON.stringify({ ...rest, fx: [], guests: [], toast: null });
}

// ---------------------------------------------------------------- grid & paths

export const itemAt = (s: GameState, x: number, y: number): Item | undefined => s.items.find((i) => i.x === x && i.y === y);
export const itemById = (s: GameState, id: string): Item | undefined => s.items.find((i) => i.id === id);
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
const DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function blockedGrid(items: Item[]): boolean[] {
  const g = new Array<boolean>(GRID_W * GRID_H).fill(false);
  for (const it of items) g[it.y * GRID_W + it.x] = true;
  return g;
}

/** Breadth-first search to the nearest goal tile. Returns the steps after `from`, or null. */
function bfs(blocked: boolean[], from: Pt, goals: Pt[]): Pt[] | null {
  if (goals.length === 0) return null;
  const goalSet = new Set(goals.map((g) => g.y * GRID_W + g.x));
  const start = from.y * GRID_W + from.x;
  if (goalSet.has(start)) return [];
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const cx = cur % GRID_W;
    const cy = Math.floor(cur / GRID_W);
    for (const d of DIRS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!inside(nx, ny)) continue;
      const n = ny * GRID_W + nx;
      if (blocked[n] || prev.has(n)) continue;
      prev.set(n, cur);
      if (goalSet.has(n)) {
        const path: Pt[] = [];
        for (let p = n; p !== start; p = prev.get(p)!) path.unshift({ x: p % GRID_W, y: Math.floor(p / GRID_W) });
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

function goalTiles(s: GameState, goal: Goal, blocked: boolean[]): Pt[] {
  if (goal === 'door') return [DOOR];
  if (!('itemId' in goal)) return [goal];
  const it = itemById(s, goal.itemId);
  if (!it) return [];
  return DIRS.map((d) => ({ x: it.x + d.x, y: it.y + d.y })).filter((p) => inside(p.x, p.y) && !blocked[p.y * GRID_W + p.x]);
}

/** Point an entity at a goal. Returns false when the goal can't be reached. */
function setGoal(s: GameState, e: Staff | Guest, goal: Goal, blocked = blockedGrid(s.items)): boolean {
  const path = bfs(blocked, e, goalTiles(s, goal, blocked));
  if (!path) return false;
  e.goal = goal;
  e.path = path;
  return true;
}

/** True when every stove, counter and table can be reached from the door. */
function layoutWorks(items: Item[]): boolean {
  const blocked = blockedGrid(items);
  if (blocked[DOOR.y * GRID_W + DOOR.x]) return false;
  const seen = new Set<number>([DOOR.y * GRID_W + DOOR.x]);
  const queue = [DOOR.y * GRID_W + DOOR.x];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (const d of DIRS) {
      const nx = (cur % GRID_W) + d.x;
      const ny = Math.floor(cur / GRID_W) + d.y;
      const n = ny * GRID_W + nx;
      if (inside(nx, ny) && !blocked[n] && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return items
    .filter((it) => ITEMS[it.kind].group !== 'decor')
    .every((it) => DIRS.some((d) => inside(it.x + d.x, it.y + d.y) && seen.has((it.y + d.y) * GRID_W + it.x + d.x)));
}

/** After the layout changes, re-plan every walk; anything that can no longer get there gives up. */
function replan(s: GameState) {
  const blocked = blockedGrid(s.items);
  for (const z of s.staff) {
    if (z.goal && !setGoal(s, z, z.goal, blocked)) abortTask(s, z);
  }
  for (const g of s.guests) {
    if (g.goal && !setGoal(s, g, g.goal, blocked)) {
      g.path = [];
    }
  }
}

// ---------------------------------------------------------------- derived values

export const spook = (s: GameState): number => s.items.reduce((n, it) => n + (ITEMS[it.kind].spook ?? 0), 0);
export const countOf = (s: GameState, kind: ItemKind): number => s.items.filter((i) => i.kind === kind).length;
export const isReady = (it: Item, now: number): boolean => !!it.cook && now >= it.cook.readyAt;
export const tipBonus = (s: GameState): number => Math.min(0.5, spook(s) * 0.02);

function spawnInterval(s: GameState): number {
  const base = BASE_SPAWN_MS / (0.6 + s.rating * 0.25 + spook(s) * 0.01);
  // Word gets round when the kitchen is cold: fewer guests try their luck.
  const anyFood = s.items.some((i) => i.cook || i.stock);
  return anyFood ? base : base * 3;
}

const stepMs = (z: Staff) => (z.energy <= 0 ? STAFF_TIRED_STEP_MS : STAFF_STEP_MS);

function fx(s: GameState, at: Pt, text: string, tone: Fx['tone'], now: number) {
  s.fx.push({ id: uid(s, 'f'), x: at.x, y: at.y, text, tone, at: now });
}

function toast(s: GameState, text: string, now: number) {
  s.toast = { text, at: now };
}

/** A counter that can take `dish`, preferring one that already has it. */
function counterFor(s: GameState, dish: DishId, prefer?: string): Item | undefined {
  const counters = s.items.filter((i) => i.kind === 'counter');
  const room = (c: Item) => COUNTER_CAPACITY - (c.stock ? c.stock.servings + c.stock.incoming : 0);
  const fits = (c: Item) => (!c.stock || c.stock.dish === dish) && room(c) > 0;
  const preferred = counters.find((c) => c.id === prefer && fits(c));
  return preferred ?? counters.find((c) => c.stock?.dish === dish && fits(c)) ?? counters.find(fits);
}

function tidyCounter(c: Item) {
  if (c.stock && c.stock.servings <= 0 && c.stock.reserved <= 0 && c.stock.incoming <= 0) c.stock = null;
}

// ---------------------------------------------------------------- staff jobs

function abortTask(s: GameState, z: Staff) {
  const t = z.task;
  if (t?.type === 'serve') {
    const guest = s.guests.find((g) => g.id === t.guestId);
    if (guest && guest.servedBy === z.id) guest.servedBy = null;
    if (t.phase === 'toCounter') {
      const c = itemById(s, t.counterId);
      if (c?.stock) {
        c.stock.reserved -= 1;
        tidyCounter(c);
      }
    }
  }
  if (t?.type === 'haul' && t.phase === 'toCounter' && z.carrying) {
    const c = itemById(s, t.counterId);
    if (c?.stock) {
      c.stock.incoming -= z.carrying.servings;
      tidyCounter(c);
    }
  }
  z.task = null;
  z.carrying = null;
  z.goal = null;
  z.path = [];
}

const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function assignJobs(s: GameState, now: number) {
  const idle = () => s.staff.filter((z) => (!z.task || z.task.type === 'wander') && now >= z.busyUntil);
  const nearest = (to: Pt) => idle().sort((a, b) => dist(a, to) - dist(b, to))[0];
  const blocked = blockedGrid(s.items);

  const give = (z: Staff, task: Task, goal: Goal): boolean => {
    const prev = { task: z.task, goal: z.goal, path: z.path };
    z.task = task;
    if (setGoal(s, z, goal, blocked)) return true;
    Object.assign(z, prev);
    return false;
  };

  // 1. Serve waiting guests whatever is on the counters.
  for (const g of s.guests) {
    if (g.state !== 'waiting' || g.servedBy) continue;
    const offers = s.items.filter((c) => c.kind === 'counter' && c.stock && c.stock.servings - c.stock.reserved > 0);
    if (offers.length === 0) break;
    const z = nearest(g);
    if (!z) return;
    const counter = offers[Math.floor(Math.random() * offers.length)];
    if (!give(z, { type: 'serve', counterId: counter.id, guestId: g.id, phase: 'toCounter' }, { itemId: counter.id })) continue;
    counter.stock!.reserved += 1;
    g.servedBy = z.id;
    g.order = counter.stock!.dish;
    g.patienceUntil += 10_000;
  }

  // 2. Carry finished food from stoves to counters.
  for (const st of s.items) {
    if (st.kind !== 'stove' || !isReady(st, now)) continue;
    if (s.staff.some((z) => z.task?.type === 'haul' && z.task.stoveId === st.id)) continue;
    const counter = counterFor(s, st.cook!.dish);
    if (!counter) continue;
    const z = nearest(st);
    if (!z) return;
    give(z, { type: 'haul', stoveId: st.id, counterId: counter.id, phase: 'toStove' }, { itemId: st.id });
  }

  // 3. Wipe dirty tables.
  for (const t of s.items) {
    if (t.kind !== 'table' || !t.dirty) continue;
    if (s.staff.some((z) => z.task?.type === 'clean' && z.task.tableId === t.id)) continue;
    const z = nearest(t);
    if (!z) return;
    give(z, { type: 'clean', tableId: t.id, phase: 'toTable' }, { itemId: t.id });
  }

  // 4. Nothing to do: shamble about now and then.
  for (const z of idle()) {
    if (!z.task && Math.random() < 0.02) {
      const spot = { x: Math.floor(Math.random() * GRID_W), y: 1 + Math.floor(Math.random() * (GRID_H - 3)) };
      if (!blocked[spot.y * GRID_W + spot.x]) give(z, { type: 'wander' }, spot);
    }
  }
}

/** The staff member has reached the end of their path: do the job's next step. */
function arrive(s: GameState, z: Staff, now: number) {
  const t = z.task;
  z.goal = null;
  if (!t) return;
  if (t.type === 'wander') {
    z.task = null;
    return;
  }
  if (t.type === 'haul') {
    if (t.phase === 'toStove') {
      const st = itemById(s, t.stoveId);
      if (!st || !isReady(st, now)) return abortTask(s, z);
      const counter = counterFor(s, st.cook!.dish, t.counterId);
      if (!counter) return abortTask(s, z);
      const room = COUNTER_CAPACITY - (counter.stock ? counter.stock.servings + counter.stock.incoming : 0);
      const amount = Math.min(room, st.cook!.servings);
      const dish = st.cook!.dish;
      counter.stock ??= { dish, servings: 0, reserved: 0, incoming: 0 };
      counter.stock.incoming += amount;
      st.cook!.servings -= amount;
      if (st.cook!.servings <= 0) st.cook = null;
      z.carrying = { dish, servings: amount };
      z.task = { ...t, counterId: counter.id, phase: 'toCounter' };
      if (!setGoal(s, z, { itemId: counter.id })) abortTask(s, z);
      return;
    }
    const c = itemById(s, t.counterId);
    if (c?.stock && z.carrying) {
      c.stock.incoming -= z.carrying.servings;
      c.stock.servings += z.carrying.servings;
      fx(s, c, `+${z.carrying.servings} ${dishById(z.carrying.dish).emoji}`, 'good', now);
    }
    z.carrying = null;
    z.task = null;
    return;
  }
  if (t.type === 'serve') {
    const guest = s.guests.find((g) => g.id === t.guestId);
    if (t.phase === 'toCounter') {
      const c = itemById(s, t.counterId);
      if (!c?.stock || c.stock.servings <= 0 || !guest || guest.state !== 'waiting') return abortTask(s, z);
      c.stock.servings -= 1;
      c.stock.reserved -= 1;
      z.carrying = { dish: c.stock.dish, servings: 1 };
      tidyCounter(c);
      z.task = { ...t, phase: 'toTable' };
      if (!setGoal(s, z, { itemId: guest.tableId })) abortTask(s, z);
      return;
    }
    if (guest && guest.state === 'waiting' && z.carrying) {
      guest.state = 'eating';
      guest.order = z.carrying.dish;
      guest.eatUntil = now + EAT_MS;
    }
    z.carrying = null;
    z.task = null;
    return;
  }
  if (t.type === 'clean') {
    const table = itemById(s, t.tableId);
    if (t.phase === 'toTable') {
      if (!table?.dirty) return abortTask(s, z);
      z.task = { ...t, phase: 'cleaning' };
      z.busyUntil = now + CLEAN_MS;
      return;
    }
  }
}

// ---------------------------------------------------------------- guests

function freeTable(s: GameState): Item | undefined {
  const taken = new Set(s.guests.filter((g) => g.state !== 'leaving').map((g) => g.tableId));
  const blocked = blockedGrid(s.items);
  const tables = s.items.filter((t) => t.kind === 'table' && !t.dirty && !taken.has(t.id));
  tables.sort(() => Math.random() - 0.5);
  return tables.find((t) => bfs(blocked, DOOR, goalTiles(s, { itemId: t.id }, blocked)) !== null);
}

function spawnGuest(s: GameState, now: number) {
  const table = freeTable(s);
  if (!table) return;
  const patienceMs = BASE_PATIENCE_MS + spook(s) * 500;
  const g: Guest = {
    id: uid(s, 'g'),
    look: GUEST_LOOKS[Math.floor(Math.random() * GUEST_LOOKS.length)],
    x: DOOR.x,
    y: DOOR.y,
    state: 'arriving',
    tableId: table.id,
    order: null,
    servedBy: null,
    patienceUntil: 0,
    patienceMs,
    eatUntil: 0,
    mood: null,
    goal: null,
    path: [],
    nextStepAt: now + GUEST_STEP_MS,
  };
  if (setGoal(s, g, { itemId: table.id })) s.guests.push(g);
}

function leave(s: GameState, g: Guest, mood: 'happy' | 'angry') {
  g.state = 'leaving';
  g.mood = mood;
  if (!setGoal(s, g, 'door')) g.path = [];
}

function updateGuest(s: GameState, g: Guest, now: number) {
  if (g.path.length > 0 && now >= g.nextStepAt) {
    const next = g.path.shift()!;
    g.x = next.x;
    g.y = next.y;
    g.nextStepAt = now + GUEST_STEP_MS;
    return;
  }
  if (g.path.length > 0) return;

  if (g.state === 'arriving') {
    if (g.goal) {
      g.state = 'waiting';
      g.goal = null;
      g.patienceUntil = now + g.patienceMs;
    } else if (!setGoal(s, g, { itemId: g.tableId })) {
      leave(s, g, 'angry');
    }
    return;
  }
  if (g.state === 'waiting' && now >= g.patienceUntil) {
    const z = s.staff.find((z) => z.task?.type === 'serve' && z.task.guestId === g.id);
    if (z) abortTask(s, z);
    s.rating = Math.max(0, s.rating - 0.12);
    fx(s, g, '😠', 'bad', now);
    leave(s, g, 'angry');
    return;
  }
  if (g.state === 'eating' && now >= g.eatUntil) {
    const dish = dishById(g.order!);
    const paid = Math.round(dish.price * (1 + tipBonus(s)));
    s.coins += paid;
    s.xp += dish.price;
    s.served += 1;
    s.rating = Math.min(5, s.rating + 0.05);
    fx(s, g, `+${paid}`, 'coin', now);
    const table = itemById(s, g.tableId);
    if (table) table.dirty = true;
    leave(s, g, 'happy');
    return;
  }
  if (g.state === 'leaving') {
    const home = g.x === DOOR.x && g.y === DOOR.y;
    if (home || !setGoal(s, g, 'door')) s.guests = s.guests.filter((x) => x !== g);
  }
}

// ---------------------------------------------------------------- the tick

export function tick(s: GameState, now: number) {
  const dt = Math.min(5_000, Math.max(0, now - s.lastTick));
  s.lastTick = now;

  if (now >= s.nextGuestAt) {
    spawnGuest(s, now);
    s.nextGuestAt = now + spawnInterval(s) * (0.7 + Math.random() * 0.6);
  }

  for (const g of [...s.guests]) updateGuest(s, g, now);

  for (const z of s.staff) {
    z.energy = Math.max(0, z.energy - dt * ENERGY_DRAIN_PER_MS);
    if (z.task?.type === 'clean' && z.task.phase === 'cleaning') {
      if (now >= z.busyUntil) {
        const table = itemById(s, z.task.tableId);
        if (table) {
          table.dirty = false;
          fx(s, table, '✨', 'good', now);
        }
        z.task = null;
      }
      continue;
    }
    if (z.path.length > 0) {
      if (now >= z.nextStepAt) {
        const next = z.path.shift()!;
        z.x = next.x;
        z.y = next.y;
        z.nextStepAt = now + stepMs(z);
      }
    } else if (z.task && now >= z.nextStepAt) {
      arrive(s, z, now);
    }
  }

  assignJobs(s, now);

  while (s.xp >= xpForLevel(s.level)) {
    s.level += 1;
    const bonus = 50 * s.level;
    s.coins += bonus;
    s.levelUp = s.level;
  }

  s.fx = s.fx.filter((f) => now - f.at < 1_400);
  if (s.toast && now - s.toast.at > 2_600) s.toast = null;
}

// ---------------------------------------------------------------- player actions

export function cook(s: GameState, stoveId: string, dish: DishId, now: number): Result {
  const st = itemById(s, stoveId);
  const d = dishById(dish);
  if (!st || st.kind !== 'stove') return { ok: false };
  if (st.cook) return { ok: false, msg: 'This stove is busy.' };
  if (d.level > s.level) return { ok: false, msg: `${d.name} unlocks at level ${d.level}.` };
  if (s.coins < d.cost) return { ok: false, msg: `You need ${d.cost} coins for ${d.name}.` };
  s.coins -= d.cost;
  st.cook = { dish, startedAt: now, readyAt: now + d.cookMs, servings: d.servings };
  return { ok: true };
}

/** Tapping a finished stove carries its food straight to a counter, for impatient owners. */
export function quickServe(s: GameState, stoveId: string, now: number): Result {
  const st = itemById(s, stoveId);
  if (!st || !isReady(st, now)) return { ok: false };
  const hauler = s.staff.find((z) => z.task?.type === 'haul' && z.task.stoveId === stoveId);
  if (hauler) abortTask(s, hauler);
  const dish = st.cook!.dish;
  const counter = counterFor(s, dish);
  if (!counter) return { ok: false, msg: 'Every counter is full or holds another dish.' };
  const amount = Math.min(st.cook!.servings, COUNTER_CAPACITY - (counter.stock ? counter.stock.servings + counter.stock.incoming : 0));
  counter.stock ??= { dish, servings: 0, reserved: 0, incoming: 0 };
  counter.stock.servings += amount;
  st.cook!.servings -= amount;
  if (st.cook!.servings <= 0) st.cook = null;
  fx(s, counter, `+${amount} ${dishById(dish).emoji}`, 'good', now);
  return { ok: true };
}

/** Throw out a stove's dish, cooking or ready. The ingredients are not refunded. */
export function discard(s: GameState, stoveId: string): Result {
  const st = itemById(s, stoveId);
  if (!st?.cook) return { ok: false };
  const hauler = s.staff.find((z) => z.task?.type === 'haul' && z.task.stoveId === stoveId && z.task.phase === 'toStove');
  if (hauler) abortTask(s, hauler);
  st.cook = null;
  return { ok: true };
}

export function canPlace(s: GameState, x: number, y: number, movingId?: string): boolean {
  if (!inside(x, y) || (x === DOOR.x && y === DOOR.y)) return false;
  const there = itemAt(s, x, y);
  return !there || there.id === movingId;
}

export function buy(s: GameState, kind: ItemKind, x: number, y: number, now: number): Result {
  const def = ITEMS[kind];
  if (def.level > s.level) return { ok: false, msg: `${def.name} unlocks at level ${def.level}.` };
  if (countOf(s, kind) >= maxOf(kind, s.level)) return { ok: false, msg: `Level up to own more ${def.name.toLowerCase()}s.` };
  if (s.coins < def.cost) return { ok: false, msg: `You need ${def.cost} coins.` };
  if (!canPlace(s, x, y)) return { ok: false, msg: 'Something is already there.' };
  const item: Item = { id: uid(s, 'i'), kind, x, y, cook: null, stock: null, dirty: false };
  if (!layoutWorks([...s.items, item])) return { ok: false, msg: 'That would block the way in.' };
  s.items.push(item);
  s.coins -= def.cost;
  fx(s, item, `-${def.cost}`, 'bad', now);
  replan(s);
  return { ok: true };
}

export function move(s: GameState, itemId: string, x: number, y: number): Result {
  const it = itemById(s, itemId);
  if (!it) return { ok: false };
  if (!canPlace(s, x, y, itemId)) return { ok: false, msg: 'Something is already there.' };
  const moved = s.items.map((i) => (i.id === itemId ? { ...i, x, y } : i));
  if (!layoutWorks(moved)) return { ok: false, msg: 'That would block the way in.' };
  it.x = x;
  it.y = y;
  replan(s);
  return { ok: true };
}

export function sell(s: GameState, itemId: string, now: number): Result {
  const it = itemById(s, itemId);
  if (!it) return { ok: false };
  const def = ITEMS[it.kind];
  if ((it.kind === 'stove' || it.kind === 'counter' || it.kind === 'table') && countOf(s, it.kind) <= 1)
    return { ok: false, msg: `You need at least one ${def.name.toLowerCase()}.` };
  if (it.cook) return { ok: false, msg: 'Wait until the stove is empty.' };
  if (it.stock) return { ok: false, msg: 'Serve what’s on the counter first.' };
  if (it.dirty || s.guests.some((g) => g.tableId === it.id))
    return { ok: false, msg: 'Someone is using this table.' };
  if (s.staff.some((z) => z.goal && typeof z.goal === 'object' && 'itemId' in z.goal && z.goal.itemId === it.id))
    return { ok: false, msg: 'A zombie is on its way there.' };
  s.items = s.items.filter((i) => i !== it);
  const back = sellValue(it.kind);
  s.coins += back;
  fx(s, it, `+${back}`, 'coin', now);
  replan(s);
  return { ok: true };
}

export function hire(s: GameState, now: number): Result {
  if (s.staff.length >= maxStaff(s.level)) return { ok: false, msg: 'Level up to hire more zombies.' };
  const cost = hireCost(s.staff.length);
  if (s.coins < cost) return { ok: false, msg: `Hiring costs ${cost} coins.` };
  s.coins -= cost;
  const z = newStaff(s, DOOR, now);
  s.staff.push(z);
  fx(s, DOOR, `${z.name} joined!`, 'good', now);
  return { ok: true };
}

export function espresso(s: GameState, staffId: string | 'all'): Result {
  const who = s.staff.filter((z) => (staffId === 'all' || z.id === staffId) && z.energy < 99);
  if (who.length === 0) return { ok: false, msg: 'Everyone is wide awake.' };
  const cost = who.length * ESPRESSO_COST;
  if (s.coins < cost) return { ok: false, msg: `That needs ${cost} coins.` };
  s.coins -= cost;
  for (const z of who) z.energy = 100;
  return { ok: true };
}

export function note(s: GameState, text: string, now: number) {
  toast(s, text, now);
}

export { DISHES };
