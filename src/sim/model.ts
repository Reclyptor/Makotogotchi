// State types only — the shapes the simulation folds over. SPEC §4.3 governs
// what is stored here versus derived in derive.ts: nothing presentational
// lives in this file, and nothing stored here is recomputable from the rest.

import {
  ELDER_STARTS_AT,
  MEDITATION_STARTS_AT,
  MEDITATION_TICKS,
  RULES_SINCE,
  STAGE_STARTS,
  TICKS_PER_DAY,
  type AdultForm,
  type CareAction,
  type LifeStage,
  type NeedKey,
  type SleepPhase,
} from "./tuning";
import type { WantKind } from "./wants";

export type Needs = Record<NeedKey, number>;

export type SleepReason = "NIGHT" | "NAP" | "LULLABY";

export type CauseOfDeath = "hunger" | "energy" | "hygiene" | "joy" | "sickness" | "age";

export type Generation = {
  id: string;
  ordinal: number;
  /** Seeds the deterministic RNG stream (SPEC §4.4). */
  seed: number;
  /** Anchors tickIndex = floor((unixMs − genesisEpochMs) / 10_000) (SPEC §4.5). */
  genesisEpochMs: number;
  /** Set by the HATCHED event once the naming vote resolves. */
  name: string | null;
  /**
   * How many meals the shop sold when this egg was laid (SPEC §21.4). A
   * generation's taste and cravings index the meal list by position, so the
   * list it draws from has to be the list it was born with — a meal added
   * later is on the menu for the next generation, never a reshuffle of this
   * one's. Absent on eggs laid before the catalog first grew, which read as
   * `LEGACY_FOOD_CATALOG_SIZE`.
   */
  foodCatalogSize?: number;
  /**
   * Laid after a Sage's death (SPEC §2.8): its childhood is held to the gentler
   * `formThresholds(true)`. Pinned at egg-laying like `foodCatalogSize`, and
   * absent rather than false on every other egg so their generations
   * serialize as they always did.
   */
  sageBlessed?: true;
};

/** One pet-day of applied restoration, for the rolling budget (SPEC §2.5). */
export type BudgetDay = {
  day: number; // floor(tick / TICKS_PER_DAY)
  applied: number;
};

/**
 * Everything the simulation tracks per caretaker. Kept sorted by id inside
 * PetState so serialization is canonical (replay and golden-file determinism
 * depend on it). Entries with no activity inside the budget window are pruned
 * when events fold.
 */
export type CaretakerRecord = {
  id: string;
  lastActionTick: Partial<Record<CareAction, number>>;
  budget: Partial<Record<NeedKey, BudgetDay[]>>;
};

/** The open want as recorded by WANT_OPENED (SPEC §25.2). */
export type WantOpen = {
  window: number;
  kind: WantKind;
  itemId?: string;
};

export type PetState = {
  generation: Generation;
  /** The tick this state is settled to. project() advances it. */
  tick: number;
  /** Null until the HATCHED event; stage is derived from it (stageAt). */
  bornAtTick: number | null;
  diedAtTick: number | null;
  causeOfDeath: CauseOfDeath | null;
  /** Decided exactly once, at the ADULT transition (SPEC §2.8). */
  form: AdultForm | null;
  needs: Needs;
  healthRaw: number;
  asleep: boolean;
  sleepReason: SleepReason | null;
  sick: boolean;
  sickSinceTick: number | null;
  /** careScore accumulator: Σ over JUVENILE ticks of Σ needs, plus tick count. */
  careNum: number;
  careTicks: number;
  /** Per-action last-performed tick — the global cooldowns (SPEC §2.5). */
  lastActionTick: Partial<Record<CareAction, number>>;
  caretakers: CaretakerRecord[];
  /** Communal toys installed this generation, sorted (SPEC §13.2). */
  toys: string[];
  /**
   * Named caretakers who acted this week, as last recorded by a POPULATION
   * event (SPEC §23). Absent in histories written before that section, where
   * it reads as the baseline and replays unchanged. This is the number the UI
   * names; it is not what difficulty reads.
   */
  population?: number;
  /**
   * The same community weighted by presence, in thousandths of a caretaker
   * (SPEC §23.1) — what need decay actually scales by. Absent in histories
   * recorded before presence weighting, where `population` converts straight
   * across because that rule counted every caretaker as a whole week.
   */
  populationPermille?: number;
  /**
   * The want currently open, set by WANT_OPENED and cleared to explicit null
   * on settlement — never undefined, which the hot-state JSON round trip and
   * BSON serialize differently (SPEC §25.2). Absent in histories written
   * before that section.
   */
  wantOpen?: WantOpen | null;
  /**
   * Monotonic high-water mark of settled (fulfilled or expired) want windows.
   * An expired window can never re-open, so no replayed or re-appended event
   * can debit the same window twice (SPEC §25.2). Absent reads as −∞.
   */
  wantSettledWindow?: number | null;
  /**
   * The tick the leader recorded this generation's ELDER_RAMP event. From
   * here the elder's hold line climbs (see `elderRampDayAt`). Absent in
   * histories written before the ramp, which keep the flat line they were
   * lived under — and absent, not null, so their serialized state is
   * byte-identical to what it always was.
   */
  elderRampFromTick?: number;
  /**
   * The ruleset this generation is lived under, as last recorded by a RULES
   * event (SPEC §23.2). Absent in every history written before the event
   * existed, where it reads as 1 and the rules fold exactly as they did.
   * Never defaulted into genesis: that would change every fixture.
   */
  rulesVersion?: number;
  /**
   * The tick a RULES event first brought this generation to ruleset 4, which
   * fixes when it may begin to meditate (see `meditationStartTickOf`). A
   * version carries no time and the rule needs one: a pet already past day 40
   * when it lands meditates from then, not from a day it already lived. Set
   * once by the fold, and absent, not null, in every older history.
   */
  sageRuleFromTick?: number;
  /**
   * The tick a RULES event first brought this generation to ruleset 5, which
   * fixes when day two of the meditation restores the pet (see
   * `deepStillnessStartTickOf`): a pet already in day two when the rule lands
   * is restored then, not on a day it already lived. Set once by the fold,
   * and absent, not null, in every older history.
   */
  deepStillnessFromTick?: number;
};

