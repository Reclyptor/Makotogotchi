// E2E for the ancient code (SPEC §26). The half worth driving a real browser
// for is the communal one: that one caretaker's keystrokes reach every other
// screen, and that the keepsake reaches exactly one of them.
//
// The pet sleeps on its own clock (America/Chicago, 22:00–07:00), so whether
// the sky opens with confetti or with meteors depends on when CI runs. Every
// assertion here is therefore on the part of the copy both moods share.

import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * The room-wide guard holds for five minutes (SPEC §26.2), which outlives a
 * whole test run — so the second test to want a broadcast would silently get
 * the local-only path instead. Cleared before each test that needs one.
 */
const clearGuard = (): void => {
  execFileSync("docker", ["exec", "mgc-e2e-redis", "redis-cli", "DEL", "mgc:konami:guard"], { stdio: "ignore" });
};

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a", "Enter"];

const enterCode = async (page: Page): Promise<void> => {
  for (const key of KONAMI) await page.keyboard.press(key);
};

// The label states which way the press goes, so it changes with the state.
const retroToggle = (page: Page) => page.getByRole("button", { name: /retro display/i });

const live = async (page: Page): Promise<void> => {
  await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
};

test.describe("the ancient code", () => {
  test("opens the sky on every screen at once", async ({ browser }) => {
    clearGuard();
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await pageA.goto("/");
    await pageB.goto("/");
    await live(pageA);
    await live(pageB);

    await enterCode(pageA);

    // The communal half: B typed nothing and is told anyway. Both moods say
    // "the ancient code"; only the surrounding sentence differs.
    await expect(pageA.getByText(/the ancient code/)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText(/the ancient code/)).toBeVisible({ timeout: 10_000 });

    // …and nobody is told who did it (SPEC §26.2).
    await expect(pageB.getByText(/the ancient code/)).not.toContainText(/You|Friend/);

    await contextA.close();
    await contextB.close();
  });

  test("leaves a keepsake with its finder and nobody else", async ({ browser }) => {
    clearGuard();
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await pageA.goto("/");
    await pageB.goto("/");
    await live(pageA);
    await live(pageB);

    await expect(retroToggle(pageA)).toHaveCount(0);
    await enterCode(pageA);

    await expect(pageA.getByText(/RETRO MODE UNLOCKED/)).toBeVisible({ timeout: 10_000 });
    await expect(retroToggle(pageA)).toBeVisible();
    // It is a keepsake, not a broadcast: B saw the spectacle and still has no
    // television.
    await expect(pageB.getByText(/the ancient code/)).toBeVisible({ timeout: 10_000 });
    await expect(retroToggle(pageB)).toHaveCount(0);

    // Permanent, and on by default the moment it is found.
    await expect(retroToggle(pageA)).toHaveAttribute("aria-pressed", "true");
    await pageA.reload();
    await live(pageA);
    await expect(retroToggle(pageA)).toBeVisible();
    await expect(retroToggle(pageA)).toHaveAttribute("aria-pressed", "true");

    // And it switches off without being forgotten — "found it and turned it
    // off" is a different state from "never found it" (SPEC §26.5).
    await retroToggle(pageA).click();
    await expect(retroToggle(pageA)).toHaveAttribute("aria-pressed", "false");
    await pageA.reload();
    await live(pageA);
    await expect(retroToggle(pageA)).toBeVisible();
    await expect(retroToggle(pageA)).toHaveAttribute("aria-pressed", "false");

    // Typing the code again does NOT switch it back on. The unlock fires once
    // and once only; after that, whether the display is on is the caretaker's
    // standing choice and the code does not get to overrule it.
    await enterCode(pageA);
    await expect(pageA.getByText(/the ancient code/).last()).toBeVisible({ timeout: 10_000 });
    await expect(retroToggle(pageA)).toHaveAttribute("aria-pressed", "false");

    await contextA.close();
    await contextB.close();
  });

  test("stays inert while a dialog owns the keyboard", async ({ browser }) => {
    clearGuard();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await live(page);

    // The gate is one flag — `!playing && !shopOpen` — and the shop trips it
    // by the same path a minigame does. The shop is what this drives because
    // every test that starts a minigame belongs in social.spec.ts: PLAY holds
    // a global cooldown on a shared pet, so a second spec file racing for a
    // run would refuse it and flake. Nothing is lost by using the other
    // dialog; the flag does not know which one set it.
    await page.getByRole("button", { name: "Shop" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });

    await enterCode(page);
    await expect(page.getByText(/RETRO MODE UNLOCKED/)).toHaveCount(0);
    await expect(retroToggle(page)).toHaveCount(0);

    // And the moment the dialog closes it listens again — inert, not broken.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await enterCode(page);
    await expect(retroToggle(page)).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});
