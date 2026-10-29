// The heading face Halloween puts on (SPEC §22.11). On its own, apart from
// the icon table, because next/font only resolves inside Next's build: the
// unit tests and the client import halloween.ts for its data, and must not
// pull a font loader in with it.

import { Creepster } from "next/font/google";

/**
 * Creepster is the one dripping-horror face on Google Fonts that is also a
 * heavy, plain-shaped sans underneath, so a pet's name in it still reads at
 * phone width; the alternatives (Nosifer, Eater) trade their letterforms
 * for the drips.
 *
 * `preload: false` keeps it off every other day: the @font-face lands in the
 * stylesheet, but a browser only fetches a font file once text is set in it,
 * and nothing is until the root carries the holiday attribute. The rest of
 * the year pays for one @font-face rule and nothing else.
 */
export const halloweenDisplay = Creepster({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-halloween",
  display: "swap",
  preload: false,
});
