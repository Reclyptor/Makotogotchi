// E2E for the winter holidays (SPEC §22.11): Thanksgiving, Christmas, New
// Year's Day and Valentine's Day, each switched on by the pet's calendar alone,
// and the fireworks that light the window at half past eleven on New Year's Eve.
// The browser's clock is pinned in the pet's zone (see holiday-clock.ts).
//
// What the DOM can say is asserted here: the root's attribute, the caption, the
// feed line and the care icons. The room is a canvas; set E2E_SCREENSHOT_DIR to
// keep its screenshots, and the fireworks are read off the canvas's pixels.

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { instantIn, petZone } from "./holiday-clock";
import { holidayScene } from "@/game/scene/holidays";
import { HOLIDAY_COPY } from "@/app/copy/holidays";
import type { HolidayId } from "@/sim/holidays";

const DAY_MS = 24 * 60 * 60 * 1000;
// The atlas decodes after first paint and nothing in the DOM says when.
const ATLAS_SETTLE_MS = 2000;

const HOLIDAYS = [
  { id: "thanksgiving", year: 2026, month: 11, day: 26 },
  { id: "christmas", year: 2026, month: 12, day: 25 },
  { id: "newYear", year: 2027, month: 1, day: 1 },
  { id: "valentines", year: 2027, month: 2, day: 14 },
] as const satisfies readonly { id: HolidayId; year: number; month: number; day: number }[];

const open = async (page: Page, at: Date): Promise<void> => {
  await page.clock.setFixedTime(at);
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
  await page.waitForTimeout(ATLAS_SETTLE_MS);
};

const dir = (testInfo: TestInfo): string => process.env.E2E_SCREENSHOT_DIR ?? testInfo.outputDir;

// The room's logical size and where its window sits in it (backdrop/compose.ts).
const ROOM = { width: 260, height: 200 } as const;
const WINDOW_AT = { x: 152, y: 14, w: 64, h: 52 } as const;
const GLASS_AT = { x: 155, y: 17, w: 58, h: 46 } as const;

/** The window pane of the room canvas, magnified: a burst is a few pixels wide. */
const keepWindow = async (page: Page, testInfo: TestInfo, name: string): Promise<void> => {
  const box = (await page.locator("canvas").first().boundingBox())!;
  await page.screenshot({
    path: `${dir(testInfo)}/${name}`,
    clip: {
      x: box.x + box.width * (WINDOW_AT.x / ROOM.width),
      y: box.y + box.height * (WINDOW_AT.y / ROOM.height),
      width: box.width * (WINDOW_AT.w / ROOM.width),
      height: box.height * (WINDOW_AT.h / ROOM.height),
    },
  });
};

/** How many pixels of the window's glass are one of these colours, exactly. The props on the walls are not looked at. */
const countPixels = (page: Page, colours: readonly (readonly number[])[]): Promise<number> =>
  page.locator("canvas").first().evaluate(
    (canvas: HTMLCanvasElement, { wanted, glass }) => {
      const { data, width } = canvas.getContext("2d")!.getImageData(glass.x, glass.y, glass.w, glass.h);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (wanted.some((colour) => colour[0] === data[i] && colour[1] === data[i + 1] && colour[2] === data[i + 2])) count++;
      }
      return width > 0 ? count : 0;
    },
    { wanted: colours as number[][], glass: GLASS_AT },
  );

for (const { id, year, month, day } of HOLIDAYS) {
  test.describe(id, () => {
    const copy = HOLIDAY_COPY[id];

    test("dresses the whole page and greets the room all day", async ({ page, request }, testInfo) => {
      await open(page, instantIn(await petZone(request), year, month, day, 12));

      await expect(page.locator("html")).toHaveAttribute("data-holiday", id);
      await expect(page.getByText(copy.caption)).toBeVisible();
      await expect(page.getByText(/Out at/)).toHaveCount(0);
      await expect(page.getByText(copy.dressedUp("Makoto"))).toBeVisible();
      // The care buttons keep their names and swap the glyph.
      await expect(page.getByRole("button", { name: /^Feed/ })).not.toContainText("🍖");
      await expect(page.getByRole("button", { name: /^Play/ })).not.toContainText("🎮");
      await page.locator("canvas").first().screenshot({ path: `${dir(testInfo)}/${id}-day.png` });
      await page.screenshot({ path: `${dir(testInfo)}/${id}-ui.png`, fullPage: true });
    });

    test("is an ordinary day the day before and the day after", async ({ page, request }) => {
      const noon = instantIn(await petZone(request), year, month, day, 12).getTime();
      for (const offset of [-DAY_MS, DAY_MS]) {
        await open(page, new Date(noon + offset));
        await expect(page.locator("html")).not.toHaveAttribute("data-holiday", /.+/);
        await expect(page.getByText(copy.caption)).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^Feed/ })).toContainText("🍖");
      }
    });
  });
}

