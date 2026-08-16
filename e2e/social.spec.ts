// E2E for the social and economy layers: reactions ripple across contexts,
// the shop gates on coins and reflects communal purchases, and the minigame
// runs its full spectated arc — including the short-run (collision) path
// that once returned "implausible".
//
// Every test that plays a minigame lives in THIS file. The pet is shared and
// PLAY carries a global cooldown, so two spec files racing for a run would
// refuse each other; keeping them in one serial file keeps that impossible.

import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";

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

const RECORD_RUN_MS = 4000;
const RECORD_RUN_SCORE = 7;

/**
 * One full Dust Dash run straight through the API. A run can be refused
 * because someone else is mid-game or because PLAY is still on its global
 * cooldown — both transient, so the caller retries.
 */
const playOnce = async (request: APIRequestContext): Promise<{ ok: boolean; status: number }> => {
  const start = await request.post("/api/play", { data: { phase: "start", game: "dustdash" } });
  if (!start.ok()) return { ok: false, status: start.status() };
  await new Promise((resolve) => setTimeout(resolve, RECORD_RUN_MS));
  const finish = await request.post("/api/play", {
    data: { phase: "finish", score: RECORD_RUN_SCORE, inputs: RECORD_RUN_SCORE + 1 },
  });
  return { ok: finish.ok(), status: finish.status() };
};

const playUntilAccepted = async (request: APIRequestContext): Promise<void> => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const outcome = await playOnce(request);
    if (outcome.ok) return;
    expect(outcome.status, "a refused run must be a transient conflict, not a rejection").toBe(409);
    await new Promise((resolve) => setTimeout(resolve, 12_000));
  }
  throw new Error("the pet never accepted a minigame run");
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
    await page.getByRole("region", { name: "Shop" }).getByRole("button", { name: /for 400 coins/ }).first().click();
    await expect(page.getByText(/Not enough coins/)).toBeVisible({ timeout: 10_000 });

    // Funded: the potted plant becomes communal decor.
    const state = (await (await page.request.get("/api/state")).json()) as { caretakerId: string };
    seedCoins(state.caretakerId, 5000);
    await page.getByRole("region", { name: "Shop" }).getByRole("button", { name: /for 400 coins/ }).first().click();
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
    // ?game= pins the rotation so the collision path below is deterministic.
    await playerPage.goto("/?game=dustdash");
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

  test("spectator reactions become crowd noise inside the live game", async ({ browser }) => {
    test.setTimeout(150_000);
    const player = await browser.newContext();
    const fan = await browser.newContext();
    const playerPage = await player.newPage();
    const fanPage = await fan.newPage();
    // Simon Squeaks waits on the player, so the run stays live while the
    // spectator reacts — no race against a game that ends on its own.
    await playerPage.goto("/?game=simon");
    await fanPage.goto("/");
    await expect(playerPage.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
    await expect(fanPage.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    // The button greys itself out while PLAY is on its global cooldown, so
    // waiting for it is waiting for the pet to be ready.
    const play = playerPage.getByRole("button", { name: /^Play/ });
    await expect(play).not.toHaveAttribute("aria-disabled", "true", { timeout: 90_000 });
    await play.click();
    const dialog = playerPage.getByRole("dialog", { name: /Simon Squeaks/ });
    await expect(dialog.getByRole("button", { name: "Gold pad" })).toBeVisible({ timeout: 15_000 });

    await fanPage.getByRole("button", { name: "React with 🎉" }).click();
    await expect(dialog.getByText("🎉")).toBeVisible({ timeout: 10_000 });

    // Hand the session back rather than letting it expire on its TTL.
    await playerPage.request.post("/api/play", { data: { phase: "finish", score: 0, inputs: 0 } });
    await player.close();
    await fan.close();
  });

  test("a finished run takes the record board, and everyone hears it", async ({ browser }) => {
    test.setTimeout(180_000);
    const watcher = await browser.newContext();
    const player = await browser.newContext();
    const watcherPage = await watcher.newPage();
    await watcherPage.goto("/");
    await expect(watcherPage.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });

    await playUntilAccepted(player.request);

    // The board reports the run…
    const boards = (await (await watcherPage.request.get("/api/records")).json()) as {
      games: { game: string; alltime: { score: number } | null; weekly: { score: number } | null }[];
    };
    const dustdash = boards.games.find((entry) => entry.game === "dustdash");
    expect(dustdash?.alltime?.score).toBeGreaterThanOrEqual(RECORD_RUN_SCORE);
    expect(dustdash?.weekly?.score).toBeGreaterThanOrEqual(RECORD_RUN_SCORE);

    // …and the watcher heard about it without reloading.
    await expect(watcherPage.getByText(/set the Dust Dash record/)).toBeVisible({ timeout: 15_000 });

    await watcher.close();
    await player.close();
  });
});
