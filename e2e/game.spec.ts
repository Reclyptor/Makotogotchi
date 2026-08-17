// End-to-end acceptance (SPEC §16.5) against the production build, real
// stores, and a real browser. The realtime test is the product's core claim:
// two strangers see each other's care instantly.

import { expect, test } from "@playwright/test";

test.describe("the shared pet", () => {
  test("cold load renders the living pet with meters and live status", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
    await expect(page.locator("canvas")).toBeVisible();
    for (const meter of ["Hunger", "Energy", "Hygiene", "Joy", "Health"]) {
      await expect(page.getByRole("meter", { name: meter })).toBeVisible();
    }
    await expect(page.getByText(/Makoto/).first()).toBeVisible();
    // The day's communal goal is part of the first paint (SPEC §21.7).
    await expect(page.getByRole("region", { name: "Today's goal" })).toBeVisible({ timeout: 10_000 });
  });

  test("two visitors see each other's actions in realtime", async ({ browser }) => {
    // Separate contexts — separate cookies — separate caretakers.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto("/");
    await pageB.goto("/");
    await expect(pageA.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
    await expect(pageB.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    // B pets; A sees the attributed feed entry appear without reloading.
    await pageB.getByRole("button", { name: /^Pet$/ }).click();
    await expect(pageA.getByText(/Friend \w{4} petted Makoto/)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText(/You petted Makoto/)).toBeVisible({ timeout: 10_000 });

    // Presence counts both watchers on both screens. Match the whole badge:
    // the meters carry a "👥 N caretakers this week" line that a bare
    // emoji-and-a-digit pattern matches too.
    await expect(pageA.getByText(/👥 [2-9] watching/)).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByText(/👥 [2-9] watching/)).toBeVisible({ timeout: 20_000 });

    await contextA.close();
    await contextB.close();
  });

  test("cooldowns disable the button with a live reason", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    const feed = page.getByRole("button", { name: /^Feed/ });
    await expect(feed).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
    await feed.click();
    await expect(feed).toHaveAttribute("aria-disabled", "true", { timeout: 5_000 });
    await expect(feed).toHaveAccessibleName(/busy|breath/i);
    await context.close();
  });

  test("every action is keyboard-focusable with its reason, even when unavailable", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    for (const action of ["Feed", "Play", "Clean", "Medicate", "Lullaby", "Pet"]) {
      const button = page.getByRole("button", { name: new RegExp(`^${action}`) });
      await expect(button).toBeVisible();
      // In the tab order (aria-disabled, never disabled — SPEC §11.3)...
      expect(await button.evaluate((el) => (el as HTMLButtonElement).tabIndex)).toBe(0);
      await button.focus();
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).toMatch(
        new RegExp(`^${action}`),
      );
      // ...and an unavailable action explains itself in its accessible name.
      if ((await button.getAttribute("aria-disabled")) === "true") {
        await expect(button).toHaveAccessibleName(/—/);
      }
    }
    await context.close();
  });

  test("caretaker identity persists across visits", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    const first = (await (await page.request.get("/api/state")).json()) as { caretakerId: string };
    await page.reload();
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
    const second = (await (await page.request.get("/api/state")).json()) as { caretakerId: string };

    expect(first.caretakerId).toBeTruthy();
    expect(second.caretakerId).toBe(first.caretakerId);
    await context.close();
  });
});
