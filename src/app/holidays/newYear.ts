// New Year's dress-up for the page itself (SPEC §22.11): the care icons the
// buttons and the feed wear for the day. The heading face is in
// newYear.font.ts, and the colours, the confetti and the streamers are in
// newYear.css, scoped under [data-holiday="newYear"]; nothing here is read on
// any other day.

import type { CareAction } from "@/sim/tuning";

/**
 * What each care button shows instead of its usual emoji. The labels and the
 * accessible names are untouched; only the glyph changes, so every icon has
 * to carry the same meaning its everyday one does: the New Year's bento for
 * feeding, a popper to play with, bubbles for the bath, a snooze for bedtime
 * (the night was long), a midnight-blue heart in place of the yellow one, and
 * a plaster instead of a pill.
 */
export const NEW_YEAR_ICONS: Record<CareAction, string> = {
  FEED: "🍱",
  PLAY: "🎉",
  CLEAN: "🫧",
  LULLABY: "💤",
  PET: "💙",
  MEDICATE: "🩹",
};
