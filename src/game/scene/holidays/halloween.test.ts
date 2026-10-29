// The Halloween costume's staff (SPEC §21.9): the wizard's finish, standing in
// for the Sage's cane on the day.

import { describe, expect, it } from "vitest";
import { SPRITE_FRAMES } from "../../atlas.generated";
import { HALLOWEEN_SCENE } from "./halloween";

describe("the Halloween costume", () => {
  it("gives a Sage the wizard staff, a packed frame", () => {
    expect(HALLOWEEN_SCENE.costume.staff).toBe("wizardStaff");
    expect(SPRITE_FRAMES.wizardStaff.h).toBeGreaterThan(SPRITE_FRAMES.sageCane.h);
  });
});
