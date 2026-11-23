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
  GOALS,
  GUEST_LOOKS,
  GUEST_STEP_MS,
  ITEMS,
  PACES,
  PONDER_MS,
  RECRUIT_CHANCE,
  ROOMS,
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
import type { DishId, Goal as GoalDef, ItemKind } from './data.ts';

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

/** Where an entity is heading: next to an item, to the door, or to a tile. */
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
  /** Index into PACES. */
  pace: number;
  energy: number;
  task: Task | null;
  carrying: { dish: DishId; servings: number } | null;
  goal: Goal | null;
  path: Pt[];
  nextStepAt: number;
  busyUntil: number;
  /** When they joined, for the arrival animation. */
  joinedAt: number;
}

export interface Guest extends Pt {
  id: string;
  look: string;
  state: 'arriving' | 'waiting' | 'eating' | 'pondering' | 'leaving';
  tableId: string;
  order: DishId | null;
  servedBy: string | null;
  patienceUntil: number;
  patienceMs: number;
  eatUntil: number;
  ponderUntil: number;
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

export type Sfx = 'coin' | 'ding' | 'place' | 'level' | 'angry' | 'recruit' | 'cook' | 'sell' | 'coffee' | 'goal';

export interface GameState {
  version: 2;
  coins: number;
  xp: number;
  level: number;
  rating: number;
  /** The room is size × size tiles. */
  size: number;
  served: number;
  cooked: number;
  recruited: number;
  coffees: number;
  /** Index into GOALS of the goal on show. */
  goalIndex: number;
  muted: boolean;
  items: Item[];
  staff: Staff[];
  guests: Guest[];
  fx: Fx[];
  /** Sounds to play, drained by the UI after every tick. */
  sfx: Sfx[];
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

function newStaff(s: GameState, at: Pt, now: number, look?: string): Staff {
  const n = s.staff.length;
  const used = new Set(s.staff.map((z) => z.name));
  const name = STAFF_NAMES.find((x) => !used.has(x)) ?? `Zed ${n + 1}`;
  return {
    id: uid(s, 'z'),
    name,
    look: look ?? STAFF_LOOKS[n % STAFF_LOOKS.length],
    pace: n === 0 ? 1 : Math.floor(Math.random() * PACES.length),
    x: at.x,
    y: at.y,
    energy: 100,
    task: null,
    carrying: null,
    goal: null,
    path: [],
    nextStepAt: now,
    busyUntil: 0,
    joinedAt: now,
  };
}

export function newGame(now: number): GameState {
  const s: GameState = {
    version: 2,
    coins: START_COINS,
    xp: 0,
    level: 1,
    rating: 3,
    size: ROOMS[0].size,
    served: 0,
    cooked: 0,
    recruited: 0,
    coffees: 0,
    goalIndex: 0,
    muted: false,
    items: [],
    staff: [],
    guests: [],
    fx: [],
    sfx: [],
    nextId: 0,
    nextGuestAt: now + 4_000,
    lastTick: now,
    seenIntro: false,
    toast: null,
    levelUp: null,
  };
  const add = (kind: ItemKind, x: number, y: number) => s.items.push({ id: uid(s, 'i'), kind, x, y, cook: null, stock: null, dirty: false });
  // The kitchen runs along the right-hand wall; the door is in the left-hand wall.
  add('stove', 2, 0);
  add('counter', 4, 0);
  add('table', 3, 4);
  add('table', 5, 3);
  add('pumpkin', 6, 0);
  add('web', 0, 0);
  s.staff.push(newStaff(s, { x: 3, y: 2 }, now));
  return s;
}

/** Restore a saved game. People in motion are not saved: guests are sent home and staff start fresh. */
export function hydrate(raw: unknown, now: number): GameState {
  const old = raw as { version?: number; items?: unknown; staff?: unknown } | null;
  if (!old || !Array.isArray(old.items) || !Array.isArray(old.staff)) return newGame(now);
  const version = old.version;
  if (version !== 1 && version !== 2) return newGame(now);
  const s = raw as GameState;
  if (version === 1) {
    // Version 1 had a 7 × 9 flat room with the door at the bottom. Give it the 9 × 9 room.
    s.version = 2;
    s.size = 9;
    s.cooked = s.served > 0 ? 1 : 0;
    s.recruited = 0;
    s.coffees = 0;
    s.goalIndex = 0;
    s.muted = false;
    s.staff.forEach((z) => {
      z.pace = 1;
      z.joinedAt = 0;
    });
  }
  const blockingDoor = s.items.find((i) => i.x === DOOR.x && i.y === DOOR.y);
  if (blockingDoor) {
    const spot = freeTiles(s).find((p) => layoutWorks(s, s.items.map((i) => (i === blockingDoor ? { ...i, ...p } : i))));
    if (spot) Object.assign(blockingDoor, spot);
    else s.items = s.items.filter((i) => i !== blockingDoor);
  }
  s.guests = [];
  s.fx = [];
  s.sfx = [];
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
  const spots = freeTiles(s);
  s.staff.forEach((z, i) => {
    const p = spots[(i * 3) % Math.max(1, spots.length)] ?? { x: 1, y: 1 };
    Object.assign(z, { task: null, carrying: null, goal: null, path: [], nextStepAt: now, busyUntil: 0, x: p.x, y: p.y });
  });
  const ready = s.items.filter((i) => i.kind === 'stove' && isReady(i, now)).length;
  if (ready > 0) toast(s, `Welcome back! ${ready} ${ready === 1 ? 'dish is' : 'dishes are'} ready on the stove.`, now);
  return s;
}

export function serialize(s: GameState): string {
  return JSON.stringify({ ...s, fx: [], guests: [], sfx: [], toast: null });
}

// ---------------------------------------------------------------- grid & paths

export const itemAt = (s: GameState, x: number, y: number): Item | undefined => s.items.find((i) => i.x === x && i.y === y);
export const itemById = (s: GameState, id: string): Item | undefined => s.items.find((i) => i.id === id);
export const isDoor = (x: number, y: number) => x === DOOR.x && y === DOOR.y;
const inside = (s: GameState, x: number, y: number) => x >= 0 && y >= 0 && x < s.size && y < s.size;
const DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function blockedGrid(s: GameState, items = s.items): boolean[] {
  const g = new Array<boolean>(s.size * s.size).fill(false);
  for (const it of items) g[it.y * s.size + it.x] = true;
  return g;
}

function freeTiles(s: GameState): Pt[] {
  const out: Pt[] = [];
  for (let y = 0; y < s.size; y++) for (let x = 0; x < s.size; x++) if (!itemAt(s, x, y) && !isDoor(x, y)) out.push({ x, y });
  return out;
}

/** Breadth-first search to the nearest goal tile. Returns the steps after `from`, or null. */
function bfs(s: GameState, blocked: boolean[], from: Pt, goals: Pt[]): Pt[] | null {
  if (goals.length === 0) return null;
  const W = s.size;
  const goalSet = new Set(goals.map((g) => g.y * W + g.x));
  const start = from.y * W + from.x;
  if (goalSet.has(start)) return [];
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (const d of DIRS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!inside(s, nx, ny)) continue;
      const n = ny * W + nx;
      if (blocked[n] || prev.has(n)) continue;
      prev.set(n, cur);
      if (goalSet.has(n)) {
        const path: Pt[] = [];
        for (let p = n; p !== start; p = prev.get(p)!) path.unshift({ x: p % W, y: Math.floor(p / W) });
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
  return DIRS.map((d) => ({ x: it.x + d.x, y: it.y + d.y })).filter((p) => inside(s, p.x, p.y) && !blocked[p.y * s.size + p.x]);
}

/** Point an entity at a goal. Returns false when the goal can't be reached. */
function setGoal(s: GameState, e: Staff | Guest, goal: Goal, blocked = blockedGrid(s)): boolean {
  const path = bfs(s, blocked, e, goalTiles(s, goal, blocked));
  if (!path) return false;
  e.goal = goal;
  e.path = path;
  return true;
}

/** True when every stove, counter and table can be reached from the door. */
function layoutWorks(s: GameState, items: Item[]): boolean {
  const W = s.size;
  const blocked = blockedGrid(s, items);
  const door = DOOR.y * W + DOOR.x;
  if (blocked[door]) return false;
  const seen = new Set<number>([door]);
  const queue = [door];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (const d of DIRS) {
      const nx = (cur % W) + d.x;
      const ny = Math.floor(cur / W) + d.y;
      const n = ny * W + nx;
      if (inside(s, nx, ny) && !blocked[n] && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return items
    .filter((it) => ITEMS[it.kind].group !== 'decor')
    .every((it) => DIRS.some((d) => inside(s, it.x + d.x, it.y + d.y) && seen.has((it.y + d.y) * W + it.x + d.x)));
}

/** After the layout changes, re-plan every walk; anything that can no longer get there gives up. */
function replan(s: GameState) {
  const blocked = blockedGrid(s);
  for (const z of s.staff) {
    if (z.goal && !setGoal(s, z, z.goal, blocked)) abortTask(s, z);
  }
  for (const g of s.guests) {
    if (g.goal && !setGoal(s, g, g.goal, blocked)) {
      g.goal = null;
      g.path = [];
    }
  }
}

// ---------------------------------------------------------------- derived values

export const spook = (s: GameState): number => s.items.reduce((n, it) => n + (ITEMS[it.kind].spook ?? 0), 0);
export const countOf = (s: GameState, kind: ItemKind): number => s.items.filter((i) => i.kind === kind).length;
export const isReady = (it: Item, now: number): boolean => !!it.cook && now >= it.cook.readyAt;
export const tipBonus = (s: GameState): number => Math.min(0.5, spook(s) * 0.02);
export const nextRoom = (s: GameState) => ROOMS.find((r) => r.size > s.size) ?? null;

function spawnInterval(s: GameState): number {
  const base = BASE_SPAWN_MS / (0.6 + s.rating * 0.25 + spook(s) * 0.01);
  // Word gets round when the kitchen is cold: fewer guests try their luck.
  const anyFood = s.items.some((i) => i.cook || i.stock);
  return anyFood ? base : base * 3;
}

export const stepMs = (z: Staff) => (z.energy <= 0 ? STAFF_TIRED_STEP_MS : STAFF_STEP_MS) / PACES[z.pace ?? 1].speed;

function fx(s: GameState, at: Pt, text: string, tone: Fx['tone'], now: number) {
  s.fx.push({ id: uid(s, 'f'), x: at.x, y: at.y, text, tone, at: now });
}

function toast(s: GameState, text: string, now: number) {
  s.toast = { text, at: now };
}

function sound(s: GameState, sfx: Sfx) {
  if (!s.sfx.includes(sfx)) s.sfx.push(sfx);
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

// ---------------------------------------------------------------- goals

export function goalProgress(s: GameState, g: GoalDef): number {
  switch (g.check) {
    case 'cooked':
      return s.cooked;
    case 'served':
      return s.served;
    case 'tables':
      return countOf(s, 'table');
    case 'stoves':
      return countOf(s, 'stove');
    case 'decor':
      return s.items.filter((i) => ITEMS[i.kind].group === 'decor').length;
    case 'recruited':
      return s.recruited;
    case 'hired':
      return s.staff.length;
    case 'level':
      return s.level;
    case 'room':
      return s.size;
    case 'coffee':
      return s.coffees;
  }
}

export const currentGoal = (s: GameState): GoalDef | null => GOALS[s.goalIndex] ?? null;

export function claimGoal(s: GameState, now: number): Result {
  const g = currentGoal(s);
  if (!g || goalProgress(s, g) < g.target) return { ok: false };
  s.coins += g.reward;
  s.goalIndex += 1;
  sound(s, 'goal');
  toast(s, `Goal done: +${g.reward} coins`, now);
  return { ok: true };
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
  const nearest = (to: Pt) => idle().sort((a, b) => dist(a, to) / PACES[a.pace].speed - dist(b, to) / PACES[b.pace].speed)[0];
  const blocked = blockedGrid(s);

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
      const spot = { x: Math.floor(Math.random() * s.size), y: Math.floor(Math.random() * s.size) };
      if (!blocked[spot.y * s.size + spot.x]) give(z, { type: 'wander' }, spot);
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
  const blocked = blockedGrid(s);
  const tables = s.items.filter((t) => t.kind === 'table' && !t.dirty && !taken.has(t.id));
  tables.sort(() => Math.random() - 0.5);
  return tables.find((t) => bfs(s, blocked, DOOR, goalTiles(s, { itemId: t.id }, blocked)) !== null);
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
    ponderUntil: 0,
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

function dirtyTable(s: GameState, g: Guest) {
  const table = itemById(s, g.tableId);
  if (table) table.dirty = true;
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
    sound(s, 'angry');
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
    sound(s, 'coin');
    const room = s.staff.length < maxStaff(s.level);
    if (room && Math.random() < RECRUIT_CHANCE + spook(s) * 0.004) {
      g.state = 'pondering';
      g.ponderUntil = now + PONDER_MS;
    } else {
      dirtyTable(s, g);
      leave(s, g, 'happy');
    }
    return;
  }
  if (g.state === 'pondering' && now >= g.ponderUntil) {
    dirtyTable(s, g);
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
  const prev = s.lastTick;
  s.lastTick = now;

  for (const st of s.items) if (st.cook && st.cook.readyAt > prev && st.cook.readyAt <= now) sound(s, 'ding');

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
    s.coins += 50 * s.level;
    s.levelUp = s.level;
    sound(s, 'level');
  }

  s.fx = s.fx.filter((f) => now - f.at < 1_400);
  if (s.toast && now - s.toast.at > 2_800) s.toast = null;
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
  s.cooked += 1;
  st.cook = { dish, startedAt: now, readyAt: now + d.cookMs, servings: d.servings };
  sound(s, 'cook');
  return { ok: true };
}

/** Tapping a finished stove carries its food straight to a counter, for impatient owners. */
export function quickServe(s: GameState, stoveId: string, now: number): Result {
  const st = itemById(s, stoveId);
  if (!st || !isReady(st, now)) return { ok: false };
  const dish = st.cook!.dish;
  const counter = counterFor(s, dish);
  if (!counter) return { ok: false, msg: 'Every counter is full or holds another dish.' };
  const hauler = s.staff.find((z) => z.task?.type === 'haul' && z.task.stoveId === stoveId && z.task.phase === 'toStove');
  if (hauler) abortTask(s, hauler);
  const amount = Math.min(st.cook!.servings, COUNTER_CAPACITY - (counter.stock ? counter.stock.servings + counter.stock.incoming : 0));
  counter.stock ??= { dish, servings: 0, reserved: 0, incoming: 0 };
  counter.stock.servings += amount;
  st.cook!.servings -= amount;
  if (st.cook!.servings <= 0) st.cook = null;
  fx(s, counter, `+${amount} ${dishById(dish).emoji}`, 'good', now);
  sound(s, 'place');
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
  if (!inside(s, x, y) || isDoor(x, y)) return false;
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
  if (!layoutWorks(s, [...s.items, item])) return { ok: false, msg: 'That would block the way in.' };
  s.items.push(item);
  s.coins -= def.cost;
  fx(s, item, `-${def.cost}`, 'bad', now);
  sound(s, 'place');
  replan(s);
  return { ok: true };
}

export function move(s: GameState, itemId: string, x: number, y: number): Result {
  const it = itemById(s, itemId);
  if (!it) return { ok: false };
  if (!canPlace(s, x, y, itemId)) return { ok: false, msg: 'Something is already there.' };
  const moved = s.items.map((i) => (i.id === itemId ? { ...i, x, y } : i));
  if (!layoutWorks(s, moved)) return { ok: false, msg: 'That would block the way in.' };
  it.x = x;
  it.y = y;
  sound(s, 'place');
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
  if (it.dirty || s.guests.some((g) => g.tableId === it.id)) return { ok: false, msg: 'Someone is using this table.' };
  if (s.staff.some((z) => z.goal && typeof z.goal === 'object' && 'itemId' in z.goal && z.goal.itemId === it.id))
    return { ok: false, msg: 'A zombie is on its way there.' };
  s.items = s.items.filter((i) => i !== it);
  const back = sellValue(it.kind);
  s.coins += back;
  fx(s, it, `+${back}`, 'coin', now);
  sound(s, 'sell');
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
  sound(s, 'recruit');
  return { ok: true };
}

/** A guest who is thinking it over joins the night shift. */
export function recruit(s: GameState, guestId: string, now: number): Result {
  const g = s.guests.find((x) => x.id === guestId);
  if (!g || g.state !== 'pondering') return { ok: false };
  if (s.staff.length >= maxStaff(s.level)) return { ok: false, msg: 'Level up to make room for more zombies.' };
  s.guests = s.guests.filter((x) => x !== g);
  dirtyTable(s, g);
  const z = newStaff(s, g, now);
  s.staff.push(z);
  s.recruited += 1;
  fx(s, g, `${z.name} joined!`, 'good', now);
  sound(s, 'recruit');
  toast(s, `${z.name} joined the night shift (${PACES[z.pace].name.toLowerCase()} walker).`, now);
  return { ok: true };
}

export function espresso(s: GameState, staffId: string | 'all'): Result {
  const who = s.staff.filter((z) => (staffId === 'all' || z.id === staffId) && z.energy < 99);
  if (who.length === 0) return { ok: false, msg: 'Everyone is wide awake.' };
  const cost = who.length * ESPRESSO_COST;
  if (s.coins < cost) return { ok: false, msg: `That needs ${cost} coins.` };
  s.coins -= cost;
  s.coffees += who.length;
  for (const z of who) z.energy = 100;
  sound(s, 'coffee');
  return { ok: true };
}

/** Knock through the walls: the room grows by two tiles each way. Nothing moves. */
export function expand(s: GameState, now: number): Result {
  const next = nextRoom(s);
  if (!next) return { ok: false, msg: 'The diner is as big as it gets.' };
  if (next.level > s.level) return { ok: false, msg: `Reach level ${next.level} to expand.` };
  if (s.coins < next.cost) return { ok: false, msg: `Expanding costs ${next.cost} coins.` };
  s.coins -= next.cost;
  s.size = next.size;
  sound(s, 'level');
  toast(s, `The diner is now ${next.size} × ${next.size}!`, now);
  replan(s);
  return { ok: true };
}

export function note(s: GameState, text: string, now: number) {
  toast(s, text, now);
}

export { DISHES, ESPRESSO_COST };
