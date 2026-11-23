// Plays Night Bite Diner headlessly for two in-game hours with a simple bot,
// checking the bookkeeping after every tick. Run: npm run sim
import { buy, canPlace, cook, espresso, hire, hydrate, move, newGame, sell, serialize, tick } from '../src/game/engine.ts';
import type { GameState } from '../src/game/engine.ts';
import { DISHES, GRID_H, GRID_W, ITEMS, maxOf } from '../src/game/data.ts';
import type { ItemKind } from '../src/game/data.ts';

function check(s: GameState, t: number) {
  const fail = (m: string) => {
    throw new Error(`t=${Math.round(t / 1000)}s: ${m}`);
  };
  if (s.coins < 0) fail(`coins went negative: ${s.coins}`);
  for (const it of s.items) {
    if (it.stock) {
      const { servings, reserved, incoming } = it.stock;
      if (servings < 0 || reserved < 0 || incoming < 0) fail(`counter ${it.id} has ${JSON.stringify(it.stock)}`);
      if (reserved > servings) fail(`counter ${it.id} promised more than it holds: ${JSON.stringify(it.stock)}`);
    }
    if (it.cook && it.cook.servings <= 0) fail(`stove ${it.id} holds an empty dish`);
  }
  const tiles = new Set(s.items.map((i) => `${i.x},${i.y}`));
  if (tiles.size !== s.items.length) fail('two items share a tile');
  for (const g of s.guests) if (!s.items.some((i) => i.id === g.tableId)) fail(`guest ${g.id} sits at a missing table`);
}

/** Free tiles, best first: the bot leaves row 1 clear so the kitchen stays reachable. */
function freeTiles(s: GameState): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = GRID_H - 2; y >= 0; y--)
    for (let x = 0; x < GRID_W; x++) if (y !== 1 && canPlace(s, x, y)) out.push({ x, y });
  return out;
}
const placeAnywhere = (s: GameState, kind: ItemKind, t: number) => {
  for (const p of freeTiles(s)) if (buy(s, kind, p.x, p.y, t).ok) return true;
  return false;
};

let t = 1_000_000;
let s = newGame(t);
const END = t + 2 * 60 * 60_000;
let rejected = 0;
let angry = 0;
let waitWithFood = 0;

while (t < END) {
  t += 100;
  const before = s.rating;
  tick(s, t);
  check(s, t);
  if (s.rating < before - 0.1) {
    angry++;
    if (s.items.some((i) => i.stock && i.stock.servings > 0)) waitWithFood++;
  }

  if (t % 2_000 === 0) {
    // Cook the best dish the bot can afford on every idle stove.
    for (const st of s.items.filter((i) => i.kind === 'stove' && !i.cook)) {
      const dish = [...DISHES].reverse().find((d) => d.level <= s.level && d.cost <= s.coins * 0.4 && d.cookMs <= 90_000);
      if (dish) cook(s, st.id, dish.id, t);
    }
    for (const kind of ['table', 'stove', 'counter', 'candles'] as ItemKind[]) {
      if (s.coins > ITEMS[kind].cost * 2 && s.items.filter((i) => i.kind === kind).length < maxOf(kind, s.level)) {
        if (!placeAnywhere(s, kind, t)) rejected++;
      }
    }
    if (s.coins > 400) hire(s, t);
    if (s.staff.some((z) => z.energy < 20)) espresso(s, 'all');
  }

  // Rearrange the room mid-shift, to exercise re-planning.
  if (t % 97_000 === 0) {
    const table = s.items.find((i) => i.kind === 'table');
    const spot = freeTiles(s).at(-1);
    if (table && spot) move(s, table.id, spot.x, spot.y);
    const decor = s.items.find((i) => ITEMS[i.kind].group === 'decor');
    if (decor && t % 3 === 0) sell(s, decor.id, t);
  }

  // Save and load once, the way the app does on relaunch.
  if (t === 1_000_000 + 30 * 60_000) s = hydrate(JSON.parse(serialize(s)), t);
}

const summary = {
  level: s.level,
  coins: s.coins,
  served: s.served,
  rating: Number(s.rating.toFixed(2)),
  staff: s.staff.length,
  items: Object.fromEntries(Object.keys(ITEMS).map((k) => [k, s.items.filter((i) => i.kind === k).length])),
  rejectedPlacements: rejected,
  angryGuests: angry,
  angryWhileFoodWasOut: waitWithFood,
};
console.log(JSON.stringify(summary, null, 2));
if (s.served < 50) throw new Error('Too few guests were served: the loop is broken.');
console.log('Simulation OK');
