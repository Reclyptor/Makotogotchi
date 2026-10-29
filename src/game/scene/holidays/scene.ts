// What a holiday does to the room (SPEC §22.11): its own theme in place of the
// home theme, its own props in place of the communal decor, a costume for
// Makoto, and the touches the window gets at night. The art and the
// per-holiday data live beside this file; `index.ts` maps each id to its scene.

import type { HolidayId } from "../../../sim/holidays";
import type { FrameName } from "../../atlas.generated";
import type { RGB, RoomTheme } from "../backdrop/theme";
import type { Garment } from "../garment";

export type HolidayProp = {
  /** An art/holiday sprite. */
  frame: FrameName;
  /** Room space, where `renderDecor` places decor; the sprite's bottom-centre (`drawRect`). */
  x: number;
  y: number;
  /** Behind the pet, or in front of it. */
  layer: "behind" | "front";
  /** A candle or lantern glow that pulses live. */
  flicker?: true;
};

export type HolidayScene = {
  id: HolidayId;
  theme: RoomTheme;
  props: readonly HolidayProp[];
  /** `staff` replaces a Sage's cane at the same anchor (SPEC §21.9). */
  costume: { hat: FrameName; robe: Garment; staff?: FrameName };
  /**
   * Night sky touches. `fireworks` is the palette of the bursts that light the
   * window around midnight on New Year's Eve (`fireworksAt`), the first colour
   * being the one a held burst under reduced motion takes.
   */
  window: { bats: boolean; moon: RGB | null; fireworks?: readonly RGB[] };
};
