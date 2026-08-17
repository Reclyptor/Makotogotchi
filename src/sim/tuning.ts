// Every constant in the game lives here. No magic number lives anywhere else.
// SPEC §5 is the design rationale for these values; the §16.2 property tests
// are what hold the design intent invariant when they are tuned.

export const TICK_SECONDS = 10;
export const TICKS_PER_HOUR = 360;
export const TICKS_PER_DAY = 8640;

// Needs are integers in [0, NEED_MAX]; display divides by 10_000 for a
// percentage. The scale is chosen so every rate in the table below is an
// exact integer after its stage/phase/form multipliers.
export const NEED_MAX = 1_000_000;
export const CRITICAL_THRESHOLD = 200_000; // 20%

export const NEED_KEYS = ["hunger", "energy", "hygiene", "joy"] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

// Health is the death clock (SPEC §2.3). Raw units, decoupled from the need
// scale so drain arithmetic stays integral and well inside 2^53.
export const HEALTH_MAX = 1_000_000_000_000; // 10^12

// Per-tick health drain per unit of need deficit (deficit measured in need
// units below CRITICAL_THRESHOLD, summed across needs). Worst case — all
// four needs at zero — drains 550 × 800_000 = 4.4×10^8/tick: death from full
// health in ~2273 ticks (~6.3h) under total deprivation. Tuned so the §16.2
// dial holds: abandonment from full is fatal ~42–48h in, ~12h after the
// first need goes critical.
export const HEALTH_DRAIN_PER_NEED = 550;
// Untreated sickness kills from full health in ~8333 ticks (~23h) — an
// overnight onset leaves the day shift a real chance to respond to the push
// alert, matching the ~24h difficulty dial. Compounds with need deficits.
export const HEALTH_DRAIN_SICK = 120_000_000;
// ELDER-only unconditional drain: ~9.65 elder days from full under perfect
// care. This is what makes old-age mortality a theorem (SPEC §2.3).
export const HEALTH_DRAIN_AGE = 12_000_000;
// Regeneration when no need is critical (never for ELDER): zero to full in
// ~8333 ticks (~23h).
export const HEALTH_REGEN = 120_000_000;
// Below 40% health the SICK onset chance triples.
export const HEALTH_SICK_MULTIPLIER_THRESHOLD = 400_000_000_000;

export type LifeStage = "EGG" | "HATCHLING" | "PUP" | "JUVENILE" | "ADULT" | "ELDER";
export type AdultForm = "THRIVING" | "STEADY" | "FRAIL";
export type SleepPhase = "WAKE" | "SLEEP";

// Stage boundaries in ticks since hatch (EGG ends at the HATCHED event, whose
// timing is external — the naming vote — so it is not a tick offset).
export const STAGE_STARTS: readonly { stage: Exclude<LifeStage, "EGG">; atTick: number }[] = [
  { stage: "HATCHLING", atTick: 0 },
  { stage: "PUP", atTick: 1 * TICKS_PER_DAY },
  { stage: "JUVENILE", atTick: 3 * TICKS_PER_DAY },
  { stage: "ADULT", atTick: 7 * TICKS_PER_DAY },
  { stage: "ELDER", atTick: 21 * TICKS_PER_DAY },
];

// Base decay per tick while awake, in need units. Nominal time from full to
// critical, awake-only: hunger (1_000_000 − 200_000)/90 ≈ 24.7h — the
// pacesetter. Energy is special: it *recovers* while asleep.
const BASE_AWAKE_DECAY: Record<NeedKey, number> = {
  hunger: 90,
  joy: 80,
  energy: 70,
  hygiene: 60,
};

// Multipliers, applied to decay only (energy recovery is unscaled). These are
// design inputs; the exact per-combination integers live in DECAY_TABLE,
// which is the single source of truth the simulation reads.
const SLEEP_MULTIPLIER: Record<NeedKey, number> = { hunger: 0.4, joy: 0.4, energy: 0, hygiene: 1 };
const STAGE_MULTIPLIER: Record<Exclude<LifeStage, "EGG">, number> = {
  HATCHLING: 0.6,
  PUP: 1,
  JUVENILE: 1,
  ADULT: 1,
  ELDER: 1.4,
};
const FORM_MULTIPLIER: Record<AdultForm, number> = { THRIVING: 0.9, STEADY: 1, FRAIL: 1.15 };

