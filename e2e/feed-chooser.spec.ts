// The split Feed tile (SPEC §11.2): one tap still serves the free meal; the
// chevron opens the whole catalog as a menu, owned or not.

import { test, expect } from "@playwright/test";
import { DRINK_ITEMS, FOOD_ITEMS } from "@/sim/economy";

const CATALOG_SIZE = Object.keys(FOOD_ITEMS).length + Object.keys(DRINK_ITEMS).length;

test.describe("the feed chooser", () => {
  test("opens as a menu with the free meal first, walks by keyboard, and closes on Escape", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    const chevron = page.getByRole("button", { name: "Choose a meal" });
    await expect(chevron).toHaveAttribute("aria-expanded", "false");
    await chevron.click();
    const menu = page.getByRole("menu", { name: "What to feed" });
    await expect(menu).toBeVisible();
    await expect(chevron).toHaveAttribute("aria-expanded", "true");

    const items = menu.getByRole("menuitem");
    await expect(items).toHaveCount(1 + CATALOG_SIZE);
    await expect(items.first()).toHaveText(/Plain meal/);
    await expect(items.first()).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(items.last()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(chevron).toBeFocused();
    await context.close();
  });

  test("lists every food and drink with its price, and a broke caretaker is told how far short", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    await page.getByRole("button", { name: "Choose a meal" }).click();
    const menu = page.getByRole("menu", { name: "What to feed" });
    for (const [itemId, item] of [...Object.entries(FOOD_ITEMS), ...Object.entries(DRINK_ITEMS)]) {
      const row = menu.getByRole("menuitem", { name: new RegExp(`^${item.label}, ${item.price} coins`) });
      await expect(row, itemId).toBeVisible();
      await expect(row).toContainText(`🪙 ${item.price}`);
      // A fresh caretaker has nothing: every row is locked with the shortfall,
      // in the tab order with its reason in the name (SPEC §11.3).
      await expect(row).toHaveAttribute("aria-disabled", "true");
      await expect(row).toHaveAccessibleName(/Needs \d+ more/);
    }
    await context.close();
  });

  test("the chevron is never locked, and the free meal in the menu mirrors the tile", async ({ browser }) => {
    // The shared pet may be mid-cooldown from another spec's feed; either way
    // the menu opens, and its first entry says exactly what the tile says.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    const feed = page.getByRole("button", { name: /^Feed/ });
    const chevron = page.getByRole("button", { name: "Choose a meal" });
    await expect(chevron).not.toHaveAttribute("aria-disabled", "true");
    const locked = (await feed.getAttribute("aria-disabled")) === "true";
    await chevron.click();
    const plain = page.getByRole("menu", { name: "What to feed" }).getByRole("menuitem").first();
    if (locked) {
      await expect(plain).toHaveAttribute("aria-disabled", "true");
      await expect(plain).toHaveText(/busy|breath/i);
    } else {
      await expect(plain).not.toHaveAttribute("aria-disabled", "true");
    }
    await context.close();
  });
});
