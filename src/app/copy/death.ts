// How a death is worded, in one place: the memorial wall and the status line
// under the canvas both say it, and they must say it the same way.

import type { CauseOfDeath } from "@/sim/model";

/** Past tense, subject omitted: "Makoto starved". */
export const CAUSE_OF_DEATH_TEXT: Record<CauseOfDeath, string> = {
  hunger: "starved",
  energy: "collapsed from exhaustion",
  hygiene: "wasted away in squalor",
  joy: "died of loneliness",
  sickness: "succumbed to illness",
  age: "passed peacefully of old age",
};
