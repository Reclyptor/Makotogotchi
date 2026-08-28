// The daily communal quest (SPEC §21.7): one shared goal per pet-day, the
// same one for everybody, derived from the generation seed and the day index
// so no server has to decide it and no client has to be told.
//
// Progress is never stored. The server counts today's slice of the event log
// and hands the totals to questProgress, which is the only place the rules
// live — client, server, and tests all read the same arithmetic.
//
// A goal the whole room shares has to be a goal the whole room meets, so the
// bar answers the community twice: it grows by the same §23 multiplier the
// pet's appetite does, and it wants questHands(P) distinct caretakers on top
// of its own count. The second half is what makes soloing impossible —
// completion is a conjunction, not a sum, so a lone caretaker can serve fifty
// meals and still not finish the day.

import { careMultiplierPermille, DIFFICULTY_BASELINE } from "./difficulty";
import { draw32, RNG_PURPOSE } from "./rng";

export const QUEST_IDS = ["full-bellies", "game-night", "many-hands", "feast-day"] as const;
export type QuestId = (typeof QUEST_IDS)[number];

/** How a quest's bar answers the size of the community (SPEC §21.7). */
export type QuestGrowth =
  /** Scales by the §23 care multiplier, like the decay it exists to answer. */
  | "care"
  /** The bar *is* the number of caretakers. */
  | "hands"
  /** A meter percentage: there is nothing here to multiply. */
  | "none";

export type QuestDef = {
  id: QuestId;
  title: string;
  /** What the progress fraction counts, for the banner's benefit. */
  unit: string;
  /** The day's goal in words, once the size of the room has fixed the bar. */
  describe: (target: number) => string;
} & (
  | {
      growth: "care" | "none";
      /** The bar at the baseline community (§23's P ≤ 2), in the quest's unit. */
      base: number;
    }
  | { growth: "hands" }
);

/** Every caretaker who helped today gets this when the goal is met. */
export const QUEST_REWARD_COINS = 15;

/** Every meter must reach this percentage at the evening check. */
export const FULL_BELLIES_PERCENT = 70;

// Half the week's active caretakers, floored at two so a quiet room still has
// a goal it can reach, and capped at five for the same reason §23 caps the
// multiplier at nine: past that, success would start punishing itself.
export const QUEST_HANDS_MIN = 2;
export const QUEST_HANDS_MAX = 5;

export const QUESTS: Record<QuestId, QuestDef> = {
  "full-bellies": {
    id: "full-bellies",
    title: "Full bellies",
    unit: "%",
    growth: "none",
    base: FULL_BELLIES_PERCENT,
    describe: (target) => `Every meter at ${target}% by evening`,
  },
  "game-night": {
    id: "game-night",
    title: "Game night",
    unit: "points",
    growth: "care",
    base: 40,
    describe: (target) => `${target} points today`,
  },
  "many-hands": {
    id: "many-hands",
    title: "Many hands",
    unit: "caretakers",
    growth: "hands",
    describe: (target) => `${target} caretakers help today`,
  },
  "feast-day": {
    id: "feast-day",
    title: "Feast day",
    unit: "meals",
    growth: "care",
    base: 10,
    describe: (target) => `${target} meals today`,
  },
};

/** The day's goal. Same seed, same day, same quest — everywhere. */
export const questFor = (seed: number, dayIndex: number): QuestDef =>
  QUESTS[QUEST_IDS[draw32(seed, dayIndex, RNG_PURPOSE.questPick) % QUEST_IDS.length]!];

/** How many distinct caretakers any of today's goals wants (SPEC §21.7). */
export const questHands = (population?: number): number => {
  const active =
    population === undefined || !Number.isFinite(population) ? DIFFICULTY_BASELINE : Math.max(0, Math.floor(population));
  return Math.min(QUEST_HANDS_MAX, Math.max(QUEST_HANDS_MIN, Math.ceil(active / 2)));
};

/** Today's bar for a quest, at the community size the day opened with. */
export const questTarget = (quest: QuestDef, population?: number): number => {
  switch (quest.growth) {
    case "care":
      // The integer arithmetic decayRates uses, for the reason §23.2 gives:
      // two engines must agree on the bar to the unit, forever.
      return Math.round((quest.base * careMultiplierPermille(population)) / 1000);
    case "hands":
      return questHands(population);
    case "none":
      return quest.base;
  }
};

/** Everything today's slice of the log and the current state say about it. */
export type QuestFacts = {
  /** FEED actions performed today. */
  feeds: number;
  /** Distinct caretakers who performed any care today. */
  caretakers: number;
  /** Combined score of today's plausible minigame finishes. */
  minigameScore: number;
  /** The lowest of the four meters, as a percentage. */
  lowestMeterPercent: number;
  /** True once the day has reached its evening check. */
  eveningReached: boolean;
  /** Active caretakers as of pet-midnight; unrecorded reads as the baseline. */
  population: number | undefined;
};

export type QuestStatus = {
  current: number;
  target: number;
  /** Distinct caretakers who have helped today. */
  hands: number;
  /** How many of them the day's goal wants. */
  handsTarget: number;
  complete: boolean;
};

export const questProgress = (quest: QuestDef, facts: QuestFacts): QuestStatus => {
  // Full bellies is a snapshot, not an accumulation: it can be met and lost
  // again all afternoon, and only the evening check decides.
  const current =
    quest.id === "full-bellies"
      ? facts.lowestMeterPercent
      : quest.id === "game-night"
        ? facts.minigameScore
        : quest.id === "many-hands"
          ? facts.caretakers
          : facts.feeds;
  const target = questTarget(quest, facts.population);
  const handsTarget = questHands(facts.population);
  const reached = current >= target && facts.caretakers >= handsTarget;
  return {
    current,
    target,
    hands: facts.caretakers,
    handsTarget,
    complete: quest.id === "full-bellies" ? reached && facts.eveningReached : reached,
  };
};
