import { describe, expect, it } from "vitest";
import { diminishedMagnitude, reduce } from "./reduce";
import { canPerform } from "./validate";
import { project } from "./project";
import { genesis } from "./genesis";
import { budgetRemaining, caretakerRecord } from "./score";
import { quirks } from "./quirks";
import { FOOD_ITEMS, QUIRK_DISLIKED_PERCENT, QUIRK_FAVORITE_PERCENT, type FoodItemId } from "./economy";
import { EventLog, hatchedState, replay, TEST_GENERATION, testCtx } from "./testkit";
import { WANT_EXPIRY_JOY_DEBIT, windowEndTick, windowIndexAt, type Want } from "./wants";
import {
  ACTION_MAGNITUDE,
  COOLDOWNS,
  HEALTH_MAX,
  MEDICATE_HEALTH_RESTORE,
  NEED_MAX,
  PLAY_ENERGY_COST,
  TICKS_PER_HOUR,
  WEEKLY_BUDGET,
} from "./tuning";

const ctx = testCtx();

describe("diminishing returns (SPEC §2.6)", () => {
  it("matches the worked example from empty", () => {
    // From 0% hunger, successive feeds apply 25.0%, 18.75%, 14.06%, ...
    let value = 0;
    const expected = [250_000, 187_500, 140_625, 105_469, 79_102, 59_326, 44_495];
    for (const want of expected) {
      const applied = diminishedMagnitude(ACTION_MAGNITUDE.FEED, value);
      expect(applied).toBe(want);
      value += applied;
    }
  });

  it("applies nothing at full", () => {
    expect(diminishedMagnitude(ACTION_MAGNITUDE.FEED, NEED_MAX)).toBe(0);
  });

  it("is monotone: higher current value, smaller magnitude", () => {
    let previous = Infinity;
    for (let value = 0; value <= NEED_MAX; value += 50_000) {
      const applied = diminishedMagnitude(ACTION_MAGNITUDE.FEED, value);
      expect(applied).toBeLessThanOrEqual(previous);
      previous = applied;
    }
  });
});

