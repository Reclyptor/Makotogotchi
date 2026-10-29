// The holiday's care icons reach the feed whenever the holiday becomes known
// (SPEC §22.11), so a line that arrived before it is dressed too.

import { describe, expect, it } from "vitest";
import { HALLOWEEN_ICONS } from "@/app/holidays/halloween";
import { HOLIDAYS } from "@/sim/holidays";
import { careIcon, dressFeed, HOLIDAY_COPY, stayingHomeLine } from "./holidays";

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

describe("every holiday's words", () => {
  it.each(HOLIDAYS.map((holiday) => holiday.id))("%s has a caption, a feed line, an icon for every care and a colour for the chrome", (id) => {
    const copy = HOLIDAY_COPY[id];
    expect(copy.caption).toContain(copy.icon);
    expect(copy.dressedUp("Makoto")).toContain("Makoto");
    expect(Object.keys(copy.careIcons).sort()).toEqual(["CLEAN", "FEED", "LULLABY", "MEDICATE", "PET", "PLAY"]);
    expect(copy.themeColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(stayingHomeLine(id)).toBe(`Makoto is staying home for ${copy.name}.`);
  });

  it("gives every holiday care icons of its own, apart from the everyday ones", () => {
    const usual = ["🍖", "🎮", "🌪️", "💛", "🎵", "💊"];
    for (const holiday of HOLIDAYS) {
      const icons = Object.values(HOLIDAY_COPY[holiday.id].careIcons);
      expect(icons.some((icon) => usual.includes(icon)), holiday.id).toBe(false);
    }
  });
});
