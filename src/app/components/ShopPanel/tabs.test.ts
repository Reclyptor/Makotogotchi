// The shop's row model (SPEC §13.2). Tested directly because the three bugs
// it replaces were all structural rather than visual: cosmetics rendered with
// no heading at all and so read as co-op purchases, a funded wall style had a
// row in two places at once, and every buy button looked live no matter what
// the balance was.

import { describe, expect, it } from "vitest";
import { iconTables, shopTabs, initialTab, type CareGate, type ShopModel, type ShopRow, type ShopTab } from "./tabs";
import { hatchedState, testCtx } from "@/sim/testkit";
import { projectImmortal } from "@/sim/testkit";
import type { RoomView } from "@/server/shop";

const CATALOG = {
  food: { pepper_treat: { kind: "food", label: "Pepper Treat", price: 60, scalePercent: 120, joyBonus: 15_000 } },
  medicine: { super_medicine: { kind: "medicine", label: "Super Medicine", price: 250, bypassCooldowns: true } },
  toys: { teeter: { kind: "toy", label: "Teeter Toy", price: 400, playBonusPercent: 15 } },
  cosmetics: { bow: { kind: "cosmetic", price: 300, label: "Ribbon Bow" } },
  decor: { plant: { kind: "decor", price: 400, label: "Potted Plant" } },
  grand: {
    window_seat: { kind: "grand", group: "decor", price: 500, label: "Window Seat" },
    theme_cabin: { kind: "grand", group: "theme", themeId: "cabin", price: 900, label: "Log Cabin Walls" },
    beach: { kind: "grand", group: "venue", price: 800, label: "Beach Day" },
  },
} as unknown as ShopModel["catalog"];

const ROOM: RoomView = {
  decor: [],
  activeCosmetic: null,
  cosmetics: [],
  activeTheme: "cozy",
  themes: ["cozy"],
};

const model = (overrides: Partial<ShopModel> = {}): ShopModel => ({
  catalog: CATALOG,
  coins: 1000,
  inventory: {},
  room: ROOM,
  toys: [],
  funding: [
    { itemId: "window_seat", label: "Window Seat", price: 500, pooled: 0, funded: false },
    { itemId: "theme_cabin", label: "Log Cabin Walls", price: 900, pooled: 0, funded: false },
    { itemId: "beach", label: "Beach Day", price: 800, pooled: 0, funded: false },
  ],
  ...overrides,
});

const ctx = testCtx();
const awake = hatchedState(ctx);
const gate = (state = awake): CareGate => ({ state, ctx, caretakerId: "caretaker-a", petName: "Makoto" });

