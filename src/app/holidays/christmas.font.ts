// The heading face Christmas puts on (SPEC §22.11). On its own, apart from
// the icon table, because next/font only resolves inside Next's build: the
// unit tests and the client import christmas.ts for its data, and must not
// pull a font loader in with it.

import { Mountains_of_Christmas } from "next/font/google";

/**
 * Mountains of Christmas is the one Google Fonts face that is a Christmas
 * card by itself — a hand-lettered serif with snow-capped strokes — and it
 * ships a real 700, so the bold the headings ask for is a drawn weight, not
 * a synthesised one, and a pet's name in it still reads at phone width. It
 * runs light and a little narrow, so the headings step up a size.
 *
 * `preload: false` keeps it off every other day, as with Halloween's face:
 * the @font-face lands in the stylesheet, but a browser only fetches a font
 * file once text is set in it, and nothing is until the root carries the
 * holiday attribute.
 */
export const christmasDisplay = Mountains_of_Christmas({
  weight: "700",
  subsets: ["latin"],
  variable: "--font-christmas",
  display: "swap",
  preload: false,
});
