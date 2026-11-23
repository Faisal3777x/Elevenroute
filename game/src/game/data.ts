// Night Bite Diner: all tunable game data lives here.

/** The room starts small and grows by two tiles each way per expansion. */
export const ROOMS = [
  { size: 7, cost: 0, level: 1 },
  { size: 9, cost: 600, level: 3 },
  { size: 11, cost: 2_500, level: 6 },
  { size: 13, cost: 8_000, level: 10 },
];
/** Guests come in through a door in the left wall. Nothing can be built on its tile. */
export const DOOR = { x: 0, y: 3 };

export const START_COINS = 150;
export const COUNTER_CAPACITY = 40;
export const ESPRESSO_COST = 10;
export const MAX_STAFF = 8;

export const STAFF_STEP_MS = 330;
export const STAFF_TIRED_STEP_MS = 850;
export const GUEST_STEP_MS = 420;
/** A zombie goes from wide awake to asleep on their feet in 8 minutes. */
export const ENERGY_DRAIN_PER_MS = 100 / (8 * 60_000);
export const EAT_MS = 5_000;
export const CLEAN_MS = 1_200;
export const BASE_PATIENCE_MS = 35_000;
export const BASE_SPAWN_MS = 9_000;
/** How long a well-fed guest thinks about joining the night shift. */
export const PONDER_MS = 7_000;
/** Chance a happy guest considers joining, before decor. */
export const RECRUIT_CHANCE = 0.22;

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
  if (kind === 'stove') return Math.min(8, 1 + Math.floor(level / 2));
  if (kind === 'counter') return Math.min(5, 1 + Math.floor(level / 3));
  if (kind === 'table') return Math.min(16, 2 + level);
  return Infinity;
}

export const maxStaff = (level: number): number => Math.min(MAX_STAFF, 1 + Math.floor((level + 1) / 2));
export const hireCost = (staffCount: number): number => 120 * staffCount;
export const xpForLevel = (level: number): number => Math.round(80 * Math.pow(level, 2));
export const sellValue = (kind: ItemKind): number => Math.floor(ITEMS[kind].cost / 2);

/** Zombies walk at different speeds: a multiplier on their pace. */
export const PACES = [
  { name: 'Slow', speed: 0.8 },
  { name: 'Steady', speed: 1 },
  { name: 'Quick', speed: 1.25 },
];

export const STAFF_LOOKS = ['🧟', '🧟‍♀️', '🧟‍♂️'];
export const STAFF_NAMES = ['Gus', 'Mabel', 'Rotney', 'Ghoulia', 'Lurch', 'Petunia', 'Moe', 'Brainard', 'Dot', 'Clyde', 'Wanda', 'Boris', 'Edna', 'Igor'];
export const GUEST_LOOKS = ['🧑', '👩', '👨', '🧔', '👵', '👴', '🧑‍🦰', '👩‍🦱', '🧑‍🦳', '👱'];

/** Goals shown one at a time under the status bar. Each pays a coin reward once. */
export type GoalCheck = 'cooked' | 'served' | 'tables' | 'decor' | 'recruited' | 'hired' | 'level' | 'room' | 'stoves' | 'coffee';
export interface Goal {
  id: string;
  text: string;
  check: GoalCheck;
  target: number;
  reward: number;
}
export const GOALS: Goal[] = [
  { id: 'cook1', text: 'Cook something on the stove', check: 'cooked', target: 1, reward: 20 },
  { id: 'serve5', text: 'Serve 5 guests', check: 'served', target: 5, reward: 30 },
  { id: 'table3', text: 'Own 3 tables', check: 'tables', target: 3, reward: 40 },
  { id: 'decor2', text: 'Place 2 spooky decorations', check: 'decor', target: 2, reward: 40 },
  { id: 'coffee', text: 'Give a zombie an espresso', check: 'coffee', target: 1, reward: 25 },
  { id: 'recruit1', text: 'Recruit a guest to the night shift', check: 'recruited', target: 1, reward: 80 },
  { id: 'serve50', text: 'Serve 50 guests', check: 'served', target: 50, reward: 150 },
  { id: 'level3', text: 'Reach level 3', check: 'level', target: 3, reward: 100 },
  { id: 'room9', text: 'Expand the diner', check: 'room', target: 9, reward: 200 },
  { id: 'stoves3', text: 'Own 3 stoves', check: 'stoves', target: 3, reward: 200 },
  { id: 'staff4', text: 'Have 4 zombies on staff', check: 'hired', target: 4, reward: 250 },
  { id: 'serve250', text: 'Serve 250 guests', check: 'served', target: 250, reward: 500 },
  { id: 'level8', text: 'Reach level 8', check: 'level', target: 8, reward: 600 },
  { id: 'room13', text: 'Grow the diner to full size', check: 'room', target: 13, reward: 1_500 },
];
