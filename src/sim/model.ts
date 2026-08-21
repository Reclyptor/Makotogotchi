// State types only — the shapes the simulation folds over. SPEC §4.3 governs
// what is stored here versus derived in derive.ts: nothing presentational
// lives in this file, and nothing stored here is recomputable from the rest.

import { STAGE_STARTS, type AdultForm, type CareAction, type LifeStage, type NeedKey, type SleepPhase } from "./tuning";
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
   * Active caretakers as last recorded by a POPULATION event, which sets how
   * fast needs decay (SPEC §23). Absent in histories written before that
   * section, where it reads as the baseline and replays unchanged.
   */
  population?: number;
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
};

/** Pure function of hatch time — never stored (SPEC §4.3). */
export const stageAt = (bornAtTick: number | null, tick: number): LifeStage => {
  if (bornAtTick === null) return "EGG";
  const sinceHatch = tick - bornAtTick;
  let stage: LifeStage = "HATCHLING";
  for (const start of STAGE_STARTS) {
    if (sinceHatch >= start.atTick) stage = start.stage;
  }
  return stage;
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
