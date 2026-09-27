import { describe, expect, it } from "vitest";
import { quirkFoodPercent, quirks } from "./quirks";
import {
  DRINK_ITEMS,
  FOOD_ITEM_IDS,
  FOOD_ITEMS,
  foodCatalogOf,
  LEGACY_FOOD_CATALOG_SIZE,
  QUIRK_DISLIKED_PERCENT,
  QUIRK_FAVORITE_PERCENT,
} from "./economy";
import { MINIGAME_IDS } from "./minigames";

const SEEDS = Array.from({ length: 400 }, (_, index) => index * 7919 + 13);

describe("generational quirks (SPEC §21.4)", () => {
  it("is a pure function of the seed", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      expect(quirks({ seed })).toEqual(quirks({ seed }));
    }
  });

  it("never likes and dislikes the same food, and only picks real items", () => {
    for (const seed of SEEDS) {
      const taste = quirks({ seed });
      expect(taste.favoriteFood).not.toBe(taste.dislikedFood);
      expect(FOOD_ITEM_IDS).toContain(taste.favoriteFood);
      expect(FOOD_ITEM_IDS).toContain(taste.dislikedFood);
      expect(MINIGAME_IDS).toContain(taste.favoriteGame);
    }
  });

  it("spreads across the whole catalog rather than favouring one entry", () => {
    const foods = new Set(SEEDS.map((seed) => quirks({ seed, foodCatalogSize: FOOD_ITEM_IDS.length }).favoriteFood));
    const games = new Set(SEEDS.map((seed) => quirks({ seed }).favoriteGame));
    expect(foods.size).toBe(FOOD_ITEM_IDS.length);
    expect(games.size).toBe(MINIGAME_IDS.length);
  });

  it("indexes the food catalog completely", () => {
    expect([...FOOD_ITEM_IDS].sort()).toEqual(Object.keys(FOOD_ITEMS).sort());
  });

  it("scales the favourite up, the dislike down, and everything else not at all", () => {
    const generation = { seed: SEEDS[0]! };
    const taste = quirks(generation);
    expect(quirkFoodPercent(generation, taste.favoriteFood)).toBe(QUIRK_FAVORITE_PERCENT);
    expect(quirkFoodPercent(generation, taste.dislikedFood)).toBe(QUIRK_DISLIKED_PERCENT);
    expect(quirkFoodPercent(generation, "super_medicine")).toBe(100);
    expect(quirkFoodPercent(generation, undefined)).toBe(100);
  });
});

// A generation's menu is the one it was born with (SPEC §21.4): the meal list
// grows by appending, and a taste drawn over yesterday's list must not move
// when today's is longer.
describe("the menu a generation was born with", () => {
  it("reads the legacy length when the egg predates the record", () => {
    expect(foodCatalogOf({})).toEqual(FOOD_ITEM_IDS.slice(0, LEGACY_FOOD_CATALOG_SIZE));
  });

  it("is a prefix of today's catalog, never longer than it", () => {
    expect(foodCatalogOf({ foodCatalogSize: 1 })).toEqual(FOOD_ITEM_IDS.slice(0, 1));
    expect(foodCatalogOf({ foodCatalogSize: 999 })).toEqual(FOOD_ITEM_IDS);
  });

  it("keeps an older generation's taste inside its own menu whatever the shop sells now", () => {
    for (const seed of SEEDS) {
      const legacy = quirks({ seed });
      expect(FOOD_ITEM_IDS.slice(0, LEGACY_FOOD_CATALOG_SIZE)).toContain(legacy.favoriteFood);
      expect(FOOD_ITEM_IDS.slice(0, LEGACY_FOOD_CATALOG_SIZE)).toContain(legacy.dislikedFood);
      // The draw is the same whether the record says two or is missing.
      expect(quirks({ seed, foodCatalogSize: LEGACY_FOOD_CATALOG_SIZE })).toEqual(legacy);
    }
  });

  it("with one meal on the menu, likes it and has nothing to dislike", () => {
    const taste = quirks({ seed: 5, foodCatalogSize: 1 });
    expect(taste.favoriteFood).toBe(FOOD_ITEM_IDS[0]);
    expect(taste.dislikedFood).toBe(FOOD_ITEM_IDS[0]);
  });
});

// Drinks live outside the meal list on purpose: quirks and cravings index that
// list by position, and a new meal would shift every generation's taste.
describe("drinks and taste", () => {
  it("keeps drinks out of the meal list, so no generation loves or hates one", () => {
    for (const itemId of Object.keys(DRINK_ITEMS)) {
      expect(FOOD_ITEM_IDS).not.toContain(itemId);
      for (const seed of [1, 7, 1337, 424242]) expect(quirkFoodPercent({ seed }, itemId)).toBe(100);
    }
  });
});
