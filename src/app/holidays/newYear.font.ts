// The heading face New Year's Day puts on (SPEC §22.11). On its own, apart
// from the icon table, because next/font only resolves inside Next's build:
// the unit tests and the client import newYear.ts for its data, and must not
// pull a font loader in with it.

import { Limelight } from "next/font/google";

/**
 * Limelight is the art-deco display face on Google Fonts — a gala poster's
 * lettering — that is also a heavy, plain-shaped sans underneath, so a pet's
 * name in it still reads at phone width; the alternatives (Monoton, Poiret
 * One) are drawn in hairlines that vanish over frosted glass.
 *
 * `preload: false` keeps it off every other day: the @font-face lands in the
 * stylesheet, but a browser only fetches a font file once text is set in it,
 * and nothing is until the root carries the holiday attribute. The rest of
 * the year pays for one @font-face rule and nothing else.
 */
export const newYearDisplay = Limelight({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-new-year",
  display: "swap",
  preload: false,
});
