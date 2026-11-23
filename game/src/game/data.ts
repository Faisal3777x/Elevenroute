// Night Bite Diner: all tunable game data lives here.

export const GRID_W = 7;
export const GRID_H = 9;
/** Guests come in and leave through this tile. Nothing can be built on it. */
export const DOOR = { x: 3, y: GRID_H - 1 };

export const START_COINS = 150;
export const COUNTER_CAPACITY = 40;
export const ESPRESSO_COST = 10;
export const MAX_STAFF = 6;

export const STAFF_STEP_MS = 330;
export const STAFF_TIRED_STEP_MS = 850;
export const GUEST_STEP_MS = 420;
/** A zombie goes from wide awake to asleep on their feet in 8 minutes. */
export const ENERGY_DRAIN_PER_MS = 100 / (8 * 60_000);
export const EAT_MS = 5_000;
export const CLEAN_MS = 1_200;
export const BASE_PATIENCE_MS = 35_000;
export const BASE_SPAWN_MS = 9_000;

export type DishId = 'fries' | 'burger' | 'noodles' | 'pizza' | 'tacos' | 'pie' | 'cake';

export interface Dish {
  id: DishId;
  name: string;
  emoji: string;
  cookMs: number;
  servings: number;
  cost: number;
  price: number;
  level: number;
}

export const DISHES: Dish[] = [
  { id: 'fries', name: 'Grave Fries', emoji: '🍟', cookMs: 15_000, servings: 5, cost: 5, price: 4, level: 1 },
  { id: 'burger', name: 'Midnight Burger', emoji: '🍔', cookMs: 40_000, servings: 6, cost: 15, price: 7, level: 1 },
  { id: 'noodles', name: 'Fog Noodles', emoji: '🍜', cookMs: 90_000, servings: 8, cost: 30, price: 10, level: 2 },
  { id: 'pizza', name: 'Full Moon Pizza', emoji: '🍕', cookMs: 3 * 60_000, servings: 10, cost: 60, price: 14, level: 3 },
  { id: 'tacos', name: 'Batwing Tacos', emoji: '🌮', cookMs: 6 * 60_000, servings: 14, cost: 110, price: 18, level: 4 },
  { id: 'pie', name: 'Pumpkin Patch Pie', emoji: '🥧', cookMs: 15 * 60_000, servings: 18, cost: 200, price: 24, level: 5 },
  { id: 'cake', name: 'Witching Hour Cake', emoji: '🎂', cookMs: 40 * 60_000, servings: 26, cost: 380, price: 32, level: 7 },
];

export const dishById = (id: DishId): Dish => DISHES.find((d) => d.id === id)!;

export type ItemKind =
  | 'stove'
  | 'counter'
  | 'table'
  | 'web'
  | 'pumpkin'
  | 'candles'
  | 'tombstone'
  | 'crystal'
  | 'skull';

export type ItemGroup = 'kitchen' | 'dining' | 'decor';

export interface ItemDef {
  kind: ItemKind;
  name: string;
  emoji: string;
  group: ItemGroup;
  cost: number;
  level: number;
  /** Decor only: each point makes guests a little more patient and generous. */
  spook?: number;
  blurb: string;
}

export const ITEMS: Record<ItemKind, ItemDef> = {
  stove: { kind: 'stove', name: 'Stove', emoji: '🍳', group: 'kitchen', cost: 200, level: 1, blurb: 'Cook one dish at a time.' },
  counter: { kind: 'counter', name: 'Serving Counter', emoji: '🍽️', group: 'kitchen', cost: 150, level: 1, blurb: `Holds up to ${COUNTER_CAPACITY} servings of one dish.` },
  table: { kind: 'table', name: 'Table', emoji: '🪑', group: 'dining', cost: 60, level: 1, blurb: 'Seats one hungry guest.' },
  web: { kind: 'web', name: 'Cobweb', emoji: '🕸️', group: 'decor', cost: 25, level: 1, spook: 1, blurb: 'Dusty, in a charming way.' },
  pumpkin: { kind: 'pumpkin', name: 'Jack-o’-lantern', emoji: '🎃', group: 'decor', cost: 40, level: 1, spook: 2, blurb: 'A grin that lights the room.' },
  candles: { kind: 'candles', name: 'Candles', emoji: '🕯️', group: 'decor', cost: 70, level: 2, spook: 3, blurb: 'Mood lighting for the undead.' },
  tombstone: { kind: 'tombstone', name: 'Tombstone', emoji: '🪦', group: 'decor', cost: 110, level: 3, spook: 4, blurb: 'Here lies the last health inspector.' },
  crystal: { kind: 'crystal', name: 'Crystal Ball', emoji: '🔮', group: 'decor', cost: 160, level: 4, spook: 6, blurb: 'Predicts you will order dessert.' },
  skull: { kind: 'skull', name: 'Skull Fountain', emoji: '💀', group: 'decor', cost: 240, level: 6, spook: 8, blurb: 'Gurgles softly all night.' },
};

/** How many of each functional item a level allows. Decor is unlimited. */
export function maxOf(kind: ItemKind, level: number): number {
  if (kind === 'stove') return Math.min(6, 1 + Math.floor(level / 2));
  if (kind === 'counter') return Math.min(4, 1 + Math.floor(level / 3));
  if (kind === 'table') return Math.min(12, 2 + level);
  return Infinity;
}

export const maxStaff = (level: number): number => Math.min(MAX_STAFF, 1 + Math.floor((level + 1) / 2));
export const hireCost = (staffCount: number): number => 120 * staffCount;
export const xpForLevel = (level: number): number => Math.round(80 * Math.pow(level, 2));
export const sellValue = (kind: ItemKind): number => Math.floor(ITEMS[kind].cost / 2);

export const STAFF_LOOKS = ['🧟', '🧟‍♀️', '🧟‍♂️'];
export const STAFF_NAMES = ['Gus', 'Mabel', 'Rotney', 'Ghoulia', 'Lurch', 'Petunia', 'Moe', 'Brainard', 'Dot', 'Clyde'];
export const GUEST_LOOKS = ['🧑', '👩', '👨', '🧔', '👵', '👴', '🧑‍🦰', '👩‍🦱', '🧑‍🦳', '👱'];