describe("reduce", () => {
  it("rejects out-of-order events", () => {
    const log = new EventLog();
    log.hatched(0);
    const state = replay(log.events, ctx);
    const later = project(state, 100, ctx).state;
    const stale = new EventLog();
    stale.hatched(0);
    expect(() => reduce(later, stale.care(50, "PET"), ctx)).toThrow(/out of order/);
  });

  it("HATCHED births the pet with full needs and health", () => {
    const egg = genesis(TEST_GENERATION);
    const log = new EventLog();
    const { state } = reduce(egg, log.hatched(180, "Makoto"), ctx);
    expect(state.bornAtTick).toBe(180);
    expect(state.generation.name).toBe("Makoto");
    expect(state.needs).toEqual({ hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX });
    expect(state.healthRaw).toBe(HEALTH_MAX);
  });

  it("FEED restores hunger through the curve and records cooldowns", () => {
    const state = project(hatchedState(ctx), 1000, ctx).state;
    const log = new EventLog();
    const before = state.needs.hunger;
    const { state: fed, applied } = reduce(state, log.care(1000, "FEED", "emilio"), ctx);
    expect(applied).toBe(diminishedMagnitude(ACTION_MAGNITUDE.FEED, before));
    expect(fed.needs.hunger).toBe(before + applied);
    expect(fed.lastActionTick.FEED).toBe(1000);
    const record = fed.caretakers.find((c) => c.id === "emilio");
    expect(record?.lastActionTick.FEED).toBe(1000);
  });

  it("PLAY restores joy and costs the pet energy", () => {
    const state = project(hatchedState(ctx), 1000, ctx).state;
    const log = new EventLog();
    const { state: played, applied } = reduce(state, log.care(1000, "PLAY"), ctx);
    expect(played.needs.joy).toBe(state.needs.joy + applied);
    expect(played.needs.energy).toBe(state.needs.energy - PLAY_ENERGY_COST);
  });

  it("MEDICATE cures sickness, restores flat health, and is budget-exempt", () => {
    const base = project(hatchedState(ctx), 1000, ctx).state;
    const sickState = { ...base, sick: true, sickSinceTick: 900, healthRaw: HEALTH_MAX / 2 };
    const log = new EventLog();
    const { state: cured, milestones } = reduce(sickState, log.care(1000, "MEDICATE"), ctx);
    expect(cured.sick).toBe(false);
    expect(cured.sickSinceTick).toBeNull();
    expect(cured.healthRaw).toBe(HEALTH_MAX / 2 + MEDICATE_HEALTH_RESTORE);
    expect(milestones.some((m) => m.kind === "RECOVERED")).toBe(true);
  });

  it("LULLABY puts an awake pet to sleep", () => {
    const state = project(hatchedState(ctx), 1000, ctx).state;
    const log = new EventLog();
    const { state: lulled, milestones } = reduce(state, log.care(1000, "LULLABY"), ctx);
    expect(lulled.asleep).toBe(true);
    expect(lulled.sleepReason).toBe("LULLABY");
    expect(milestones.some((m) => m.kind === "SLEPT")).toBe(true);
  });

  it("MILESTONE events change nothing", () => {
    const state = project(hatchedState(ctx), 1000, ctx).state;
    const { state: after, applied } = reduce(
      state,
      { type: "MILESTONE", generationId: TEST_GENERATION.id, seq: 99, tick: 1000, kind: "CRITICAL", detail: "hunger" },
      ctx,
    );
    expect(applied).toBe(0);
    expect(after.needs).toEqual(state.needs);
    expect(after.healthRaw).toBe(state.healthRaw);
  });

  it("caps applied restoration at the caretaker's rolling budget (SPEC §2.5)", () => {
    // Exhaust the hunger budget by hand, then verify a feed applies zero.
    const state = project(hatchedState(ctx), 1000, ctx).state;
    const drained = { ...state, needs: { ...state.needs, hunger: 0 } };
    const record = caretakerRecord(drained, "greedy");
    record.budget.hunger = [{ day: 0, applied: WEEKLY_BUDGET.hunger }];
    expect(budgetRemaining(record, "hunger", 1000)).toBe(0);

    const log = new EventLog();
    const { state: fed, applied } = reduce(drained, log.care(1000, "FEED", "greedy"), ctx);
    expect(applied).toBe(0);
    expect(fed.needs.hunger).toBe(0);

    // A different caretaker still has a full budget.
    const { applied: fresh } = reduce(drained, log.care(1001, "FEED", "generous"), ctx);
    expect(fresh).toBeGreaterThan(0);
  });

  it("budget entries expire out of the rolling window", () => {
    const state = project(hatchedState(ctx), 1000, ctx).state;
    const record = caretakerRecord(state, "patient");
    record.budget.hunger = [{ day: 0, applied: WEEKLY_BUDGET.hunger }];
    // Day 7: the day-0 spend has left the 7-day window.
    const later = 7 * 8640 + 100;
    expect(budgetRemaining(record, "hunger", later)).toBe(WEEKLY_BUDGET.hunger);
  });
});

