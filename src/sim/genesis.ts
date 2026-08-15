// The state a generation starts from: an unhatched egg. Needs and health are
// set here for shape-completeness but stay frozen until the HATCHED event
// resets them (SPEC §2.8, §2.10).

import type { Generation, PetState } from "./model";
import { HEALTH_MAX, NEED_MAX } from "./tuning";

export const genesis = (generation: Generation): PetState => ({
  generation,
  tick: 0,
  bornAtTick: null,
  diedAtTick: null,
  causeOfDeath: null,
  form: null,
  needs: { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX },
  healthRaw: HEALTH_MAX,
  asleep: false,
  sleepReason: null,
  sick: false,
  sickSinceTick: null,
  careNum: 0,
  careTicks: 0,
  lastActionTick: {},
  caretakers: [],
  toys: [],
});
