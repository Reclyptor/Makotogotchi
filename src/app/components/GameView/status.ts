// The one line under the canvas that says how the pet is (SPEC §11.7). It
// used to read only the ailments, and health is not an ailment: a pet nursed
// back from the brink has every need met and a 1% health meter, and was
// "doing fine" for the day it took to climb back. Now the line is built from
// the whole of the pet's state, most important fact first.

import type { Ailment, DerivedState, Vitality } from "@/sim/derive";
import type { PetState } from "@/sim/model";
import { CAUSE_OF_DEATH_TEXT } from "@/app/copy/death";
import { NEED_KEYS, NEED_MAX, TICKS_PER_DAY, TICKS_PER_HOUR, type LifeStage, type NeedKey } from "@/sim/tuning";

/** A need this far down gets a mention before it becomes an ailment. */
export const SLIPPING_BELOW = NEED_MAX / 2;

const HEALTH_TAIL: Record<Vitality, string> = {
  well: "",
  recovering: " Health is coming back.",
  frail: " Health is dangerously low.",
};

/** Ailments as they read after "is", worst first. Sickness is worded on its own. */
const AILMENT_WORD: Record<Exclude<Ailment, "SICK">, string> = {
  STARVING: "starving",
  EXHAUSTED: "exhausted",
  FILTHY: "filthy",
  SAD: "sad",
};
const AILMENT_ORDER = ["STARVING", "EXHAUSTED", "FILTHY", "SAD"] as const;

const SLIPPING_LINE: Record<NeedKey, string> = {
  hunger: "is getting hungry.",
  energy: "is getting sleepy.",
  hygiene: "could use a bath.",
  joy: "is getting bored.",
};

const WELL_LINE: Record<Exclude<LifeStage, "EGG">, string> = {
  HATCHLING: "is small and curious.",
  PUP: "is full of beans.",
  JUVENILE: "is growing fast.",
  ADULT: "is doing fine.",
  ELDER: "is taking it slow.",
};

const list = (words: string[]): string =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

/** "has been sick for 3 hours", from the tick the sickness set in. */
const sickFor = (state: PetState): string => {
  const ticks = state.tick - (state.sickSinceTick ?? state.tick);
  const hours = Math.floor(ticks / TICKS_PER_HOUR);
  const days = Math.floor(ticks / TICKS_PER_DAY);
  if (hours < 1) return "just fell sick";
  if (days < 1) return `has been sick for ${hours} hour${hours === 1 ? "" : "s"}`;
  if (days === 1) return "has been sick since yesterday";
  return `has been sick for ${days} days`;
};

const ailing = (state: PetState, derived: DerivedState): string | null => {
  const words = AILMENT_ORDER.filter((ailment) => derived.ailments.includes(ailment)).map((a) => AILMENT_WORD[a]);
  const sick = derived.ailments.includes("SICK");
  if (words.length === 0 && !sick) return null;
  if (words.length === 0) return `${sickFor(state)}.`;
  return sick ? `is ${list(words)}, and ${sickFor(state)}.` : `is ${list(words)}.`;
};

const slipping = (state: PetState): NeedKey | null => {
  let lowest: NeedKey | null = null;
  for (const need of NEED_KEYS) {
    if (state.needs[need] < SLIPPING_BELOW && (lowest === null || state.needs[need] < state.needs[lowest])) lowest = need;
  }
  return lowest;
};

const sleeping = (state: PetState): string => {
  switch (state.sleepReason) {
    case "NIGHT":
      return "is asleep for the night.";
    case "NAP":
      return "is napping until the energy comes back.";
    case "LULLABY":
      return "was sung to sleep.";
    default:
      return "is asleep.";
  }
};

export const statusLine = (petName: string, state: PetState, derived: DerivedState): string => {
  if (state.diedAtTick !== null) {
    const how = state.causeOfDeath ? CAUSE_OF_DEATH_TEXT[state.causeOfDeath] : "has died";
    return `${petName} ${how}. A new egg will appear soon.`;
  }
  if (derived.stage === "EGG") return "The egg is incubating…";
  const tail = HEALTH_TAIL[derived.vitality];
  if (state.asleep) return `${petName} ${sleeping(state)}${tail}`;
  const ailment = ailing(state, derived);
  if (ailment) return `${petName} ${ailment}${tail}`;
  if (derived.vitality === "recovering") return `${petName} is recovering.`;
  if (derived.vitality === "frail") return `${petName} is dangerously weak.`;
  const low = slipping(state);
  if (low) return `${petName} ${SLIPPING_LINE[low]}`;
  return `${petName} ${WELL_LINE[derived.stage]}`;
};
