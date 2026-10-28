// Every constant in the game lives here. No magic number lives anywhere else.
// SPEC §5 is the design rationale for these values; the §16.2 property tests
// are what hold the design intent invariant when they are tuned.

export const TICK_SECONDS = 10;

// The ruleset a generation is lived under (SPEC §23.2). A rule that changes
// how a pet lives or dies is gated on `rulesVersion >= N` so that a log
// written before it folds as it always did; the leader records the current
// version once per generation in a RULES event. Shipping the next change
// means raising this number — not adding an event type per change — and
// gating the new rule on it. Version 1 is every history that predates the
// event.
export const CURRENT_RULES_VERSION = 4;
/** The ruleset that introduced each gated rule, so no call site carries a bare number. */
export const RULES_SINCE = {
  /** An elder dying with no need critical, below its line, dies of age (SPEC §2.3). */
  AGE_CREDIT: 2,
  /** FRAIL elders' hold line stops at `ELDER_HOLD_CAP_FRAIL` (SPEC §2.3). */
  FRAIL_CAP: 2,
  /** The health view blames a need, then sickness, then age (SPEC §2.3). */
  ACTIONABLE_REASON: 2,
  /** No community scaling of need decay while the schedule says SLEEP (SPEC §23). */
  NIGHT_EXEMPT: 2,
  /** The community multiplier stops at `DIFFICULTY_CEILING_V3`, wherever it is read (SPEC §23). */
  GENTLE_CEILING: 3,
  /** The elder hold line stops at 75%, FRAIL at 70% (SPEC §2.3). */
  LOWER_HOLD_CAP: 3,
  /** An elder meditates on day 40 and rises a SAGE two days later (SPEC §2.8). */
  SAGE: 4,
} as const;
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
// Untreated sickness drains exactly what an adult regenerates, so on its own
// it only stalls recovery. Where nothing regenerates (a critical need) it
// kills from full health in ~8333 ticks (~23h) — an overnight onset leaves the
// day shift a real chance to respond to the push alert, matching the ~24h
// difficulty dial — and an elder, whose regen is a quarter of that, loses the
// difference in ~31h. Compounds with need deficits.
export const HEALTH_DRAIN_SICK = 120_000_000;
// ELDER-only age drain at zero vigour: ~9.65 elder days from full when the
// elder is left entirely to itself. Care scales it away (SPEC §2.3).
export const HEALTH_DRAIN_AGE = 12_000_000;
// The hold line of the rule every history from before the ramp folds by. Frozen
// on its own so that retuning the ramp can never re-fold an old log.
export const LEGACY_ELDER_HOLD_MEAN = 600_000;
// Old age is held off by care (SPEC §2.3), and the care asked for rises. The
// age drain is scaled by the elder's vigour, which reads the mean of its four
// needs against a hold line that climbs one step per day from the start of
// the ramp until it reaches the cap. At the line age drains nothing; a band
// below it, the drain rises to its full rate.
export const ELDER_HOLD_START = 600_000; // 60%
export const ELDER_HOLD_STEP = 25_000; // 2.5 points a day
export const ELDER_HOLD_CAP = 850_000; // 85%, reached on ramp day 10
// A FRAIL elder is asked for less (SPEC §2.3): its needs decay 15% faster than
// a STEADY one's, so the same line costs it more care. Its line stops here, on
// ramp day 8. Only histories under ruleset 2 read it (`RULES_SINCE.FRAIL_CAP`).
export const ELDER_HOLD_CAP_FRAIL = 800_000; // 80%
// Ruleset 3 lowers both caps so that good care, not perfect play, keeps an
// elder alive (`RULES_SINCE.LOWER_HOLD_CAP`): ramp day 6, and day 4 for FRAIL.
export const ELDER_HOLD_CAP_V3 = 750_000; // 75%
export const ELDER_HOLD_CAP_FRAIL_V3 = 700_000; // 70%
export const ELDER_BAND = 100_000; // 10 points
// A Sage is asked for less than the elder it was (SPEC §2.8): a flat line, ten
// points under the elder's ruleset-3 caps, with the same band beneath it.
export const SAGE_HOLD_MEAN = 650_000; // 65%
export const SAGE_HOLD_MEAN_FRAIL = 600_000; // 60%
/** Where the hold line stops for a form, under the ruleset the pet is living by. */
const elderHoldCap = (form: AdultForm | null, rules: number): number => {
  const frail = form === "FRAIL" && rules >= RULES_SINCE.FRAIL_CAP;
  if (rules >= RULES_SINCE.LOWER_HOLD_CAP) return frail ? ELDER_HOLD_CAP_FRAIL_V3 : ELDER_HOLD_CAP_V3;
  return frail ? ELDER_HOLD_CAP_FRAIL : ELDER_HOLD_CAP;
};
export const elderHoldMean = (rampDay: number, form: AdultForm | null, rules: number): number =>
  Math.min(elderHoldCap(form, rules), ELDER_HOLD_START + ELDER_HOLD_STEP * rampDay);
