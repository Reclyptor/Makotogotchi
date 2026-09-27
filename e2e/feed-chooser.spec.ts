// The split Feed tile (SPEC §11.2): one tap still serves the free meal; the
// chevron opens the pack as a menu and leads into the shop.

import { test, expect } from "@playwright/test";

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
    await expect(items.first()).toHaveText(/Plain meal/);
    await expect(items.first()).toBeFocused();
    // An empty pack still has somewhere to go.
    await expect(items.last()).toHaveText(/shop/i);

    await page.keyboard.press("ArrowDown");
    await expect(items.last()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(chevron).toBeFocused();
    await context.close();
  });

  test("the last entry opens the shop on its Food tab", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    await page.getByRole("button", { name: "Choose a meal" }).click();
    await page.getByRole("menu", { name: "What to feed" }).getByRole("menuitem").last().click();
    const shop = page.getByRole("dialog");
    await expect(shop).toBeVisible();
    await expect(shop.getByRole("tab", { name: "Food" })).toHaveAttribute("aria-selected", "true");
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
