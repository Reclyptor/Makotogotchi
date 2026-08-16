// E2E for the social and economy layers: reactions ripple across contexts,
// the shop gates on coins and reflects communal purchases, and the minigame
// runs its full spectated arc — including the short-run (collision) path
// that once returned "implausible".

import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const seedCoins = (caretakerId: string, coins: number): void => {
  execFileSync("docker", [
    "exec",
    "mgc-e2e-mongo",
    "mongosh",
    "--quiet",
    "makotogotchi-e2e",
    "--eval",
    `db.caretakers.updateOne({_id:"${caretakerId}"},{$set:{coins:${coins}}},{upsert:true})`,
  ]);
};

test.describe("social and economy", () => {
  test("a reaction from one visitor appears in another's feed", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await pageA.goto("/");
    await pageB.goto("/");
    await expect(pageA.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
    await expect(pageB.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    await pageB.getByRole("button", { name: "React with 🎉" }).click();
    await expect(pageA.getByText(/reacted 🎉/)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText(/You reacted 🎉/)).toBeVisible({ timeout: 10_000 });

    await contextA.close();
    await contextB.close();
  });

  test("the shop refuses the broke and serves the funded, communally", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    await page.getByRole("button", { name: /Shop/ }).click();
    await expect(page.getByRole("region", { name: "Shop" })).toBeVisible();

    // Broke: buying anything is refused with a reason.
    await page.getByRole("region", { name: "Shop" }).getByRole("button", { name: /🪙 400/ }).first().click();
    await expect(page.getByText(/Not enough coins/)).toBeVisible({ timeout: 10_000 });

    // Funded: the potted plant becomes communal decor.
    const state = (await (await page.request.get("/api/state")).json()) as { caretakerId: string };
    seedCoins(state.caretakerId, 5000);
    await page.getByRole("region", { name: "Shop" }).getByRole("button", { name: /🪙 400/ }).first().click();
    await expect(page.getByText(/Bought/)).toBeVisible({ timeout: 10_000 });

    // A second visitor's shop shows it owned — spending is communal.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto("/");
    await expect(pageB.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
    await pageB.getByRole("button", { name: /Shop/ }).click();
    await expect(pageB.getByRole("region", { name: "Shop" }).getByText("owned").first()).toBeVisible({ timeout: 10_000 });

    await context.close();
    await contextB.close();
  });

  test("a minigame run is spectated live and a collision still records", async ({ browser }) => {
    const player = await browser.newContext();
    const spectator = await browser.newContext();
    const playerPage = await player.newPage();
    const spectatorPage = await spectator.newPage();
    await playerPage.goto("/");
    await spectatorPage.goto("/");
    await expect(playerPage.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
    await expect(spectatorPage.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    // PLAY opens Dust Dash; the player never jumps, so the first dust bunny
    // ends the run within a few seconds — the legitimate short-run path.
    await playerPage.getByRole("button", { name: /^Play/ }).click();
    await expect(playerPage.getByRole("dialog", { name: /Dust Dash/ })).toBeVisible({ timeout: 10_000 });

    // The spectator sees the live banner...
    await expect(spectatorPage.getByText(/is playing Dust Dash/)).toBeVisible({ timeout: 15_000 });

    // ...the run ends by collision and records a real result...
    await expect(playerPage.getByText(/Scored/)).toBeVisible({ timeout: 20_000 });
    await playerPage.getByRole("button", { name: "Done" }).click();

    // ...and the spectator's banner comes down.
    await expect(spectatorPage.getByText(/is playing Dust Dash/)).not.toBeVisible({ timeout: 15_000 });

    await player.close();
    await spectator.close();
  });
});