export const ENERGY_SLEEP_RECOVERY = 300; // per tick: zero to ~97% over a 9h night

export type DecayRates = Record<NeedKey, number>;

const decayFor = (stage: Exclude<LifeStage, "EGG">, form: AdultForm | null, phase: SleepPhase): DecayRates => {
  const rates = {} as Record<NeedKey, number>;
  for (const need of NEED_KEYS) {
    const sleep = phase === "SLEEP" ? SLEEP_MULTIPLIER[need] : 1;
    rates[need] = Math.round(BASE_AWAKE_DECAY[need] * sleep * STAGE_MULTIPLIER[stage] * (form ? FORM_MULTIPLIER[form] : 1));
  }
  return rates;
};

// The full precomputed table: stage → form (null pre-adult) → phase → rates.
// Deterministic at module load; every value is an exact integer thereafter.
export const DECAY_TABLE: ReadonlyMap<string, DecayRates> = new Map(
  (["HATCHLING", "PUP", "JUVENILE", "ADULT", "ELDER"] as const).flatMap((stage) =>
    ([null, "THRIVING", "STEADY", "FRAIL"] as const).flatMap((form) =>
      (["WAKE", "SLEEP"] as const).map((phase) => [`${stage}|${form ?? "-"}|${phase}`, decayFor(stage, form, phase)] as const),
    ),
  ),
);

export const decayRates = (
  stage: Exclude<LifeStage, "EGG">,
  form: AdultForm | null,
  phase: SleepPhase,
  /** Community difficulty in per-mille (SPEC §23); 1000 leaves the table as-is. */
  multiplierPermille = 1000,
): DecayRates => {
  const rates = DECAY_TABLE.get(`${stage}|${form ?? "-"}|${phase}`);
  if (!rates) throw new Error(`no decay rates for ${stage}/${form}/${phase}`);
  if (multiplierPermille === 1000) return rates;
  // Integer arithmetic throughout, so a scaled rate is as exactly reproducible
  // as the table it came from.
  const scaled = {} as DecayRates;
  for (const need of NEED_KEYS) scaled[need] = Math.round((rates[need] * multiplierPermille) / 1000);
  return scaled;
};

// ── Actions ─────────────────────────────────────────────────────────────────

export const CARE_ACTIONS = ["FEED", "PLAY", "CLEAN", "MEDICATE", "LULLABY", "PET"] as const;
export type CareAction = (typeof CARE_ACTIONS)[number];

// Base magnitudes (subject to diminishing returns, SPEC §2.6) in need units.
export const ACTION_MAGNITUDE = {
  FEED: 250_000, // hunger
  PLAY: 220_000, // joy
  CLEAN: 300_000, // hygiene
  LULLABY: 150_000, // energy
  PET: 40_000, // joy
} as const;

export const PLAY_ENERGY_COST = 60_000; // paid by the pet (SPEC §2.5)
export const MEDICATE_HEALTH_RESTORE = 50_000_000_000; // +5% health, flat

// Cooldowns in ticks. Global belongs to the pet ("Makoto is still eating");
// per-caretaker is what stops one person soloing it (SPEC §2.5).
export const COOLDOWNS: Record<CareAction, { global: number; caretaker: number }> = {
  FEED: { global: 5, caretaker: 18 }, //  50s / 3min
  PLAY: { global: 6, caretaker: 18 }, //  60s / 3min
  CLEAN: { global: 9, caretaker: 30 }, //  90s / 5min
  MEDICATE: { global: 30, caretaker: 60 }, // 5min / 10min
  LULLABY: { global: 12, caretaker: 30 }, // 2min / 5min
  PET: { global: 1, caretaker: 3 }, //  10s / 30s
};

// ── Caretaker budget (SPEC §2.5) ────────────────────────────────────────────

// Applied restoration per (caretaker, need) over any rolling 7 pet-days is
// capped at this many days' worth of nominal decay. 4 of 7 means one person
// can burst-rescue but can never supply a week of decay alone.
export const CARETAKER_WEEKLY_BUDGET_DAYS = 4;
export const BUDGET_WINDOW_DAYS = 7;

