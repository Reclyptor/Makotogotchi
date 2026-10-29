// The heading face Valentine's Day puts on (SPEC §22.11). On its own, apart
// from the icon table, because next/font only resolves inside Next's build:
// the unit tests and the client import valentines.ts for its data, and must
// not pull a font loader in with it.

import { Abril_Fatface } from "next/font/google";

/**
 * Abril Fatface is the jazz-poster face: a heavy didone whose capitals
 * carry the all-caps wordmark as a word, and a pet's name in it still reads
 * at phone width. It ships one weight, a heavy 400, so the headings ask for
 * 400 by name rather than let the browser embolden it a second time.
 *
 * `preload: false` keeps it off every other day, as with Halloween's face:
 * the @font-face lands in the stylesheet, but a browser only fetches a font
 * file once text is set in it, and nothing is until the root carries the
 * holiday attribute.
 */
export const valentinesDisplay = Abril_Fatface({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-valentines",
  display: "swap",
  preload: false,
});