describe("canPerform", () => {
  const bornState = () => project(hatchedState(ctx), 1000, ctx).state;

  it("rejects everything for an egg, anything for the dead", () => {
    const egg = genesis(TEST_GENERATION);
    expect(canPerform(egg, "FEED", "a", ctx)).toMatchObject({ ok: false, reason: "NOT_BORN" });
    const dead = { ...bornState(), diedAtTick: 900 };
    expect(canPerform(dead, "PET", "a", ctx)).toMatchObject({ ok: false, reason: "DEAD" });
  });

  it("enforces the global cooldown with a retry tick", () => {
    const state = bornState();
    const log = new EventLog();
    const { state: fed } = reduce(state, log.care(1000, "FEED"), ctx);
    const result = canPerform(fed, "FEED", "someone-else", ctx);
    expect(result).toMatchObject({ ok: false, reason: "COOLDOWN_GLOBAL", retryAtTick: 1000 + COOLDOWNS.FEED.global });
  });

  it("enforces the per-caretaker cooldown after the global expires", () => {
    const state = bornState();
    const log = new EventLog();
    const { state: fed } = reduce(state, log.care(1000, "FEED", "emilio"), ctx);
    const later = project(fed, 1000 + COOLDOWNS.FEED.global, ctx).state;
    expect(canPerform(later, "FEED", "someone-else", ctx)).toMatchObject({ ok: true });
    expect(canPerform(later, "FEED", "emilio", ctx)).toMatchObject({
      ok: false,
      reason: "COOLDOWN_CARETAKER",
      retryAtTick: 1000 + COOLDOWNS.FEED.caretaker,
    });
  });

  it("blocks feeding, playing, and cleaning while asleep — but not petting", () => {
    const night = project(hatchedState(ctx), 16 * TICKS_PER_HOUR, ctx).state;
    expect(night.asleep).toBe(true);
    expect(canPerform(night, "FEED", "a", ctx)).toMatchObject({ ok: false, reason: "ASLEEP" });
    expect(canPerform(night, "PLAY", "a", ctx)).toMatchObject({ ok: false, reason: "ASLEEP" });
    expect(canPerform(night, "CLEAN", "a", ctx)).toMatchObject({ ok: false, reason: "ASLEEP" });
    expect(canPerform(night, "PET", "a", ctx)).toMatchObject({ ok: true });
  });

  it("gates PLAY on energy", () => {
    const state = bornState();
    const tired = { ...state, needs: { ...state.needs, energy: 50_000 } };
    expect(canPerform(tired, "PLAY", "a", ctx)).toMatchObject({ ok: false, reason: "TOO_TIRED" });
  });

  it("gates MEDICATE on sickness", () => {
    const state = bornState();
    expect(canPerform(state, "MEDICATE", "a", ctx)).toMatchObject({ ok: false, reason: "NOT_SICK" });
    expect(canPerform({ ...state, sick: true }, "MEDICATE", "a", ctx)).toMatchObject({ ok: true });
  });

  it("gates LULLABY on night or low energy", () => {
    const day = bornState();
    expect(canPerform(day, "LULLABY", "a", ctx)).toMatchObject({ ok: false, reason: "NOT_SLEEPY" });
    const drowsy = { ...day, needs: { ...day.needs, energy: 200_000 } };
    expect(canPerform(drowsy, "LULLABY", "a", ctx)).toMatchObject({ ok: true });
    const night = project(hatchedState(ctx), 16 * TICKS_PER_HOUR, ctx).state;
    expect(canPerform(night, "LULLABY", "a", ctx)).toMatchObject({ ok: true });
  });
});

