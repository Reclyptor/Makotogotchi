// Christmas (SPEC §22.11): Makoto's room for the day, and the Santa he spends
// it as. The props, the hat and the candy cane are sprites; the art itself
// and the sheet it is packed onto come from `npm run atlas`. The coat is a
// garment (§22.12), drawn from each pose's own body.
//
// Placement follows Halloween's rule: his centre wanders x 108–152 and his
// feet reach the rug's span exactly (room.ts wanderBand), so the floor props
// keep to the front corners outside the rug and to the back strip against
// the wainscot, and the wall props stay above his ears. The front corners
// draw in front of him, the back wall behind him.

import type { RGB, RoomTheme } from "../backdrop/theme";
import type { Garment } from "../garment";
import type { HolidayScene } from "./scene";

// Pine-green walls over honey wood, a cranberry rug with a gold motif. Hue
// shifted like the rest (§22.5): the wall's shadows go blue-green and its
// light goes yellow-green, so the garland and the tree (a brighter, warmer
// green, outlined) stand off it, and the red of the coat and the presents is
// the one thing in the room that isn't green or wood.
export const CHRISTMAS_THEME: RoomTheme = {
  id: "christmas",
  label: "Christmas Morning",
  wall: [
    [18, 42, 40],
    [32, 68, 54],
    [56, 102, 72],
  ],
  stripe: [42, 80, 62],
  rail: { body: [104, 64, 40], highlight: [148, 100, 58] },
  wainscot: { panel: [78, 48, 34], groove: [54, 32, 24], highlight: [104, 68, 44], base: [46, 26, 20] },
  floor: [
    [76, 50, 36],
    [96, 64, 44],
    [118, 82, 54],
  ],
  seam: [58, 38, 28],
  sunPool: [176, 138, 84],
  moonPool: [84, 94, 128],
  rug: { border: [150, 34, 40], field: [118, 26, 34], motif: [214, 164, 72], fringe: [222, 196, 140] },
  frame: { dark: [54, 36, 28], mid: [92, 62, 42], light: [132, 94, 62] },
  outside: "forest",
};

// The Santa coat, worn (SPEC §22.12): the pose's fur below the chin in red,
// the arms as sleeves with cream cuffs and the paws out, a cream hem, and a
// black belt two rows above the hem with a gold buckle. The cream is the hat
// brim's, a shade under the beard's white. The collar is the coat's own red:
// the beard hides nearly all of it, and the cell or two it left showing at
// the body's edge read as stray light pixels. The collar's black line is
// what keeps the beard's white off the cloth. Closed front, no tails:
// Santa's coat is buttoned up.
const RED: RGB = [204, 40, 48];
const CREAM: RGB = [240, 232, 216];
export const SANTA_COAT: Garment = {
  ramp: {
    cloth: RED,
    collar: RED,
    trim: CREAM,
    line: [0, 0, 0],
  },
  slit: null,
  cuffs: true,
  belt: { belt: [0, 0, 0], buckle: [240, 196, 72] },
  tails: false,
  // The last row of cloth in cream, the whole way across.
  hemPattern: ["l"],
};

export const CHRISTMAS_SCENE: HolidayScene = {
  id: "christmas",
  theme: CHRISTMAS_THEME,
  props: [
    // The garland along the ceiling, left of the window, its bell at the dip.
    { frame: "christmasGarland", x: 72, y: 33, layer: "behind" },
    // The wreath on the sliver of wall right of the window frame.
    { frame: "christmasWreath", x: 238, y: 50, layer: "behind" },
    // Snow banked along the foot of the glass, inside the pane's own span,
    // and the plate left out for Santa at the right end of the sill, in
    // front of the glass, so the drift shows past it on the left.
    { frame: "christmasSnowPane", x: 184, y: 63, layer: "behind" },
    { frame: "christmasCookies", x: 200, y: 66, layer: "behind" },
    // Two stockings hung from under the sill.
    { frame: "christmasStockingRed", x: 166, y: 108, layer: "behind" },
    { frame: "christmasStockingGreen", x: 202, y: 108, layer: "behind" },
    // The tree in the back-left corner, against the wainscot, its lights
    // twinkling, and a small present at its foot, drawn after it so it sits
    // in front of the skirt.
    { frame: "christmasTree", x: 37, y: 160, layer: "behind", flicker: true },
    { frame: "christmasPresentSmall", x: 58, y: 157, layer: "behind" },
    // The front corners, outside the rug: the stack of presents nearer the
    // viewer than he ever stands, and one tall box on the right.
    { frame: "christmasPresents", x: 30, y: 198, layer: "front" },
    { frame: "christmasPresentTall", x: 234, y: 198, layer: "front" },
  ],
  costume: { hat: "christmasSantaHat", robe: SANTA_COAT, staff: "christmasCandyCane" },
  // A cold winter moon, and nothing crossing it.
  window: { bats: false, moon: [214, 230, 255] },
};