/** The ruleset a state is lived under: a log with no RULES event is version 1. */
export const rulesVersionOf = (state: PetState): number => state.rulesVersion ?? 1;

/**
 * Pure function of hatch time and the sage start — never stored (SPEC §4.3).
 * `sageStartTick` is null for a pet that will never be a Sage; callers holding
 * a state use `stageOf`, which supplies it.
 */
export const stageAt = (bornAtTick: number | null, tick: number, sageStartTick: number | null): LifeStage => {
  if (bornAtTick === null) return "EGG";
  if (sageStartTick !== null && tick >= sageStartTick) return "SAGE";
  const sinceHatch = tick - bornAtTick;
  let stage: LifeStage = "HATCHLING";
  for (const start of STAGE_STARTS) {
    if (sinceHatch >= start.atTick) stage = start.stage;
  }
  return stage;
};

/**
 * The first tick of the elder's meditation, or null for a pet lived under a
 * ruleset without it. Day 40 of its life, or the tick after the ruleset was
 * recorded if that is later: the event's own tick, and every tick before it,
 * were lived under the old rules.
 */
export const meditationStartTickOf = (state: PetState): number | null => {
  if (state.sageRuleFromTick === undefined || state.bornAtTick === null) return null;
  return Math.max(state.sageRuleFromTick + 1, state.bornAtTick + MEDITATION_STARTS_AT);
};

/** The tick the meditation ends and the Sage begins, or null. */
export const sageStartTickOf = (state: PetState): number | null => {
  const start = meditationStartTickOf(state);
  return start === null ? null : start + MEDITATION_TICKS;
};

export const stageOf = (state: PetState, tick: number): LifeStage =>
  stageAt(state.bornAtTick, tick, sageStartTickOf(state));

/** The stage the pet died in, or null while it lives. */
export const stageAtDeath = (state: PetState): LifeStage | null =>
  state.diedAtTick === null ? null : stageOf(state, state.diedAtTick);

/** Whether the pet is in its two days of meditation at `tick` (SPEC §2.8). Derived, never stored. */
export const meditatingAt = (state: PetState, tick: number): boolean => {
  const start = meditationStartTickOf(state);
  return start !== null && tick >= start && tick < start + MEDITATION_TICKS;
};

/**
 * Whether the meditation is on its second day at `tick`, when the room
 * gathers an aura around the pet (SPEC §2.8). Derived, never stored.
 */
export const deepMeditationAt = (state: PetState, tick: number): boolean => {
  const start = meditationStartTickOf(state);
  return start !== null && meditatingAt(state, tick) && tick >= start + TICKS_PER_DAY;
};

/**
 * The tick day two of the meditation restores the pet, or null for a pet that
 * is not under ruleset 5 or will never meditate. The first tick of day two,
 * or the tick after the ruleset was recorded if that is later (SPEC §2.8).
 */
export const deepStillnessStartTickOf = (state: PetState): number | null => {
  const start = meditationStartTickOf(state);
  if (start === null || state.deepStillnessFromTick === undefined) return null;
  return Math.max(start + TICKS_PER_DAY, state.deepStillnessFromTick + 1);
};

/**
 * Whether day two is a stillness nothing can break at `tick`: the second day
 * of the meditation, lived under ruleset 5 (SPEC §2.8).
 */
export const deepStillnessAt = (state: PetState, tick: number): boolean =>
  rulesVersionOf(state) >= RULES_SINCE.DEEP_STILLNESS && deepMeditationAt(state, tick);

/**
 * Whole days into the elder ramp, or null while the pet still ages by the rule
 * every history written before the ramp folds under (no ELDER_RAMP event yet).
 * The ramp counts from the later of the event and the first elder day, so a
 * pet that is young when the event lands carries the rule until it grows old
 * and then ramps from its first day as an elder.
 */
export const elderRampDayAt = (state: PetState, tick: number): number | null => {
  if (state.elderRampFromTick === undefined || state.bornAtTick === null) return null;
  const rampStart = Math.max(state.elderRampFromTick, state.bornAtTick + ELDER_STARTS_AT);
  return Math.max(0, Math.floor((tick - rampStart) / TICKS_PER_DAY));
};

export const isAlive = (state: PetState): boolean => state.bornAtTick !== null && state.diedAtTick === null;

/**
 * The sleep/wake schedule, precomputed by the one timezone-aware module in
 * src/server and passed in as context (SPEC §4.5). Boundaries are sorted by
 * tick; before the first boundary the phase is `initialPhase`.
 */
export type PhaseSchedule = {
  initialPhase: SleepPhase;
  boundaries: readonly { tick: number; phase: SleepPhase }[];
};

export const phaseAt = (schedule: PhaseSchedule, tick: number): SleepPhase => {
  let phase = schedule.initialPhase;
  for (const boundary of schedule.boundaries) {
    if (boundary.tick > tick) break;
    phase = boundary.phase;
  }
  return phase;
};

export type ProjectionContext = {
  schedule: PhaseSchedule;
};
