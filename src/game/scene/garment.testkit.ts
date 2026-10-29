// A garment with the cloak's optional pieces, for the tests that need one: the
// shape of the Sage cloak's reference prototype, in colours no real scene uses so a
// test can tell its cloth from anything else on the canvas.

import type { Garment } from "./garment";

export const TEST_GARMENT: Garment = {
  ramp: {
    cloth: [10, 200, 30],
    collar: [20, 210, 40],
    trim: [30, 220, 50],
    line: [1, 2, 3],
  },
  slit: { side: [7, 11], front: [8, 12] },
  cuffs: true,
  tails: true,
  hemPattern: null,
};