const tab = (tabs: ShopTab[], id: string): ShopTab => {
  const found = tabs.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no ${id} tab`);
  return found;
};

const rowsOf = (found: ShopTab): ShopRow[] => found.groups.flatMap((group) => group.rows);

const rowNamed = (found: ShopTab, name: string): ShopRow => {
  const row = rowsOf(found).find((candidate) => candidate.name.startsWith(name));
  if (!row) throw new Error(`no row named ${name} in ${found.id}`);
  return row;
};

describe("shop tabs", () => {
  it("gives every item a tab, and every group a heading", () => {
    const tabs = shopTabs(model(), gate());
    expect(tabs.map((entry) => entry.id)).toEqual(["pack", "food", "toys", "style", "room"]);
    // The bug this replaces: cosmetics rendered under the co-op heading.
    expect(rowNamed(tab(tabs, "style"), "Ribbon Bow")).toBeDefined();
    for (const group of tab(tabs, "room").groups) expect(group.heading).toBeTruthy();
  });

  it("locks a price you cannot meet, and says how short you are", () => {
    const tabs = shopTabs(model({ coins: 190 }), gate());
    const action = rowNamed(tab(tabs, "food"), "Super Medicine").action;
    expect(action).toMatchObject({ kind: "buy", availability: { ok: false, note: "Needs 60 more 🪙" } });
  });

  it("leaves an affordable price alone", () => {
    const tabs = shopTabs(model({ coins: 250 }), gate());
    expect(rowNamed(tab(tabs, "food"), "Super Medicine").action).toMatchObject({ availability: { ok: true } });
  });

  it("locks pack food while Makoto sleeps, in words rather than an enum", () => {
    const asleep = projectImmortal(awake, 5500, ctx); // past SLEEP_HOUR on day 0
    expect(asleep.asleep).toBe(true);
    const tabs = shopTabs(model({ inventory: { pepper_treat: 2 } }), gate(asleep));
    expect(rowNamed(tab(tabs, "pack"), "Pepper Treat").action).toMatchObject({
      kind: "use",
      care: "FEED",
      availability: { ok: false, note: "Makoto is asleep" },
    });
  });

  it("locks pack medicine when there is nothing to cure", () => {
    const tabs = shopTabs(model({ inventory: { super_medicine: 1 } }), gate());
    expect(rowNamed(tab(tabs, "pack"), "Super Medicine").action).toMatchObject({
      care: "MEDICATE",
      availability: { ok: false, note: "Makoto isn't sick" },
    });
  });

  it("gives a wall style one row for its whole life", () => {
    const funding = model().funding.map((pool) => (pool.itemId === "theme_cabin" ? { ...pool, pooled: 900, funded: true } : pool));
    const owned: RoomView = { ...ROOM, themes: ["cozy", "cabin"] };
    const rows = rowsOf(tab(shopTabs(model({ funding, room: owned }), gate()), "room"));
    const cabin = rows.filter((row) => row.id === "theme-cabin");
    expect(cabin).toHaveLength(1);
    // Funded and not in use, so the row's action is the switcher.
    expect(cabin[0]?.action).toMatchObject({ kind: "theme", themeId: "cabin" });
    expect(rows.filter((row) => row.id === "theme-cozy")[0]?.action).toMatchObject({ kind: "badge", label: "In Use" });
  });

  it("collapses the last stretch of a pool into one button that finishes it", () => {
    const funding = model().funding.map((pool) => (pool.itemId === "window_seat" ? { ...pool, pooled: 470 } : pool));
    const action = rowNamed(tab(shopTabs(model({ funding }), gate()), "room"), "Window Seat").action;
    expect(action).toMatchObject({
      kind: "fund",
      offers: [{ amount: "all", label: "Finish it", coins: 30, availability: { ok: true } }],
    });
  });

  it("offers +10 and +50 while a pool has further to go, locking what you cannot give", () => {
    const action = rowNamed(tab(shopTabs(model({ coins: 20 }), gate()), "room"), "Window Seat").action;
    expect(action).toMatchObject({
      kind: "fund",
      offers: [{ amount: 10, availability: { ok: true } }, { amount: 50, availability: { ok: false } }],
    });
  });

  it("opens on the pack only when there is something in it", () => {
    expect(initialTab(shopTabs(model(), gate()))).toBe("food");
    expect(initialTab(shopTabs(model({ inventory: { pepper_treat: 1 } }), gate()))).toBe("pack");
  });
});

describe("shop icons", () => {
  // The mechanical half of "no two rows look alike". It would NOT have caught
  // the case that prompted it — Fish Feast's 🐟 beside the Aquarium's 🐠 are
  // different characters — but exact collisions are the cheap half to hold,
  // and they are what happens when someone adds an item by copying a line.
  it("gives no two items the same glyph", () => {
    const seen = new Map<string, string>();
    for (const [itemId, glyph] of Object.entries(iconTables.items)) {
      const owner = seen.get(glyph);
      expect(owner, `${itemId} and ${owner} both use ${glyph}`).toBeUndefined();
      seen.set(glyph, itemId);
    }
  });

  it("gives no two categories the same fallback", () => {
    const glyphs = Object.values(iconTables.categories);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  // A fallback that equals a real item's glyph means a newly added item shows
  // up wearing an existing one's face. The exception is medicine, where the
  // category symbol and the only item's symbol are both 💊 by design — 💊 is
  // what MEDICATE uses, and picking something else to satisfy a test would be
  // the tail wagging the dog.
  it("keeps category fallbacks from impersonating an item", () => {
    const items = new Set(Object.values(iconTables.items));
    for (const [category, glyph] of Object.entries(iconTables.categories)) {
      if (category === "medicine") continue;
      expect(items.has(glyph), `the ${category} fallback ${glyph} is already an item's`).toBe(false);
    }
  });

  it("draws a glyph for every catalog item the shop sells", () => {
    const rows = shopTabs(model({ inventory: {} }), gate()).flatMap((tab) =>
      tab.groups.flatMap((group) => group.rows),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.icon, `${row.name} has no icon`).toBeTruthy();
  });
});
