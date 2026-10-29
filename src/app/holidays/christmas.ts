// Christmas's dress-up for the page itself (SPEC §22.11): the care icons the
// buttons and the feed wear for the day. The heading face is in
// christmas.font.ts, and the colours, the holly and the snow are in
// christmas.css, scoped under [data-holiday="christmas"]; nothing here is
// read on any other day.

import type { CareAction } from "@/sim/tuning";

/**
 * What each care button shows instead of its usual emoji. The labels and the
 * accessible names are untouched; only the glyph changes, so every icon has
 * to carry the same meaning its everyday one does: a cookie for feeding, a
 * present to play with, a sparkle for sweeping up (the tidy kind, not the
 * tinsel kind), a candle for bedtime, a heart with a ribbon on it in place
 * of the yellow one, and a hot drink for the sniffles instead of a pill.
 */
export const CHRISTMAS_ICONS: Record<CareAction, string> = {
  FEED: "🍪",
  PLAY: "🎁",
  CLEAN: "✨",
  LULLABY: "🕯️",
  PET: "💝",
  MEDICATE: "🍵",
};