export const needsMean = (needs: Record<NeedKey, number>): number =>
  Math.floor((needs.hunger + needs.energy + needs.hygiene + needs.joy) / 4);
/** Today's hold line: the legacy flat one before any ramp, the climbing one after. */
export const elderHoldLine = (rampDay: number | null, form: AdultForm | null, rules: number): number =>
  rampDay === null ? LEGACY_ELDER_HOLD_MEAN : elderHoldMean(rampDay, form, rules);
/** Vigour against a line: none at `floor`, full at `hold`, linear between. */
const vigourAgainst = (needs: Record<NeedKey, number>, hold: number, floor: number): number =>
  Math.min(1000, Math.max(0, Math.floor(((needsMean(needs) - floor) * 1000) / (hold - floor))));
export const sageHoldMean = (form: AdultForm | null): number => (form === "FRAIL" ? SAGE_HOLD_MEAN_FRAIL : SAGE_HOLD_MEAN);
export const sageVigourPermille = (needs: Record<NeedKey, number>, form: AdultForm | null): number => {
  const hold = sageHoldMean(form);
  return vigourAgainst(needs, hold, hold - ELDER_BAND);
};
export const elderVigourPermille = (
  needs: Record<NeedKey, number>,
  rampDay: number | null,
  form: AdultForm | null,
  rules: number,
): number => {
  const hold = elderHoldLine(rampDay, form, rules);
  return vigourAgainst(needs, hold, rampDay === null ? CRITICAL_THRESHOLD : hold - ELDER_BAND);
};
// An elder held at full vigour regains health at a quarter of the adult rate:
// about four days from empty to full.
export const HEALTH_REGEN_ELDER = 30_000_000;
// An elder crossing below this on the way down is fading (SPEC §2.10).
export const FADING_THRESHOLD = HEALTH_MAX / 2;
// Regeneration when no need is critical (never for ELDER): zero to full in
// ~8333 ticks (~23h).
export const HEALTH_REGEN = 120_000_000;
// Below 40% health the SICK onset chance triples.
export const HEALTH_SICK_MULTIPLIER_THRESHOLD = 400_000_000_000;

export type LifeStage = "EGG" | "HATCHLING" | "PUP" | "JUVENILE" | "ADULT" | "ELDER" | "SAGE";
/** The stages old age reaches: the elder health model, fading and twilight. */
export const isOld = (stage: LifeStage): stage is "ELDER" | "SAGE" => stage === "ELDER" || stage === "SAGE";
export type AdultForm = "THRIVING" | "STEADY" | "FRAIL";
export type SleepPhase = "WAKE" | "SLEEP";

// When a pet becomes an elder, in ticks since hatch.
export const ELDER_STARTS_AT = 21 * TICKS_PER_DAY;

// Under ruleset 4 an elder sits down to meditate on this day of its life, or
// the tick after the ruleset is recorded if it is already older, and rises a
// SAGE when the meditation ends (SPEC §2.8). Neither is in STAGE_STARTS: SAGE
// depends on when the rule arrived, not on age alone (see `sageStartTickOf`).
export const MEDITATION_STARTS_AT = 40 * TICKS_PER_DAY;
export const MEDITATION_TICKS = 2 * TICKS_PER_DAY;

