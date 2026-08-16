// The daily communal quest (SPEC §21.7): one shared goal per pet-day, the
// same one for everybody, derived from the generation seed and the day index
// so no server has to decide it and no client has to be told.
//
// Progress is never stored. The server counts today's slice of the event log
// and hands the totals to questProgress, which is the only place the rules
// live — client, server, and tests all read the same arithmetic.

import { draw32, RNG_PURPOSE } from "./rng";

export const QUEST_IDS = ["full-bellies", "game-night", "many-hands", "feast-day"] as const;
export type QuestId = (typeof QUEST_IDS)[number];

export type QuestDef = {
  id: QuestId;
  title: string;
  /** The bar to clear, in the quest's own unit. */
  target: number;
  /** What the progress fraction counts, for the banner's benefit. */
  unit: string;
  description: string;
};

/** Every caretaker who helped today gets this when the goal is met. */
export const QUEST_REWARD_COINS = 15;

/** Every meter must reach this percentage at the evening check. */
export const FULL_BELLIES_PERCENT = 70;

export const QUESTS: Record<QuestId, QuestDef> = {
  "full-bellies": {
    id: "full-bellies",
    title: "Full bellies",
    target: FULL_BELLIES_PERCENT,
    unit: "%",
    description: "Every meter at 70% by evening",
  },
  "game-night": {
    id: "game-night",
    title: "Game night",
    target: 40,
    unit: "points",
    description: "40 minigame points today",
  },
  "many-hands": {
    id: "many-hands",
    title: "Many hands",
    target: 4,
    unit: "caretakers",
    description: "Four different caretakers help today",
  },
  "feast-day": {
    id: "feast-day",
    title: "Feast day",
    target: 10,
    unit: "meals",
    description: "Ten meals served today",
  },
};

/** The day's goal. Same seed, same day, same quest — everywhere. */
export const questFor = (seed: number, dayIndex: number): QuestDef =>
  QUESTS[QUEST_IDS[draw32(seed, dayIndex, RNG_PURPOSE.questPick) % QUEST_IDS.length]!];

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
};

export type QuestStatus = { current: number; target: number; complete: boolean };

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
  const reached = current >= quest.target;
  return { current, target: quest.target, complete: quest.id === "full-bellies" ? reached && facts.eveningReached : reached };
};
