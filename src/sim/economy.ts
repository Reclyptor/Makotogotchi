// The item catalog (SPEC §13) — pure data, imported by reduce/validate so
// item effects are part of the deterministic fold, and by the server for
// pricing and ownership. Cosmetics and room decor are deliberately absent:
// they never touch the simulation (visual only, stored server-side).

export type FoodItem = {
  kind: "food";
  label: string;
  price: number;
  /** Multiplies FEED's base magnitude (percent). */
  scalePercent: number;
  /** Flat joy on top — bounded by purchase price, so budget-exempt. */
  joyBonus: number;
};

export type MedicineItem = {
  kind: "medicine";
  label: string;
  price: number;
  /** Cures instantly: global and per-caretaker cooldowns are bypassed. */
  bypassCooldowns: true;
};

export type ToyItem = {
  kind: "toy";
  label: string;
  price: number;
  /** Permanent for the generation: raises PLAY's base magnitude (percent). */
  playBonusPercent: number;
};

export const FOOD_ITEMS = {
  pepper_treat: { kind: "food", label: "Pepper Treat", price: 60, scalePercent: 120, joyBonus: 15_000 },
  fish_feast: { kind: "food", label: "Fish Feast", price: 150, scalePercent: 145, joyBonus: 35_000 },
} as const satisfies Record<string, FoodItem>;

export const MEDICINE_ITEMS = {
  super_medicine: { kind: "medicine", label: "Super Medicine", price: 250, bypassCooldowns: true },
} as const satisfies Record<string, MedicineItem>;

export const TOY_ITEMS = {
  teeter: { kind: "toy", label: "Teeter Toy", price: 400, playBonusPercent: 15 },
  wheel: { kind: "toy", label: "Running Wheel", price: 900, playBonusPercent: 30 },
} as const satisfies Record<string, ToyItem>;

export type FoodItemId = keyof typeof FOOD_ITEMS;
export type MedicineItemId = keyof typeof MEDICINE_ITEMS;
export type ToyItemId = keyof typeof TOY_ITEMS;
export type SimItemId = FoodItemId | MedicineItemId | ToyItemId;

/** Declaration order is the canonical order every quirk draw indexes into. */
export const FOOD_ITEM_IDS = Object.keys(FOOD_ITEMS) as readonly FoodItemId[];

export const foodItem = (itemId: string | undefined): FoodItem | null =>
  itemId !== undefined && itemId in FOOD_ITEMS ? FOOD_ITEMS[itemId as FoodItemId] : null;

export const medicineItem = (itemId: string | undefined): MedicineItem | null =>
  itemId !== undefined && itemId in MEDICINE_ITEMS ? MEDICINE_ITEMS[itemId as MedicineItemId] : null;

export const toyItem = (itemId: string | undefined): ToyItem | null =>
  itemId !== undefined && itemId in TOY_ITEMS ? TOY_ITEMS[itemId as ToyItemId] : null;

/** Total PLAY bonus (percent) from the generation's installed toys. */
export const toysPlayBonusPercent = (toys: readonly string[]): number =>
  toys.reduce((total, id) => total + (toyItem(id)?.playBonusPercent ?? 0), 0);

// Minigame performance bounds (SPEC §13.3): a finished game scales PLAY's
// magnitude between these percentages of base.
export const PERFORMANCE_MIN = 50;
export const PERFORMANCE_MAX = 150;

// Generational taste (SPEC §21.4). A generation's favourite meal lands harder
// and its least favourite lands softer — applied to FEED's base magnitude, so
// diminishing returns still govern the result. The favourite minigame pays
// out better for the same score; joy is joy, but enthusiasm is worth coins.
export const QUIRK_FAVORITE_PERCENT = 125;
export const QUIRK_DISLIKED_PERCENT = 75;
export const QUIRK_FAVORITE_GAME_COIN_PERCENT = 125;
