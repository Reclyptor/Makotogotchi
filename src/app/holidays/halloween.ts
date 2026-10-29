// Halloween's dress-up for the page itself (SPEC §22.11): the care icons the
// buttons and the feed wear for the day. The heading face is in
// halloween.font.ts, and the colours, the cobwebs and the bats are in
// halloween.css, scoped under [data-holiday="halloween"]; nothing here is
// read on any other day.

import type { CareAction } from "@/sim/tuning";

/**
 * What each care button shows instead of its usual emoji. The labels and the
 * accessible names are untouched; only the glyph changes, so every icon has
 * to carry the same meaning its everyday one does: a treat for feeding, a
 * ghost to play with, a witch's broom to sweep, the moon for bedtime, an
 * orange heart in place of the yellow one, and a potion instead of a pill.
 */
export const HALLOWEEN_ICONS: Record<CareAction, string> = {
  FEED: "🍬",
  PLAY: "👻",
  CLEAN: "🧹",
  LULLABY: "🌙",
  PET: "🧡",
  MEDICATE: "🧪",
};
