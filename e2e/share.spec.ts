// The shared link carries the pet's state (SPEC §21.7): the description says
// how Makoto is doing, and the card beside it is drawn live.

import { test, expect } from "@playwright/test";

test.describe("sharing a link", () => {
  test("the page description and card are live, not a still", async ({ request }, testInfo) => {
    const home = await request.get("/?goal=1-2");
    expect(home.ok()).toBe(true);
    const html = await home.text();
    const description = /<meta property="og:description" content="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(description).toMatch(/Makoto/);
    expect(description).toMatch(/Hunger \d+%/);
    expect(html).toMatch(/<meta property="og:image" content="[^"]*opengraph-image/);

    const card = await request.get("/opengraph-image");
    expect(card.ok()).toBe(true);
    expect(card.headers()["content-type"]).toBe("image/png");
    const body = await card.body();
    expect(body.byteLength).toBeGreaterThan(10_000);
    // Kept with the run so the card can be looked at, not only measured.
    await testInfo.attach("card", { body, contentType: "image/png" });
  });

  test("the goal banner offers a share button that copies a link", async ({ browser }) => {
    const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText(/live/, { timeout: 15_000 });
    const share = page.getByRole("button", { name: "Share today's goal" });
    await expect(share).toBeVisible({ timeout: 15_000 });
    await share.click();
    await expect(page.getByText(/Copied/)).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^http:\/\/localhost:\d+\/\?goal=\d+-\d+$/);
    await context.close();
  });
});
