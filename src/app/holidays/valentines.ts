// Valentine's Day's dress-up for the page itself (SPEC §22.11): the care
// icons the buttons and the feed wear for the day. The heading face is in
// valentines.font.ts, and the colours, the spotlight and the brass are in
// valentines.css, scoped under [data-holiday="valentines"]; nothing here is
// read on any other day.

import type { CareAction } from "@/sim/tuning";

/**
 * What each care button shows instead of its usual emoji. The labels and the
 * accessible names are untouched; only the glyph changes, so every icon has
 * to carry the same meaning its everyday one does: a dinner for feeding, the
 * piano to play, bubbles for sweeping up, a sax serenade for bedtime, a red
 * rose in place of the yellow heart, and a plaster for the sniffles instead
 * of a pill.
 */
export const VALENTINES_ICONS: Record<CareAction, string> = {
  FEED: "🍽️",
  PLAY: "🎹",
  CLEAN: "🫧",
  LULLABY: "🎷",
  PET: "🌹",
  MEDICATE: "🩹",
};
