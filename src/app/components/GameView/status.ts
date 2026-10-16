// The one line under the canvas that says how the pet is (SPEC §11.7). It
// used to read only the ailments, and health is not an ailment: a pet nursed
// back from the brink has every need met and a 1% health meter, and was
// "doing fine" for the day it took to climb back. Now the line is built from
// the whole of the pet's state, most important fact first. Health gets its
// own sentence after that — which way it is moving and why — so a player can
// see what to fix rather than watch the meter and guess.

import type { Ailment, DerivedState, HealthView } from "@/sim/derive";
import type { PetState, ProjectionContext } from "@/sim/model";
import { CRITICAL_PERCENT } from "@/app/components/Meters/critical";
import { CAUSE_OF_DEATH_TEXT } from "@/app/copy/death";
import {
  ENERGY_SLEEP_RECOVERY,
  NAP_WAKE_THRESHOLD,
  NEED_KEYS,
  NEED_MAX,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  type LifeStage,
  type NeedKey,
} from "@/sim/tuning";

/** A need this far down gets a mention before it becomes an ailment. */
export const SLIPPING_BELOW = NEED_MAX / 2;

/**
 * The status line as the page lays it out: a sentence, and for elders a small
 * fragment the page sets quieter than the sentence. Two fields rather than one
 * string so the page never has to cut a styled piece back out of the text.
 */
export type StatusView = {
  text: string;
  /** "needs 72% · at 81%": today's hold line, then where the needs average now. */
  elder: string | null;
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

/**
 * Ticks until the pet wakes, or null if that is not knowable.
 *
 * A duration rather than a time of day, which is the whole point: the pet
 * keeps one home timezone and its carers do not, so "wakes at 06:00" answers
 * the wrong question for most of the room while "wakes in 3h" answers it for
 * everyone. Players were left refreshing a sleeping pet and concluding it was
 * broken — *"ok is Makoto bugged? He STILL doesn't want anything from me"* —
 * when the honest answer was a number nobody was being shown.
 *
 * The night ends on the clock, so it reads the schedule. A nap ends on energy,
 * so it reads the recovery rate — exactly, since recovery is a fixed amount
 * per sleeping tick (SPEC §2.7) and nothing else moves energy while asleep.
 */
export const ticksUntilWake = (state: PetState, ctx: ProjectionContext): number | null => {
  if (!state.asleep) return null;
  if (state.sleepReason === "NIGHT") {
    const wake = ctx.schedule.boundaries.find((boundary) => boundary.phase === "WAKE" && boundary.tick > state.tick);
    return wake ? wake.tick - state.tick : null;
  }
  const missing = NAP_WAKE_THRESHOLD - state.needs.energy;
  return missing <= 0 ? 0 : Math.ceil(missing / ENERGY_SLEEP_RECOVERY);
};

/** "3h 20m", "45m", "any moment now" — never a clock time (see above). */
export const untilWakeText = (ticks: number): string => {
  const minutes = Math.round((ticks * 10) / 60);
  if (minutes < 2) return "any moment now";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`;
};

const sleeping = (state: PetState, ctx?: ProjectionContext): string => {
  const until = ctx ? ticksUntilWake(state, ctx) : null;
  const wakes = until === null ? "" : ` Wakes ${untilWakeText(until)}.`;
  switch (state.sleepReason) {
    case "NIGHT":
      return `is asleep for the night.${wakes}`;
    case "NAP":
      return `is napping until the energy comes back.${wakes}`;
    case "LULLABY":
      return `was sung to sleep.${wakes}`;
    default:
      return `is asleep.${wakes}`;
  }
};

/** Which way health is moving and why; null when there is nothing to say. */
const healthSentence = ({ reason, elder }: HealthView): string | null => {
  switch (reason.kind) {
    case "need":
      return `Health is falling: ${reason.need} is below ${CRITICAL_PERCENT}%.`;
    case "sick":
      return "Health is falling: sickness.";
    case "age":
      return elder
        ? `Health is falling with age: needs average ${elder.meanPercent}%, today's line is ${elder.linePercent}%.`
        : "Health is falling with age.";
    case "regen":
      return "Health is coming back.";
    case "holding":
      return "Health is holding steady.";
    case "full":
      return null;
  }
};

/**
 * An elder's line and average sit beside the health sentence, even while
 * health is rising. Falling with age already spells both numbers out.
 */
const elderFragment = ({ reason, elder }: HealthView): string | null =>
  elder && reason.kind !== "age" ? `needs ${elder.linePercent}% · at ${elder.meanPercent}%` : null;

const headline = (
  petName: string,
  state: PetState,
  derived: DerivedState,
  stage: Exclude<LifeStage, "EGG">,
  ctx: ProjectionContext | undefined,
): string => {
  if (state.asleep) return `${petName} ${sleeping(state, ctx)}`;
  const ailment = ailing(state, derived);
  if (ailment) return `${petName} ${ailment}`;
  if (derived.vitality === "fading") return `${petName} is fading.`;
  if (derived.vitality === "recovering") return `${petName} is weak.`;
  if (derived.vitality === "frail") return `${petName} is dangerously weak.`;
  const low = slipping(state);
  if (low) return `${petName} ${SLIPPING_LINE[low]}`;
  return `${petName} ${WELL_LINE[stage]}`;
};

export const statusLine = (
  petName: string,
  state: PetState,
  derived: DerivedState,
  /** Optional: with it, a sleeping pet says how long it has left. */
  ctx?: ProjectionContext,
): StatusView => {
  if (state.diedAtTick !== null) {
    const how = state.causeOfDeath ? CAUSE_OF_DEATH_TEXT[state.causeOfDeath] : "has died";
    return { text: `${petName} ${how}. A new egg will appear soon.`, elder: null };
  }
  const { stage } = derived;
  if (stage === "EGG") return { text: "The egg is incubating…", elder: null };
  const health = healthSentence(derived.health);
  const head = headline(petName, state, derived, stage, ctx);
  return { text: health ? `${head} ${health}` : head, elder: elderFragment(derived.health) };
};
