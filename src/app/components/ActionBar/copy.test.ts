// The tile labels stay tile-sized (SPEC §11.3).
//
// Measured against the real control at the narrowest phone the layout targets
// (a 3-across grid on a 280px viewport): the reason line gets an 85px box, and
// at 10px every character costs roughly 5.5px. "Makoto is asleep" wanted 82px
// and clipped; "Bartholomew is asleep" — the pet is community-named, so the
// old label's width was partly up to the players — wanted 107px and clipped
// even on a 320px screen. Everything here is 62px or less.
//
// A cap of 12 is not a style preference. It is the width of the box.

import { describe, expect, it } from "vitest";
import { REASON_GLYPH, REASON_SHORT, rejectionText } from "./copy";

const MAX_TILE_CHARS = 12;

describe("care reason copy", () => {
  it("keeps every tile label inside the tile", () => {
    for (const [reason, label] of Object.entries(REASON_SHORT)) {
      expect(label.length, `${reason} is too long for a care tile`).toBeLessThanOrEqual(MAX_TILE_CHARS);
      expect(label.length, `${reason} has no text`).toBeGreaterThan(0);
    }
  });

  it("leaves the pet's name out of the tile, since the tile cannot afford it", () => {
    // The long form is where the name belongs; a name of any length there is
    // fine because it goes in the accessible name and the tooltip.
    const named = rejectionText("Bartholomew");
    expect(Object.values(named).some((text) => text.includes("Bartholomew"))).toBe(true);
    for (const label of Object.values(REASON_SHORT)) {
      expect(label).not.toContain("Bartholomew");
    }
  });

  it("covers exactly the reasons the long form covers", () => {
    // Both are Records over LockReason, so a new reason is a type error in
    // both — this catches the subtler case of the two drifting in meaning by
    // asserting they are keyed identically at runtime too.
    expect(Object.keys(REASON_SHORT).sort()).toEqual(Object.keys(rejectionText("Makoto")).sort());
    for (const reason of Object.keys(REASON_GLYPH)) {
      expect(REASON_SHORT).toHaveProperty(reason);
    }
  });
});