// Stage boundaries in ticks since hatch (EGG ends at the HATCHED event, whose
// timing is external — the naming vote — so it is not a tick offset).
export const STAGE_STARTS: readonly { stage: Exclude<LifeStage, "EGG">; atTick: number }[] = [
  { stage: "HATCHLING", atTick: 0 },
  { stage: "PUP", atTick: 1 * TICKS_PER_DAY },
  { stage: "JUVENILE", atTick: 3 * TICKS_PER_DAY },
  { stage: "ADULT", atTick: 7 * TICKS_PER_DAY },
  { stage: "ELDER", atTick: ELDER_STARTS_AT },
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
  ELDER: 1.2,
  SAGE: 1,
};
const FORM_MULTIPLIER: Record<AdultForm, number> = { THRIVING: 0.9, STEADY: 1, FRAIL: 1.15 };

export const ENERGY_SLEEP_RECOVERY = 300; // per tick: zero to ~97% over a 9h night

/**
 * The one need the community multiplier does not touch (SPEC §2.7, §23).
 *
 * §23's premise is that a bigger community can supply more care, so it should
 * be asked for more. That premise holds for hunger, hygiene and joy, and it is
 * simply false for energy: nobody can make a pet sleep harder. `LULLABY` is
 * gated below 25% energy, puts the pet *to sleep* rather than waking it, and
 * is the only care action that touches energy at all — so a room of fifty
 * supplies no more rest than a room of two.
 *
 * Scaling it anyway broke the energy economy above about 2.65×. A waking day
 * cost `70 × m × 5,400` and the bar is only 1,000,000, so past that point the
 * day cost more energy than the pet could hold: no night, however generous,
 * could cover it, and the pet made up the shortfall the only way it could —
 * by napping through the afternoon. `FEED`, `PLAY`, `CLEAN` and `LULLABY` are
 * all refused to a sleeping pet (§2.5), so the crowd multiplier spent its own
 * caretakers' care windows. At the 4× cap that was roughly five extra hours
 * asleep a day, and a pet that read as permanently exhausted however many
 * people turned up.
 *
 * Energy stays a live mechanic without the multiplier, because `PLAY` still
 * costs the pet a flat `PLAY_ENERGY_COST` (§2.5): a heavy play day tires it
 * at any community size, which is the tradeoff that was always doing the work.
 */
export const MULTIPLIED_NEEDS: readonly NeedKey[] = NEED_KEYS.filter((need) => need !== "energy");

export type DecayRates = Record<NeedKey, number>;

