// Room styles are communal property (SPEC §22.5): funded once, owned by the
// room forever, and never wearable before they are paid for.
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, ownedThemes } from "./shop";

describe("room style ownership", () => {
  it("always owns the default style", () => {
    expect(ownedThemes([])).toEqual([DEFAULT_THEME]);
    expect(ownedThemes(["plant", "lamp"])).toEqual([DEFAULT_THEME]);
  });

  it("owns exactly the styles the room has funded", () => {
    expect(ownedThemes(["theme_cabin"])).toEqual([DEFAULT_THEME, "cabin"]);
    expect(ownedThemes(["window_seat", "theme_seaside", "theme_cabin"]).sort()).toEqual(
      [DEFAULT_THEME, "cabin", "seaside"].sort(),
    );
  });

  it("does not mistake ordinary decor for a style", () => {
    expect(ownedThemes(["aquarium", "kotatsu", "picture"])).toEqual([DEFAULT_THEME]);
  });
});
