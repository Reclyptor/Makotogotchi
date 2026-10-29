// The heading face Thanksgiving puts on (SPEC §22.11). On its own, apart from
// the icon table, because next/font only resolves inside Next's build: the
// unit tests and the client import thanksgiving.ts for its data, and must
// not pull a font loader in with it.

import { Alfa_Slab_One } from "next/font/google";

/**
 * Alfa Slab One is a heavy wood-type slab serif — the face of a harvest
 * fair poster — with plain, open letterforms, so a pet's name in it still
 * reads at phone width; the showier slabs (Rye, Ultra) carry inlines and
 * hairlines that go to mud at 18px.
 *
 * `preload: false` keeps it off every other day: the @font-face lands in the
 * stylesheet, but a browser only fetches a font file once text is set in it,
 * and nothing is until the root carries the holiday attribute. The rest of
 * the year pays for one @font-face rule and nothing else.
 */
export const thanksgivingDisplay = Alfa_Slab_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-thanksgiving",
  display: "swap",
  preload: false,
});
