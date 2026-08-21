// End-to-end acceptance for pet wants (SPEC §25): the ask is on screen with
// a countdown, granting it celebrates in the feed, and the banner comes
// down. The dust-bath want is opened deterministically by global-setup;
// CLEAN is the one action no other spec performs, so nothing else in the
// suite can grant it first.

import { expect, test } from "@playwright/test";

test.describe("pet wants", () => {
  test("the ask is visible, granting it celebrates, and the banner retires", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    // The wish banner, with its countdown ticking inside the window.
    const banner = page.getByRole("region", { name: "Makoto's wish" });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText("Makoto wants a dust bath.");
    await expect(banner).toContainText(/\d+:\d{2}/);

    // Granting the wish: one dust bath.
    const clean = page.getByRole("button", { name: /^Clean/ });
    await expect(clean).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
    await clean.click();

    // The wish-granted line lands in the feed and the banner comes down.
    await expect(page.getByText("Makoto got its dust bath!")).toBeVisible({ timeout: 10_000 });
    await expect(banner).toBeHidden({ timeout: 10_000 });

    await context.close();
  });
});
