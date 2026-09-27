// What a consumable is to a player: its glyph and what it does, in one line
// (SPEC §13.2). One source for the shop's rows, the pack, and the feed
// chooser, so an item can never be pictured or described two ways.

import { drinkItem, foodItem, type DrinkItem, type FoodItem, type Perks } from "@/sim/economy";
import { HEALTH_MAX, NEED_MAX } from "@/sim/tuning";

/**
 * One glyph per item, so a long list is scannable without reading it.
 *
 * Two rules, both learned the hard way. **Name the actual object**: the
 * Running Wheel wore 🎡, a Ferris wheel, which is a fairground ride and not
 * the thing in the cage. And **no two rows should look alike**: Fish Feast
 * wore 🐟 while the Aquarium wore 🐠, so the shop offered a fish to eat and a
 * fish to keep with all but the same picture, a tab apart.
 *
 * tabs.test.ts holds only the mechanical half of the second rule — two items
 * with the *identical* glyph. It could not have caught the fish, because 🐟
 * and 🐠 are different characters that happen to look the same at 18px, and
 * it cannot catch a Ferris wheel standing in for a hamster wheel at all.
 * Those need eyes on the rendered tab.
 */
export const ITEM_ICONS: Record<string, string> = {
  onigiri: "🍙",
  fish_feast: "🍣",
  sausage: "🌭",
  pizza: "🍕",
  candy: "🍬",
  super_medicine: "💊",
  energy_drink: "🥫",
  soda: "🥤",
  teeter: "🛝",
  wheel: "🛞",
  bow: "🎀",
  cap: "🧢",
  crown: "👑",
  plant: "🪴",
  picture: "🖼️",
  lamp: "💡",
  window_seat: "🪟",
  aquarium: "🐠",
  kotatsu: "♨️",
  theme_cabin: "🪵",
  theme_seaside: "🌊",
  beach: "🏖️",
  forest: "🌲",
  blossom: "🌸",
  pond: "🎏",
  shrine: "⛩️",
  mountain: "🗻",
  garden: "🌻",
  meadow: "🦋",
};

/**
 * What a row shows when its item has no glyph of its own, so a catalog
 * addition degrades to its category rather than to nothing.
 *
 * Where the game already has a symbol for the idea, these borrow it rather
 * than inventing one: 🍖 is the FEED action's and the Hunger meter's, 💊 is
 * MEDICATE's, 🎮 is PLAY's, 🧭 is the one the status line uses for an away
 * day. The rest are generics chosen not to collide with any real item —
 * cosmetics used to fall back to 🎀 and decor to 🪴, which are the Ribbon
 * Bow's and the Potted Plant's, so a new item would have quietly
 * impersonated an existing one in the same list.
 */
export const CATEGORY_ICONS = {
  food: "🍖",
  medicine: "💊",
  drink: "🧃",
  toy: "🎮",
  cosmetic: "🎩",
  decor: "🛋️",
  grand: "🪑",
  theme: "🎨",
  venue: "🧭",
} as const;


const signed = (value: number, unit: number): string => {
  const percent = (Math.abs(value) * 100) / unit;
  const digits = Number.isInteger(percent) ? 0 : 1;
  return `${value < 0 ? "−" : "+"}${percent.toFixed(digits)}%`;
};

/** Each perk as "+2% joy" / "−3% hygiene", in a fixed order, costs included. */
export const perkText = (perks: Perks): string[] => [
  ...(perks.joy ? [`${signed(perks.joy, NEED_MAX)} joy`] : []),
  ...(perks.hygiene ? [`${signed(perks.hygiene, NEED_MAX)} hygiene`] : []),
  ...(perks.health ? [`${signed(perks.health, HEALTH_MAX)} health`] : []),
];

export const foodDetail = (item: FoodItem): string =>
  [`Feeds ×${(item.scalePercent / 100).toFixed(2)}`, ...perkText(item.perks)].join(" · ");

export const drinkDetail = (item: DrinkItem): string =>
  [`+${item.energyBonus / 10_000}% energy`, ...perkText(item.perks), "wakes Makoto from a daytime sleep"].join(" · ");

/** What a row can be short by, said the same way on every surface that sells. */
export const needsMoreCoins = (shortfall: number): string => `Needs ${shortfall} more 🪙`;

/** A food or a drink as the Feed menu offers it: glyph, line, and what it costs to own. */
export type FeedEntry = { itemId: string; label: string; icon: string; detail: string; price: number };

export const feedEntry = (itemId: string): FeedEntry | null => {
  const food = foodItem(itemId);
  if (food) return { itemId, label: food.label, icon: ITEM_ICONS[itemId] ?? CATEGORY_ICONS.food, detail: foodDetail(food), price: food.price };
  const drink = drinkItem(itemId);
  if (drink) return { itemId, label: drink.label, icon: ITEM_ICONS[itemId] ?? CATEGORY_ICONS.drink, detail: drinkDetail(drink), price: drink.price };
  return null;
};
