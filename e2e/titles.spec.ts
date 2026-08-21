// End-to-end acceptance for contested titles (SPEC §24): a strict excess
// takes the title, the takeover lands in the live feed, the leaderboard
// shows the holder, and the presence list opens with names.
//
// Parallel specs share the pet's global cooldowns, so a click that passed
// the enabled-guard can still be refused a beat later. Every pet here loops
// click → feed confirmation; the second caretaker loops until the takeover
// line itself appears, which simultaneously proves the pet landed and the
// title moved.

import { expect, test, type Page } from "@playwright/test";

const petUntil = async (page: Page, confirmed: RegExp, attempts: number): Promise<void> => {
  const button = page.getByRole("button", { name: /^Pet/ });
  for (let attempt = 0; attempt < attempts; attempt++) {
    await expect(button).not.toHaveAttribute("aria-disabled", "true", { timeout: 45_000 });
    await button.click();
    try {
      await expect(page.getByText(confirmed).first()).toBeVisible({ timeout: 5_000 });
      return;
    } catch {
      // A cooldown landed between the guard and the click — go again.
    }
  }
  throw new Error(`pet never confirmed: ${String(confirmed)}`);
};

test.describe("caretaker titles", () => {
  test("a strict excess takes the title and every surface says so", async ({ browser }) => {
    test.setTimeout(240_000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto("/");
    await pageB.goto("/");
    await expect(pageA.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
    await expect(pageB.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    // A lands one pet — a distinct caretaker now sits at count 1 (holding
    // Cuddler, or tying a parallel spec's single pet; either way the top
    // count is 1 and it is not B's).
    await petUntil(pageA, /You petted Makoto/, 6);

    // B pets until the takeover announces: two landed pets reach 2, which
    // strictly exceeds whoever holds at 1 (SPEC §24.2).
    await petUntil(pageB, /took Cuddler from/, 8);
    await expect(pageA.getByText(/took Cuddler from/).first()).toBeVisible({ timeout: 10_000 });

    // The leaderboard's Titles block shows the holder.
    await pageB.goto("/leaderboard");
    const titlesSection = pageB.getByRole("region", { name: "Titles" });
    await expect(titlesSection).toBeVisible();
    await expect(titlesSection.getByText("Cuddler", { exact: false }).first()).toBeVisible();
    await expect(titlesSection.getByText(/· \d/).first()).toBeVisible();

    // The presence list opens into real names (SPEC §24.4).
    await pageA.getByText(/watching/).click();
    await expect(pageA.getByRole("list", { name: "Watching now" })).toBeVisible();
    await expect(pageA.getByRole("list", { name: "Watching now" }).getByText("You")).toBeVisible();

    await contextA.close();
    await contextB.close();
  });
});
