// Valentine's Day (SPEC §22.11): Makoto's room for the day, and the crooner
// he spends it as. The props are art/holiday sprites; the art itself and the
// sheet it is packed onto come from `npm run atlas`.
//
// Placement follows Halloween's rule: his centre wanders x 108–152 and his
// feet reach the rug's span exactly (room.ts wanderBand), so the floor props
// keep to the front corners outside the rug and to the back strip against
// the wainscot, and the wall props stay above his ears. The front corners
// draw in front of him, the back wall behind him.

import type { RoomTheme } from "../backdrop/theme";
import type { Garment } from "../garment";
import type { HolidayScene } from "./scene";

// A midnight lounge: navy walls over walnut and brass, a crimson rug with a
// brass motif. Hue shifted like the rest (§22.5): the wall's shadows go
// indigo and its light goes teal-blue, the wood's highlights go brass, and
// the one crimson in the room — the rug, the rose on the piano, the jacket —
// is the only warm red, so it reads as the night's colour and not as
// Christmas. Nothing pink anywhere.
export const VALENTINES_THEME: RoomTheme = {
  id: "valentines",
  label: "Midnight Lounge",
  wall: [
    [14, 18, 44],
    [26, 34, 74],
    [44, 66, 112],
  ],
  stripe: [22, 28, 62],
  rail: { body: [74, 46, 30], highlight: [160, 118, 52] },
  wainscot: { panel: [62, 38, 26], groove: [40, 24, 16], highlight: [92, 60, 38], base: [34, 20, 14] },
  floor: [
    [40, 30, 34],
    [52, 40, 44],
    [66, 52, 56],
  ],
  seam: [30, 22, 26],
  sunPool: [196, 150, 80],
  moonPool: [58, 76, 128],
  rug: { border: [120, 22, 38], field: [92, 16, 30], motif: [196, 150, 60], fringe: [160, 118, 52] },
  frame: { dark: [40, 26, 18], mid: [74, 46, 30], light: [120, 86, 52] },
  outside: "town",
};

// The burgundy velvet smoking jacket, worn open (SPEC §22.12): the velvet
// fills the body and the arms, a black line across the shoulders is the
// jacket's top edge, and there is no collar band, so the collar colour is the
// velvet itself. The front is a V of fur down the body's centre that widens
// toward the hem — one column wide for the three rows under the neckline,
// three for the next three, five below — with the shawl lapel in near-black
// along either edge; the same near-black makes the cuffs, above bare paws.
// No tails and a plain hem: a smoking jacket hangs straight.
//
// The opening is a front pattern: f where the fur shows, k the black edge on
// either side of it, t the lapel's grey outside that. Each row is built from
// the body's centre column and the opening's half-width, so the V is easy to
// read: half-width 0 for three rows, 1 for three, then 2 from there down.
const LAPEL = [70, 70, 80] as const;
const CUFF = [34, 34, 40] as const;

/** One row of the V, centred on `centre` and `half` columns either side of it. */
const vRow = (centre: number, half: number): string =>
  ".".repeat(centre - half - 2) + "tk" + "f".repeat(half * 2 + 1) + "kt";

const openingRows = (centre: number): string[] => [0, 0, 0, 1, 1, 1].map((half) => vRow(centre, half));

export const SMOKING_JACKET: Garment = {
  ramp: {
    cloth: [138, 30, 52],
    collar: [138, 30, 52],
    trim: LAPEL,
    line: [0, 0, 0],
    cuff: CUFF,
  },
  slit: null,
  cuffs: true,
  tails: false,
  hemPattern: null,
  frontPattern: {
    front: { rows: openingRows(10), rest: vRow(10, 2) },
    side: { rows: openingRows(9), rest: vRow(9, 2) },
    // A pose in the lap closes the opening a few rows above the floor.
    sit: { rows: openingRows(10).concat(vRow(10, 2)).slice(0, 4) },
  },
};

export const VALENTINES_SCENE: HolidayScene = {
  id: "valentines",
  theme: VALENTINES_THEME,
  props: [
    // Two gold records framed on the wall left of the window, above his ears.
    { frame: "valentinesRecords", x: 74, y: 33, layer: "behind" },
    // The brass sconce on the sliver of wall right of the window; the one
    // prop that flickers.
    { frame: "valentinesSconce", x: 240, y: 52, layer: "behind", flicker: true },
    // The bottle and the martini on the sill, in front of the glass.
    { frame: "valentinesCocktail", x: 184, y: 66, layer: "behind" },
    // The LIVE sign on the left wall under the records, above the piano.
    { frame: "valentinesSign", x: 74, y: 75, layer: "behind" },
    // The upright piano in the back-left corner, against the wainscot and
    // clear of the rug's edge, a single red rose lying on its lid.
    { frame: "valentinesPiano", x: 35, y: 157, layer: "behind" },
    // The front corners, outside the rug: the bar stool and its whisky on
    // the left, the sax on its stand on the right.
    { frame: "valentinesStool", x: 31, y: 198, layer: "front" },
    { frame: "valentinesSax", x: 236, y: 198, layer: "front" },
  ],
  costume: { hat: "valentinesFedora", robe: SMOKING_JACKET, staff: "valentinesMicStand" },
  // A cold city moon, and nothing crossing it.
  window: { bats: false, moon: [226, 234, 255] },
};
