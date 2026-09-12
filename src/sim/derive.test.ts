// Vitality is presentational, but it makes a claim about the simulation —
// that health is climbing back, or is not — so it is held to what project.ts
// actually does to health over the next tick.

import { describe, expect, it } from "vitest";
import { derive } from "./derive";
import { project } from "./project";
import { hatchedState, projectImmortal, testCtx } from "./testkit";
import type { PetState } from "./model";
import { CRITICAL_THRESHOLD, HEALTH_MAX, NEED_MAX, TICKS_PER_DAY } from "./tuning";

const ctx = testCtx();

const contented = (state: PetState): PetState => ({
  ...state,
  needs: { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX },
  sick: false,
  asleep: false,
});

const adult = contented(projectImmortal(hatchedState(ctx), 10 * TICKS_PER_DAY, ctx));
const elder = contented(projectImmortal(hatchedState(ctx), 22 * TICKS_PER_DAY, ctx));
const nearDeath = (state: PetState): PetState => ({ ...state, healthRaw: HEALTH_MAX / 100 });

const healthAfterOneTick = (state: PetState): number => project(state, state.tick + 1, ctx).state.healthRaw;

describe("vitality", () => {
  it("is well above the critical line, however the needs stand", () => {
    expect(derive(adult).vitality).toBe("well");
    expect(derive({ ...adult, healthRaw: HEALTH_MAX / 4 }).vitality).toBe("well");
    expect(derive({ ...adult, healthRaw: HEALTH_MAX / 4, sick: true }).vitality).toBe("well");
  });

  it("calls a nursed-back pet recovering, and health really does climb", () => {
    const state = nearDeath(adult);
    expect(derive(state).stage).toBe("ADULT");
    expect(derive(state).vitality).toBe("recovering");
    expect(healthAfterOneTick(state)).toBeGreaterThan(state.healthRaw);
  });

  it("lets a well-kept elder recover, and calls a neglected one frail", () => {
    const kept = nearDeath(elder);
    expect(derive(kept).stage).toBe("ELDER");
    expect(derive(kept).vitality).toBe("recovering");
    expect(healthAfterOneTick(kept)).toBeGreaterThan(kept.healthRaw);

    const thin = { ...kept, needs: { hunger: 300_000, energy: 300_000, hygiene: 300_000, joy: 300_000 } };
    expect(derive(thin).ailments).toEqual([]);
    expect(derive(thin).vitality).toBe("frail");
    expect(healthAfterOneTick(thin)).toBeLessThan(thin.healthRaw);
  });

  it("calls an elder fading below half health while its needs sit short of the hold line", () => {
    const thin = { ...elder, healthRaw: HEALTH_MAX * 0.4, needs: { hunger: 500_000, energy: 500_000, hygiene: 500_000, joy: 500_000 } };
    expect(derive(thin).vitality).toBe("fading");
    expect(healthAfterOneTick(thin)).toBeLessThan(thin.healthRaw);
    // Lift the mean past the hold line and the same health reads as well, climbing.
    const held = { ...thin, needs: { hunger: 650_000, energy: 650_000, hygiene: 650_000, joy: 650_000 } };
    expect(derive(held).vitality).toBe("well");
    expect(healthAfterOneTick(held)).toBeGreaterThan(held.healthRaw);
    // An adult at the same health and needs is simply well.
    expect(derive({ ...adult, healthRaw: HEALTH_MAX * 0.4, needs: thin.needs }).vitality).toBe("well");
  });

  it("calls a sick pet frail: the sickness drains exactly what regen restores", () => {
    const state = { ...nearDeath(adult), sick: true };
    expect(derive(state).vitality).toBe("frail");
    expect(healthAfterOneTick(state)).toBeLessThanOrEqual(state.healthRaw);
  });

  it("calls a pet with a critical need frail even before the ailment shows", () => {
    // Hunger between the critical line and the starving onset drains health
    // without naming an ailment — the copy must not promise recovery there.
    const state = { ...nearDeath(adult), needs: { ...adult.needs, hunger: CRITICAL_THRESHOLD - 1 } };
    expect(derive(state).ailments).toEqual([]);
    expect(derive(state).vitality).toBe("frail");
    expect(healthAfterOneTick(state)).toBeLessThan(state.healthRaw);
  });
});
