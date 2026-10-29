// E2E for the Halloween room (SPEC §22.11). The browser's clock is pinned to
// Oct 31 in the pet's zone, which is all it takes: the holiday is read off the
// pet's calendar day, so no server state is involved.
//
// The pet's zone is not a constant here; see holiday-clock.ts.
//
// What the DOM can say is asserted here: the caption and the feed line. The
// room itself is a canvas, so the costume and the missing decor are for a
// human to look at — set E2E_SCREENSHOT_DIR to keep the screenshots there.

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { instantIn, petZone } from "./holiday-clock";

const YEAR = 2026;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant at which the pet's wall clock reads Oct 31, `hour`:`minute`. */
const halloweenAt = (zone: string, hour: number, minute = 0): Date => instantIn(zone, YEAR, 10, 31, hour, minute);

// The atlas decodes after first paint and nothing in the DOM says when.
const ATLAS_SETTLE_MS = 2000;

const open = async (page: Page, at: Date): Promise<void> => {
  await page.clock.setFixedTime(at);
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
  await page.waitForTimeout(ATLAS_SETTLE_MS);
};

// The room's logical size and where its window sits in it (backdrop/compose.ts).
const ROOM = { width: 260, height: 200 } as const;
const WINDOW_AT = { x: 152, y: 14, w: 64, h: 52 } as const;

const keep = async (page: Page, testInfo: TestInfo, name: string): Promise<void> => {
  const dir = process.env.E2E_SCREENSHOT_DIR ?? testInfo.outputDir;
  await page.locator("canvas").first().screenshot({ path: `${dir}/live-${name}.png` });
};

/** The window pane of the room canvas, magnified: the sky's moon and bats are a few pixels each. */
const keepWindow = async (page: Page, testInfo: TestInfo, name: string): Promise<void> => {
  const box = (await page.locator("canvas").first().boundingBox())!;
  const dir = process.env.E2E_SCREENSHOT_DIR ?? testInfo.outputDir;
  await page.screenshot({
    path: `${dir}/live-${name}.png`,
    clip: {
      x: box.x + box.width * (WINDOW_AT.x / ROOM.width),
      y: box.y + box.height * (WINDOW_AT.y / ROOM.height),
      width: box.width * (WINDOW_AT.w / ROOM.width),
      height: box.height * (WINDOW_AT.h / ROOM.height),
    },
  });
};

test.describe("Halloween", () => {
  test("greets the room all day, in costume", async ({ page, request }, testInfo) => {
    await open(page, halloweenAt(await petZone(request), 12));

    await expect(page.getByText("🎃 Happy Halloween!")).toBeVisible();
    await expect(page.getByText(/Out at/)).toHaveCount(0);
    await expect(page.getByText("Makoto is dressed up as a wizard for Halloween!")).toBeVisible();
    await keep(page, testInfo, "day");
  });

  test("dresses the whole page, and leaves the care buttons their names", async ({ page, request }, testInfo) => {
    await open(page, halloweenAt(await petZone(request), 12));

    await expect(page.locator("html")).toHaveAttribute("data-holiday", "halloween");
    const feed = page.getByRole("button", { name: /^Feed/ });
    await expect(feed).toBeVisible();
    await expect(feed).not.toContainText("🍖");
    await expect(page.getByRole("button", { name: /^Play/ })).not.toContainText("🎮");
    await expect(page.getByRole("button", { name: /^Clean/ })).not.toContainText("🌪️");
    const dir = process.env.E2E_SCREENSHOT_DIR ?? testInfo.outputDir;
    await page.screenshot({ path: `${dir}/live-ui.png`, fullPage: true });
  });

  // Magnified, because the moon and the bats are a few pixels each. Kept apart
  // from the rest, whose full-page shot wants an ordinary pixel ratio.
  test.describe("late at night", () => {
    test.use({ deviceScaleFactor: 4 });

    // The moon and the bats are the night segment's (23:00 on), so a screenshot
    // before it would only show dusk.
    test("keeps the greeting and the costume late at night, with the night sky in the window", async ({ page, request }, testInfo) => {
      await open(page, halloweenAt(await petZone(request), 23, 30));

      await expect(page.getByText("🎃 Happy Halloween!")).toBeVisible();
      await keep(page, testInfo, "night");
      await keepWindow(page, testInfo, "night-window");
    });
  });

  for (const [label, offset] of [
    ["the day before", -DAY_MS],
    ["the day after", DAY_MS],
  ] as const) {
    test(`is an ordinary day ${label}`, async ({ page, request }) => {
      await open(page, new Date(halloweenAt(await petZone(request), 12).getTime() + offset));

      await expect(page.locator("html")).not.toHaveAttribute("data-holiday", /.+/);
      await expect(page.getByText("🎃 Happy Halloween!")).toHaveCount(0);
      await expect(page.getByText(/dressed up as a wizard/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Feed/ })).toContainText("🍖");
    });
  }
});
