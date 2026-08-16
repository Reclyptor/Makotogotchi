import { describe, expect, it } from "vitest";
import { quirkFoodPercent, quirks } from "./quirks";
import { FOOD_ITEM_IDS, FOOD_ITEMS, QUIRK_DISLIKED_PERCENT, QUIRK_FAVORITE_PERCENT } from "./economy";
import { MINIGAME_IDS } from "./minigames";

const SEEDS = Array.from({ length: 400 }, (_, index) => index * 7919 + 13);

describe("generational quirks (SPEC §21.4)", () => {
  it("is a pure function of the seed", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      expect(quirks(seed)).toEqual(quirks(seed));
    }
  });

  it("never likes and dislikes the same food, and only picks real items", () => {
    for (const seed of SEEDS) {
      const taste = quirks(seed);
      expect(taste.favoriteFood).not.toBe(taste.dislikedFood);
      expect(FOOD_ITEM_IDS).toContain(taste.favoriteFood);
      expect(FOOD_ITEM_IDS).toContain(taste.dislikedFood);
      expect(MINIGAME_IDS).toContain(taste.favoriteGame);
    }
  });

  it("spreads across the whole catalog rather than favouring one entry", () => {
    const foods = new Set(SEEDS.map((seed) => quirks(seed).favoriteFood));
    const games = new Set(SEEDS.map((seed) => quirks(seed).favoriteGame));
    expect(foods.size).toBe(FOOD_ITEM_IDS.length);
    expect(games.size).toBe(MINIGAME_IDS.length);
  });

  it("indexes the food catalog completely", () => {
    expect([...FOOD_ITEM_IDS].sort()).toEqual(Object.keys(FOOD_ITEMS).sort());
  });

  it("scales the favourite up, the dislike down, and everything else not at all", () => {
    const seed = SEEDS[0]!;
    const taste = quirks(seed);
    expect(quirkFoodPercent(seed, taste.favoriteFood)).toBe(QUIRK_FAVORITE_PERCENT);
    expect(quirkFoodPercent(seed, taste.dislikedFood)).toBe(QUIRK_DISLIKED_PERCENT);
    expect(quirkFoodPercent(seed, "super_medicine")).toBe(100);
    expect(quirkFoodPercent(seed, undefined)).toBe(100);
  });
});