test.describe("New Year's Eve", () => {
  test("lights the window with fireworks at 23:30, in the ordinary room", async ({ page, request }, testInfo) => {
    const palette = holidayScene("newYear").window.fireworks!;
    await open(page, instantIn(await petZone(request), 2026, 12, 31, 23, 30));

    // Dec 31 is not a holiday: no theme, no caption, no costume — just the sky.
    await expect(page.locator("html")).not.toHaveAttribute("data-holiday", /.+/);
    await expect(page.getByText(HOLIDAY_COPY.newYear.caption)).toHaveCount(0);
    await expect.poll(() => countPixels(page, palette), { timeout: 20_000 }).toBeGreaterThan(0);
    await keepWindow(page, testInfo, "nye-fireworks-window.png");
    await page.locator("canvas").first().screenshot({ path: `${dir(testInfo)}/nye-room.png` });
  });

  test("keeps the sky dark of fireworks at 22:30 and at 01:30", async ({ page, request }) => {
    const palette = holidayScene("newYear").window.fireworks!;
    const zone = await petZone(request);
    for (const [year, month, day, hour] of [[2026, 12, 31, 22], [2027, 1, 1, 1]] as const) {
      await open(page, instantIn(zone, year, month, day, hour, 30));
      await page.waitForTimeout(6_000);
      expect(await countPixels(page, palette), `${year}-${month}-${day} ${hour}:30`).toBe(0);
    }
  });
});

// Every holiday's display face is declared in every page's stylesheet, but with
// preloading off and its font-family applied only under its own attribute, so a
// browser has no reason to fetch the file on any other day. Font files carry
// hashed names, so the holiday faces are found by what a holiday page fetches
// beyond an ordinary one's, and an ordinary day is held to none of them.
test.describe("the holiday display fonts", () => {
  const ORDINARY = { year: 2026, month: 3, day: 3 } as const;
  const DAYS = [
    { year: 2026, month: 10, day: 31 },
    ...HOLIDAYS,
  ] as const;

  /** The font files a page at this instant asks for. */
  const fontsFetchedOn = async (page: Page, at: Date): Promise<Set<string>> => {
    const fonts = new Set<string>();
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (/\.(woff2?|ttf|otf)$/.test(pathname)) fonts.add(pathname);
    });
    await open(page, at);
    return fonts;
  };

  test("are fetched on their own day and on no other", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const zone = await petZone(request);
    const fetchedOn = async (year: number, month: number, day: number): Promise<Set<string>> => {
      const context = await browser.newContext();
      const fonts = await fontsFetchedOn(await context.newPage(), instantIn(zone, year, month, day, 12));
      await context.close();
      return fonts;
    };

    const ordinary = await fetchedOn(ORDINARY.year, ORDINARY.month, ORDINARY.day);
    expect(ordinary.size, "the everyday faces load").toBeGreaterThan(0);

    const own: Set<string>[] = [];
    for (const { year, month, day } of DAYS) {
      const holiday = await fetchedOn(year, month, day);
      // Whatever an ordinary page fetches, a holiday page fetches too: the
      // everyday faces are the shared ones, and no holiday face is among them.
      for (const font of ordinary) expect(holiday.has(font), `${year}-${month}-${day} drops ${font}`).toBe(true);
      const display = new Set([...holiday].filter((font) => !ordinary.has(font)));
      expect(display.size, `${year}-${month}-${day} fetches its own display face`).toBeGreaterThan(0);
      own.push(display);
    }
    // And only its own: no two holidays fetched the same extra file, so no
    // page has pulled another day's face.
    const everything = own.flatMap((fonts) => [...fonts]);
    expect(new Set(everything).size).toBe(everything.length);
  });
});
