// Halloween (SPEC §22.11): Makoto's room for the one night, and the wizard
// he spends it as. The props are art/holiday sprites; the art itself and the
// sheet it is packed onto come from `npm run atlas`.
//
// Where things stand is set by where Makoto does not: his centre wanders
// x 108–152 and his feet reach the rug's span exactly (room.ts wanderBand),
// so the floor props keep to the front corners outside the rug and to the
// back strip against the wainscot, and the wall props stay above his ears.
// Everything on the floor in front of the rug is drawn in front of him, and
// everything against the back wall behind him, which is how the room already
// reads its depth.

import type { RoomTheme } from "../backdrop/theme";
import type { Garment } from "../garment";
import type { HolidayScene } from "./scene";

// Dusk plums for the walls and a floor the pumpkins warm, with the rug the
// one saturated orange. Hue shifted like the rest (§22.5): the wall's shadows
// go blue-violet and its light goes rose, so the pet's grey and the Sage's
// white keep reading against it, and the costume's midnight blue separates
// from the wall by hue rather than by value alone.
export const HALLOWEEN_THEME: RoomTheme = {
  id: "halloween",
  label: "Halloween Night",
  wall: [
    [34, 16, 52],
    [62, 32, 88],
    [98, 54, 122],
  ],
  stripe: [78, 42, 104],
  rail: { body: [76, 44, 84], highlight: [118, 76, 122] },
  wainscot: { panel: [58, 32, 74], groove: [40, 22, 52], highlight: [84, 52, 100], base: [34, 18, 44] },
  floor: [
    [60, 36, 50],
    [78, 48, 60],
    [100, 62, 72],
  ],
  seam: [46, 26, 42],
  sunPool: [156, 100, 68],
  moonPool: [76, 60, 108],
  rug: { border: [158, 82, 42], field: [116, 58, 38], motif: [196, 118, 56], fringe: [210, 156, 94] },
  frame: { dark: [56, 38, 40], mid: [86, 60, 56], light: [118, 86, 72] },
  outside: "town",
};

// The wizard robe, worn (SPEC §22.12): midnight blue closed down the front,
// with the hat band's gold at the collar and the cuffs so the costume is one
// palette, and gold stars scattered over the skirt. The stars are the hem
// pattern — five rows, repeating every ten body columns, mostly left as
// cloth — placed so they fall on the sides where the beard does not hang and
// along the hem row. No tails, but a floor-length skirt: the robe falls to the
// floor over the legs, and only the toes show beneath it.
const GOLD = [232, 199, 106] as const;
export const WIZARD_ROBE: Garment = {
  ramp: {
    cloth: [58, 54, 150],
    collar: GOLD,
    trim: GOLD,
    line: [0, 0, 0],
  },
  slit: null,
  cuffs: true,
  tails: false,
  skirt: true,
  hemPattern: [
    "........t.",
    "..t.......",
    "..........",
    ".........t",
    "...t....t.",
  ],
};

export const HALLOWEEN_SCENE: HolidayScene = {
  id: "halloween",
  theme: HALLOWEEN_THEME,
  props: [
    // The top corners, either side of the window: the larger web has the
    // whole left corner, the smaller the sliver of wall right of the frame.
    { frame: "cobwebLeft", x: 28, y: 55, layer: "behind" },
    { frame: "cobwebRight", x: 238, y: 44, layer: "behind" },
    // A garland strung along the ceiling between the web and the window.
    { frame: "batGarland", x: 100, y: 33, layer: "behind" },
    // Two candles standing on the picture rail, one at each end of the room:
    // the rail is the one ledge that keeps them clear of the glass (anything
    // taller than the frame's bottom bar covers the pane from the sill), and
    // his ears never reach that far into either corner.
    { frame: "candleTall", x: 36, y: 96, layer: "behind", flicker: true },
    { frame: "candle", x: 240, y: 96, layer: "behind", flicker: true },
    // The back floor strip, against the wainscot: a spare pumpkin left, the
    // cauldron right, both behind him when he walks past.
    { frame: "pumpkinSmall", x: 22, y: 160, layer: "behind" },
    { frame: "cauldron", x: 234, y: 158, layer: "behind" },
    // The front corners, outside the rug: the carved pumpkins, nearer the
    // viewer than he ever stands.
    { frame: "pumpkinFace", x: 30, y: 198, layer: "front", flicker: true },
    { frame: "pumpkinGrin", x: 238, y: 198, layer: "front", flicker: true },
  ],
  costume: { hat: "wizardHat", robe: WIZARD_ROBE },
  // A harvest moon, and bats across it.
  window: { bats: true, moon: [255, 210, 130] },
};