describe("economy items (SPEC §13)", () => {
  const bornState = () => project(hatchedState(ctx), 1000, ctx).state;

  it("food items scale FEED through the curve and add the joy bonus", () => {
    const state = { ...bornState(), needs: { hunger: 0, energy: 500_000, hygiene: 500_000, joy: 100_000 } };
    const log = new EventLog();
    const plain = reduce(state, log.care(1000, "FEED", "a"), ctx);
    const boosted = reduce(state, { ...log.care(1001, "FEED", "b"), tick: 1000, itemId: "fish_feast" }, ctx);
    // 145% base through the same curve: strictly more hunger restored.
    expect(boosted.applied).toBeGreaterThan(plain.applied);
    expect(boosted.state.needs.joy).toBe(state.needs.joy + 35_000);
    expect(plain.state.needs.joy).toBe(state.needs.joy);
  });

  it("generational taste scales the same meal up or down (SPEC §21.4)", () => {
    const taste = quirks(TEST_GENERATION.seed);
    const state = { ...bornState(), needs: { hunger: 0, energy: 500_000, hygiene: 500_000, joy: 100_000 } };
    const log = new EventLog();
    const loved = reduce(state, { ...log.care(1000, "FEED", "a"), tick: 1000, itemId: taste.favoriteFood }, ctx);
    const loathed = reduce(state, { ...log.care(1001, "FEED", "b"), tick: 1000, itemId: taste.dislikedFood }, ctx);

    // Both meals run the same curve from the same empty stomach, so each
    // one's result is its item scale and then its taste scale, in that order.
    const expected = (itemId: string, tastePercent: number): number => {
      const item = Math.floor((ACTION_MAGNITUDE.FEED * FOOD_ITEMS[itemId as FoodItemId].scalePercent) / 100);
      return diminishedMagnitude(Math.floor((item * tastePercent) / 100), 0);
    };
    expect(loved.applied).toBe(expected(taste.favoriteFood, QUIRK_FAVORITE_PERCENT));
    expect(loathed.applied).toBe(expected(taste.dislikedFood, QUIRK_DISLIKED_PERCENT));
    expect(loved.applied).toBeGreaterThan(loathed.applied);
  });

  it("leaves a plain feed untouched by taste — no item, no opinion", () => {
    const state = { ...bornState(), needs: { hunger: 0, energy: 500_000, hygiene: 500_000, joy: 100_000 } };
    const log = new EventLog();
    expect(reduce(state, log.care(1000, "FEED", "a"), ctx).applied).toBe(diminishedMagnitude(ACTION_MAGNITUDE.FEED, 0));
  });

  it("TOY_ADDED installs once and raises PLAY magnitude for the generation", () => {
    const state = { ...bornState(), needs: { hunger: 500_000, energy: 500_000, hygiene: 500_000, joy: 0 } };
    const log = new EventLog();
    const withToy = reduce(state, { type: "TOY_ADDED", generationId: TEST_GENERATION.id, seq: 90, tick: 1000, itemId: "wheel" }, ctx).state;
    expect(withToy.toys).toEqual(["wheel"]);
    const again = reduce(withToy, { type: "TOY_ADDED", generationId: TEST_GENERATION.id, seq: 91, tick: 1000, itemId: "wheel" }, ctx).state;
    expect(again.toys).toEqual(["wheel"]);

    const plain = reduce(state, log.care(1000, "PLAY", "a"), ctx);
    const withBonus = reduce({ ...again, tick: 1000 }, log.care(1000, "PLAY", "b"), ctx);
    expect(withBonus.applied).toBeGreaterThan(plain.applied);
  });

  it("minigame performance scales PLAY in both directions", () => {
    const state = { ...bornState(), needs: { hunger: 500_000, energy: 500_000, hygiene: 500_000, joy: 0 } };
    const log = new EventLog();
    const base = reduce(state, log.care(1000, "PLAY", "a"), ctx).applied;
    const great = reduce(state, { ...log.care(1001, "PLAY", "b"), tick: 1000, performance: 150 }, ctx).applied;
    const poor = reduce(state, { ...log.care(1002, "PLAY", "c"), tick: 1000, performance: 50 }, ctx).applied;
    expect(great).toBeGreaterThan(base);
    expect(poor).toBeLessThan(base);
  });

  it("super medicine bypasses cooldowns but never the sickness gate", () => {
    const base = bornState();
    const sick = { ...base, sick: true, sickSinceTick: 900 };
    const log = new EventLog();
    const { state: cured } = reduce(sick, log.care(1000, "MEDICATE", "a"), ctx);
    // Ordinary medicine is now cooling down globally; super medicine is not.
    const resick = { ...cured, sick: true, sickSinceTick: 1001, tick: 1001 };
    expect(canPerform(resick, "MEDICATE", "b", ctx)).toMatchObject({ ok: false, reason: "COOLDOWN_GLOBAL" });
    expect(canPerform(resick, "MEDICATE", "b", ctx, "super_medicine")).toMatchObject({ ok: true });
    // But a healthy pet still rejects it.
    expect(canPerform({ ...cured, tick: 1001 }, "MEDICATE", "b", ctx, "super_medicine")).toMatchObject({ ok: false, reason: "NOT_SICK" });
  });
});