/** The care multiplier that leaves the decay table as written (1.00×). */
export const BASELINE_CARE_PERMILLE = 1000;

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
  (Object.keys(STAGE_MULTIPLIER) as Exclude<LifeStage, "EGG">[]).flatMap((stage) =>
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
  multiplierPermille = BASELINE_CARE_PERMILLE,
): DecayRates => {
  const rates = DECAY_TABLE.get(`${stage}|${form ?? "-"}|${phase}`);
  if (!rates) throw new Error(`no decay rates for ${stage}/${form}/${phase}`);
  if (multiplierPermille === BASELINE_CARE_PERMILLE) return rates;
  // Integer arithmetic throughout, so a scaled rate is as exactly reproducible
  // as the table it came from. Energy is exempt: see MULTIPLIED_NEEDS.
  const scaled = { ...rates } as DecayRates;
  for (const need of MULTIPLIED_NEEDS) scaled[need] = Math.round((rates[need] * multiplierPermille) / 1000);
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

/** Diminishing returns (SPEC §2.6) — integer round-half-up, no float division. */
export const diminishedMagnitude = (base: number, current: number): number =>
  Math.floor((base * (NEED_MAX - current) + NEED_MAX / 2) / NEED_MAX);

/** Magnitude-shaped actions and the need each restores (MEDICATE is flat). */
export const MAGNITUDE_ACTIONS: Partial<Record<CareAction, { need: NeedKey; base: number }>> = {
  FEED: { need: "hunger", base: ACTION_MAGNITUDE.FEED },
  PLAY: { need: "joy", base: ACTION_MAGNITUDE.PLAY },
  CLEAN: { need: "hygiene", base: ACTION_MAGNITUDE.CLEAN },
  LULLABY: { need: "energy", base: ACTION_MAGNITUDE.LULLABY },
  PET: { need: "joy", base: ACTION_MAGNITUDE.PET },
};

export const PLAY_ENERGY_COST = 60_000; // paid by the pet (SPEC §2.5)
/** What a Bubble Bath Pop run adds to hygiene before the run's performance
 *  scales it and the curve shapes it: 10% at par, which the curve turns into
 *  about 5% on a half-clean Makoto (SPEC §13.3). */
export const BATH_HYGIENE_BASE = 100_000;
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

// ── Sleep (SPEC §2.7) ───────────────────────────────────────────────────────

export const SLEEP_HOUR = 0;
export const WAKE_HOUR = 6;

/**
 * The waking day, in hours — **wrap-aware**, because a night may cross
 * midnight and this one does.
 *
 * Every figure below that is "per day" derives from here rather than naming a
 * number. The caretaker budget's denominator used to read `15 * TICKS_PER_HOUR`
 * with `07:00–22:00` in a comment beside it, which meant changing a bedtime
 * silently desynced every caretaker's weekly allowance from the decay it is
 * supposed to cover — a whole class of bug that cannot happen now.
 */
export const AWAKE_HOURS = (SLEEP_HOUR - WAKE_HOUR + 24) % 24;
export const ASLEEP_HOURS = 24 - AWAKE_HOURS;

/** The last hour before bed, wrap-aware — the room dims, the day's goal
 *  makes its evening check (SPEC §21.7, §22.2). */
export const HOUR_BEFORE_SLEEP = (SLEEP_HOUR + 23) % 24;

// ── Caretaker budget (SPEC §2.5) ────────────────────────────────────────────

// Applied restoration per (caretaker, need) over any rolling 7 pet-days is
// capped at this many days' worth of nominal decay.
//
// It MUST stay below BUDGET_WINDOW_DAYS. At 7 a single caretaker could supply
// a whole week unaided, which deletes the premise the whole game is built on
// (SPEC §1.2) — a property test pins it rather than this comment.
//
// 4 of 7 is the ratio the whole design rests on — one person short of a week,
// two just above it. It is held at every community size by scaling the
// allowance with the multiplier (`weeklyBudget` below), not by raising this.
export const CARETAKER_WEEKLY_BUDGET_DAYS = 4;
export const BUDGET_WINDOW_DAYS = 7;

const AWAKE_TICKS_PER_DAY = AWAKE_HOURS * TICKS_PER_HOUR;
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

/** One caretaker's weekly allowance at the baseline difficulty. */
export const WEEKLY_BUDGET: Record<NeedKey, number> = (() => {
  const budget = {} as Record<NeedKey, number>;
  for (const need of NEED_KEYS) budget[need] = CARETAKER_WEEKLY_BUDGET_DAYS * DAILY_DECAY[need];
  return budget;
})();

/**
 * The same allowance at a community's difficulty (SPEC §2.5, §23).
 *
 * The allowance is denominated in days of *nominal* decay while the demand it
 * is measured against is scaled by the care multiplier, so leaving it flat
 * silently tightened the design's central ratio as a community grew: a week
 * costs `7 × m` nominal days, and against a fixed allowance of 4 the number of
 * caretakers required to break even ran 1.75 → 2.94 → 4.95 → 7.00 across the
 * multiplier's range. "Barely possible for two, comfortable for three" was
 * only ever true at 1×, and the people who met the difference were the
 * regulars — the only ones who ever spend an allowance to the end.
 *
 * Scaling it holds that ratio at 1.75 everywhere. Total supply still rises
 * with headcount, which is §23's actual premise; what stops rising is the
 * share of a week any one person is asked to carry.
 */
export const weeklyBudget = (need: NeedKey, multiplierPermille = 1000): number =>
  multiplierPermille === 1000 ? WEEKLY_BUDGET[need] : Math.round((WEEKLY_BUDGET[need] * multiplierPermille) / 1000);

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
// The Sage's blessing (SPEC §2.8): an egg laid after a Sage's death is held to
// a gentler childhood, ten points under each line.
export const FORM_THRIVING_AT_BLESSED = 650_000;
export const FORM_STEADY_AT_BLESSED = 300_000;
/** The careScore lines a generation's adult form is decided against. */
export const formThresholds = (blessed: boolean): { thriving: number; steady: number } =>
  blessed
    ? { thriving: FORM_THRIVING_AT_BLESSED, steady: FORM_STEADY_AT_BLESSED }
    : { thriving: FORM_THRIVING_AT, steady: FORM_STEADY_AT };

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
