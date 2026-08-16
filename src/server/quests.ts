// The daily communal quest, server side (SPEC §21.7). Progress is computed,
// never stored: one pet-day of a generation's events is a bounded scan, and
// the rules that turn those counts into a fraction live in src/sim/quests.
//
// Completion is claimed before anyone is paid. The marker's _id is the
// (generation, day) pair, so a second leader — or the same leader after a
// restart — loses the insert and pays nobody twice. Losing the process
// between the claim and the payout costs that day's coins; paying first
// would cost them twice, and the spec asks for exactly once.

import type { Collection, Db } from "mongodb";
import { derive } from "@/sim/derive";
import { isAlive, type Generation, type PetState } from "@/sim/model";
import { NEED_KEYS, SLEEP_HOUR } from "@/sim/tuning";
import { questFor, questProgress, QUEST_REWARD_COINS, type QuestDef, type QuestStatus } from "@/sim/quests";
import { events, isDuplicateKeyError } from "./db/collections";
import { localDayIndex, localTickAt } from "./schedule";
import { creditCoins } from "./social";

/** The evening check sits one hour before the pet goes to sleep. */
const EVENING_HOUR = SLEEP_HOUR - 1;

export type QuestDoc = {
  /** `${generationId}:${dayIndex}` — the claim is the primary key. */
  _id: string;
  generationId: string;
  dayIndex: number;
  questId: string;
  contributors: string[];
  completedAt: Date;
};

export const questMarkers = (db: Db): Collection<QuestDoc> => db.collection("questsDone");

export type QuestView = QuestStatus & {
  dayIndex: number;
  quest: QuestDef;
  /** Everyone who has helped today — the list that gets paid. */
  contributors: string[];
};

type DayWindow = { dayIndex: number; fromTick: number; toTick: number; eveningTick: number };

export const questDay = (generation: Generation, nowMs: number, timeZone: string): DayWindow => {
  const dayIndex = localDayIndex(generation.genesisEpochMs, nowMs, timeZone);
  return {
    dayIndex,
    fromTick: localTickAt(generation.genesisEpochMs, dayIndex, 0, timeZone),
    toTick: localTickAt(generation.genesisEpochMs, dayIndex + 1, 0, timeZone),
    eveningTick: localTickAt(generation.genesisEpochMs, dayIndex, EVENING_HOUR, timeZone),
  };
};

/** Today's goal and how far the room has got with it. */
export const questView = async (
  db: Db,
  generation: Generation,
  state: PetState,
  timeZone: string,
  nowMs: number,
): Promise<QuestView> => {
  const day = questDay(generation, nowMs, timeZone);
  const quest = questFor(generation.seed, day.dayIndex);

  const docs = await events(db)
    .find({ generationId: generation.id, type: "CARE", tick: { $gte: day.fromTick, $lt: day.toTick } })
    .toArray();
  const care = docs.flatMap((doc) => (doc.type === "CARE" ? [doc] : []));

  const contributors = [...new Set(care.map((doc) => doc.caretakerId))].sort();
  const percentages = derive(state).percentages;
  const status = questProgress(quest, {
    feeds: care.filter((doc) => doc.action === "FEED").length,
    caretakers: contributors.length,
    minigameScore: care.reduce((total, doc) => total + (doc.minigameScore ?? 0), 0),
    lowestMeterPercent: Math.min(...NEED_KEYS.map((need) => percentages[need])),
    eveningReached: state.tick >= day.eveningTick,
  });

  return { ...status, dayIndex: day.dayIndex, quest, contributors };
};

/**
 * The leader's completion check. Returns the quest that was just finished,
 * or null — including when it was already finished earlier today.
 */
export const settleQuest = async (
  db: Db,
  generation: Generation,
  state: PetState,
  timeZone: string,
  nowMs: number,
): Promise<QuestView | null> => {
  if (!isAlive(state)) return null;
  const view = await questView(db, generation, state, timeZone, nowMs);
  if (!view.complete || view.contributors.length === 0) return null;

  try {
    await questMarkers(db).insertOne({
      _id: `${generation.id}:${view.dayIndex}`,
      generationId: generation.id,
      dayIndex: view.dayIndex,
      questId: view.quest.id,
      contributors: view.contributors,
      completedAt: new Date(),
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) return null; // already settled today
    throw error;
  }

  for (const caretakerId of view.contributors) {
    await creditCoins(db, caretakerId, QUEST_REWARD_COINS);
  }
  return view;
};

/** Whether today's goal has already been settled — the banner reads this. */
export const questSettled = async (db: Db, generationId: string, dayIndex: number): Promise<boolean> =>
  (await questMarkers(db).findOne({ _id: `${generationId}:${dayIndex}` })) !== null;