describe("want events (SPEC §25.2)", () => {
  const opened = (seq: number, tick: number, want: Want, windowIndex = windowIndexAt(tick)) =>
    ({ type: "WANT_OPENED", generationId: TEST_GENERATION.id, seq, tick, windowIndex, want }) as const;
  const expired = (seq: number, tick: number, windowIndex: number) =>
    ({ type: "WANT_EXPIRED", generationId: TEST_GENERATION.id, seq, tick, windowIndex }) as const;

  it("keeps both fields off genesis state — pre-feature logs fold byte-identically", () => {
    const state = genesis(TEST_GENERATION);
    expect("wantOpen" in state).toBe(false);
    expect("wantSettledWindow" in state).toBe(false);
  });

  it("WANT_OPENED sets the open want from its authoritative payload", () => {
    const state = hatchedState(ctx);
    const { state: open } = reduce(state, opened(90, 1000, { kind: "cuddle" }), ctx);
    expect(open.wantOpen).toEqual({ window: windowIndexAt(1000), kind: "cuddle" });
    // Conditional spread: no itemId key at all, not an undefined one.
    expect("itemId" in open.wantOpen!).toBe(false);
    // Nothing settled yet — the mark stays absent, like population before §23.
    expect("wantSettledWindow" in open).toBe(false);
  });

  it("a second open while one is live is a no-op", () => {
    const state = hatchedState(ctx);
    const { state: open } = reduce(state, opened(90, 1000, { kind: "cuddle" }), ctx);
    const { state: again } = reduce(open, opened(91, 1600, { kind: "dust-bath" }), ctx);
    expect(again.wantOpen).toEqual({ window: windowIndexAt(1000), kind: "cuddle" });
  });

  it("expiry debits joy through the clamp, settles the window, and clears to explicit null", () => {
    const state = hatchedState(ctx);
    const window = windowIndexAt(1000);
    const { state: open } = reduce(state, opened(90, 1000, { kind: "cuddle" }), ctx);
    const boundary = windowEndTick(window);
    const control = project(open, boundary, ctx).state.needs.joy;
    const { state: lapsed } = reduce(open, expired(91, boundary, window), ctx);
    expect(lapsed.needs.joy).toBe(control - WANT_EXPIRY_JOY_DEBIT);
    expect(lapsed.wantSettledWindow).toBe(window);
    expect(lapsed.wantOpen).toBeNull();
    expect("wantOpen" in lapsed).toBe(true);
  });

  it("a settled window can never re-open, so the debit cannot double", () => {
    const state = hatchedState(ctx);
    const window = windowIndexAt(1000);
    const boundary = windowEndTick(window);
    const { state: open } = reduce(state, opened(90, 1000, { kind: "cuddle" }), ctx);
    const { state: lapsed } = reduce(open, expired(91, boundary, window), ctx);
    // A lost Redis once-key re-appends both events for the SAME window;
    // the high-water mark makes both fold to nothing.
    const { state: reopened } = reduce(lapsed, opened(92, boundary + 5, { kind: "cuddle" }, window), ctx);
    expect(reopened.wantOpen).toBeNull();
    const control = project(lapsed, boundary + 6, ctx).state.needs.joy;
    const { state: relapsed } = reduce(reopened, expired(93, boundary + 6, window), ctx);
    expect(relapsed.needs.joy).toBe(control);
    expect(relapsed.wantSettledWindow).toBe(window);
  });

  it("settlement never blocks the next window from opening", () => {
    const state = hatchedState(ctx);
    const window = windowIndexAt(1000);
    const { state: open } = reduce(state, opened(90, 1000, { kind: "cuddle" }), ctx);
    const { state: lapsed } = reduce(open, expired(91, windowEndTick(window), window), ctx);
    const nextTick = windowEndTick(window) + 5;
    const { state: next } = reduce(lapsed, opened(92, nextTick, { kind: "dust-bath" }), ctx);
    expect(next.wantOpen).toEqual({ window: window + 1, kind: "dust-bath" });
  });

  it("expiry for a window that is not open is a no-op", () => {
    const state = hatchedState(ctx);
    const control = project(state, 3000, ctx).state.needs.joy;
    const { state: after } = reduce(state, expired(90, 3000, 5), ctx);
    expect(after.needs.joy).toBe(control);
    expect("wantSettledWindow" in after).toBe(false);
  });

  it("the debit clamps at zero instead of going negative", () => {
    const drained = { ...project(hatchedState(ctx), 1000, ctx).state };
    drained.needs = { ...drained.needs, joy: 20_000 };
    const window = windowIndexAt(1000);
    const { state: open } = reduce(drained, opened(90, 1000, { kind: "cuddle" }), ctx);
    const { state: lapsed } = reduce(open, expired(91, windowEndTick(window), window), ctx);
    expect(lapsed.needs.joy).toBe(0);
  });
});
