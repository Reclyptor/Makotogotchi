// Thanksgiving's dress-up for the page itself (SPEC §22.11): the care icons
// the buttons and the feed wear for the day. The heading face is in
// thanksgiving.font.ts, and the colours, the sprigs and the leaves are in
// thanksgiving.css, scoped under [data-holiday="thanksgiving"]; nothing here
// is read on any other day.

import type { CareAction } from "@/sim/tuning";

/**
 * What each care button shows instead of its usual emoji. The labels and the
 * accessible names are untouched; only the glyph changes, so every icon has
 * to carry the same meaning its everyday one does: a slice of pie for
 * feeding, a football to play with (the afternoon game), a sponge for the
 * dishes, a candle to blow out at bedtime, a brown heart in place of the
 * yellow one, and a warm cup of something instead of a pill.
 */
export const THANKSGIVING_ICONS: Record<CareAction, string> = {
  FEED: "🥧",
  PLAY: "🏈",
  CLEAN: "🧽",
  LULLABY: "🕯️",
  PET: "🤎",
  MEDICATE: "🍵",
};
