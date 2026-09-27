// How the pet's stage and age are said (SPEC §11.2) — on the main screen and
// on the link card, which must not disagree about how old Makoto is.

import type { PetState } from "./model";
import { TICKS_PER_DAY, TICKS_PER_HOUR } from "./tuning";

export const STAGE_LABELS: Record<string, string> = {
  EGG: "Egg",
  HATCHLING: "Hatchling",
  PUP: "Pup",
  JUVENILE: "Juvenile",
  ADULT: "Adult",
  ELDER: "Elder",
};

export const ageText = (state: PetState): string => {
  if (state.bornAtTick === null) return "incubating";
  const ticks = state.tick - state.bornAtTick;
  const days = Math.floor(ticks / TICKS_PER_DAY);
  const hours = Math.floor((ticks % TICKS_PER_DAY) / TICKS_PER_HOUR);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
};
