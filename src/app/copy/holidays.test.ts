// The holiday's care icons reach the feed whenever the holiday becomes known
// (SPEC §22.11), so a line that arrived before it is dressed too.

import { describe, expect, it } from "vitest";
import { HALLOWEEN_ICONS } from "@/app/holidays/halloween";
import { careIcon, dressFeed } from "./holidays";

const lines = [
  { id: 1, icon: "🌪️", care: "CLEAN" as const },
  { id: 2, icon: "💛", care: "PET" as const },
  { id: 3, icon: "🏅" },
];

describe("a holiday's feed", () => {
  it("swaps care lines to the table, and leaves every other line alone", () => {
    const dressed = dressFeed(lines, "halloween");
    expect(dressed.map((entry) => entry.icon)).toEqual([HALLOWEEN_ICONS.CLEAN, HALLOWEEN_ICONS.PET, "🏅"]);
  });

  it("dresses lines that arrived before the holiday was known", () => {
    expect(dressFeed(lines, null)).toBe(lines);
    expect(dressFeed(lines, "halloween")[0]!.icon).toBe(HALLOWEEN_ICONS.CLEAN);
  });

  it("leaves the stored lines as they came, so the usual icon returns with the day", () => {
    dressFeed(lines, "halloween");
    expect(lines[0]!.icon).toBe("🌪️");
    expect(dressFeed(lines, null)[0]!.icon).toBe("🌪️");
  });

  it("names the usual icon only when there is no holiday", () => {
    expect(careIcon("FEED", "🍖", null)).toBe("🍖");
    expect(careIcon("FEED", "🍖", "halloween")).toBe(HALLOWEEN_ICONS.FEED);
  });
});