const AWAKE_TICKS_PER_DAY = 15 * TICKS_PER_HOUR; // 07:00–22:00
const ASLEEP_TICKS_PER_DAY = TICKS_PER_DAY - AWAKE_TICKS_PER_DAY;

// Nominal daily decay (PUP-stage rates) per need — the budget denominator.
export const DAILY_DECAY: Record<NeedKey, number> = (() => {
  const awake = decayFor("PUP", null, "WAKE");
  const asleep = decayFor("PUP", null, "SLEEP");
  const daily = {} as Record<NeedKey, number>;
  for (const need of NEED_KEYS) {
    daily[need] = awake[need] * AWAKE_TICKS_PER_DAY + asleep[need] * ASLEEP_TICKS_PER_DAY;
  }
  return daily;
})();

export const WEEKLY_BUDGET: Record<NeedKey, number> = (() => {
  const budget = {} as Record<NeedKey, number>;
  for (const need of NEED_KEYS) budget[need] = CARETAKER_WEEKLY_BUDGET_DAYS * DAILY_DECAY[need];
  return budget;
})();

// ── Sleep (SPEC §2.7) ───────────────────────────────────────────────────────

export const SLEEP_HOUR = 22;
export const WAKE_HOUR = 7;

export const EXHAUSTED_THRESHOLD = 150_000; // involuntary nap below this
export const NAP_WAKE_THRESHOLD = 400_000; // nap/lullaby sleep ends at this
export const LULLABY_ENERGY_GATE = 250_000; // daytime lullaby needs energy below this
export const PLAY_ENERGY_GATE = 100_000; // playing needs energy above this

// ── Ailment thresholds (SPEC §2.9) — all derived, hysteresis on/off pairs ───

export const AILMENT_THRESHOLDS = {
  FILTHY: { need: "hygiene", onsetBelow: 250_000, clearAt: 500_000 },
  STARVING: { need: "hunger", onsetBelow: 150_000, clearAt: 300_000 },
  EXHAUSTED: { need: "energy", onsetBelow: EXHAUSTED_THRESHOLD, clearAt: NAP_WAKE_THRESHOLD },
  SAD: { need: "joy", onsetBelow: 200_000, clearAt: 400_000 },
} as const satisfies Record<string, { need: NeedKey; onsetBelow: number; clearAt: number }>;

// ── Sickness (SPEC §2.9) ────────────────────────────────────────────────────

// Per-tick onset probability, expressed as a threshold against a uint32 draw.
// Base ≈ 1/30_000 per tick (~once per 3.5 days at full hygiene), scaled by
// (1 + 4 × filthiness) and ×3 below the health threshold — all in exact
// integer arithmetic (SPEC §4.4).
export const SICK_BASE_P32 = Math.floor(2 ** 32 / 30_000); // 143_165

export const sickOnsetThreshold = (hygiene: number, healthRaw: number): number => {
  const filthScaled = NEED_MAX + 4 * (NEED_MAX - hygiene); // ∈ [NEED_MAX, 5×NEED_MAX]
  const base = Math.floor((SICK_BASE_P32 * filthScaled) / NEED_MAX);
  return healthRaw < HEALTH_SICK_MULTIPLIER_THRESHOLD ? base * 3 : base;
};

// ── Adult form branching (SPEC §2.8) ────────────────────────────────────────

export const FORM_THRIVING_AT = 750_000; // careScore ≥ 75%
export const FORM_STEADY_AT = 400_000; // careScore ≥ 40%; below is FRAIL

// ── Contribution scoring (SPEC §2.11) ───────────────────────────────────────

// Score = applied magnitude × weight / SCORE_DIVISOR for magnitude-shaped
// actions; MEDICATE and LULLABY score flat amounts.
export const SCORE_DIVISOR = 10_000;
export const CONTRIBUTION_WEIGHTS: Record<CareAction, { perApplied: number } | { flat: number }> = {
  FEED: { perApplied: 10 },
  PLAY: { perApplied: 10 },
  CLEAN: { perApplied: 10 },
  PET: { perApplied: 5 },
  MEDICATE: { flat: 300 },
  LULLABY: { flat: 100 },
};

// ── Lifecycle timing (SPEC §2.10) ───────────────────────────────────────────

export const INCUBATION_TICKS = 180; // 30 min minimum; extends until first name proposal
export const MOURNING_TICKS = 720; // 2h of gravestone before the next egg
