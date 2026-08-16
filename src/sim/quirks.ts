// Generational personality (SPEC §21.4). Every generation likes one food,
// dislikes another, and is best at one minigame — decided by its seed alone,
// never stored, never voted on. Caretakers find out by feeding it things.
//
// The draws are keyed at tick 0 because a personality is a property of the
// generation, not of a moment in its life: the same seed yields the same
// quirks on every client, on every replay, forever.

import { draw32, RNG_PURPOSE, type RngPurpose } from "./rng";
import { FOOD_ITEM_IDS, QUIRK_DISLIKED_PERCENT, QUIRK_FAVORITE_PERCENT, type FoodItemId } from "./economy";
import { MINIGAME_IDS, type MinigameId } from "./minigames";

export type Quirks = {
  favoriteFood: FoodItemId;
  dislikedFood: FoodItemId;
  favoriteGame: MinigameId;
};

/** Index into a non-empty catalog; the modulo keeps it in range. */
const pick = <T>(options: readonly T[], seed: number, purpose: RngPurpose): T =>
  options[draw32(seed, 0, purpose) % options.length]!;

export const quirks = (seed: number): Quirks => {
  const favoriteFood = pick(FOOD_ITEM_IDS, seed, RNG_PURPOSE.quirkFavoriteFood);
  // The dislike is drawn from what is left, so the two can never collide.
  // A one-food catalog leaves nothing to dislike, and the pet is easy to feed.
  const rest = FOOD_ITEM_IDS.filter((itemId) => itemId !== favoriteFood);
  return {
    favoriteFood,
    dislikedFood: rest.length > 0 ? pick(rest, seed, RNG_PURPOSE.quirkDislikedFood) : favoriteFood,
    favoriteGame: pick(MINIGAME_IDS, seed, RNG_PURPOSE.quirkFavoriteGame),
  };
};

/** How much a generation's taste scales a meal, as an integer percentage. */
export const quirkFoodPercent = (seed: number, itemId: string | undefined): number => {
  if (itemId === undefined) return 100;
  const taste = quirks(seed);
  if (itemId === taste.favoriteFood) return QUIRK_FAVORITE_PERCENT;
  if (itemId === taste.dislikedFood) return QUIRK_DISLIKED_PERCENT;
  return 100;
};
