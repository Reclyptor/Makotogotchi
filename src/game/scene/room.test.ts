// Visible growth (SPEC §21.9). The scene's only job here is arithmetic — a
// stage picks a scale, and a scale picks a rectangle — so both halves are
// tested directly rather than through a canvas.

import { describe, expect, it } from "vitest";
import { Room, STAGE_SCALE, stageScale } from "./room";
import { drawRect } from "../engine/atlas";
import { SPRITE_FRAMES } from "../atlas.generated";
import { derive } from "@/sim/derive";
import { hatchedState, projectImmortal, testCtx } from "@/sim/testkit";
import { STAGE_STARTS, TICKS_PER_DAY, type LifeStage } from "@/sim/tuning";

const ctx = testCtx();
const RAMP: LifeStage[] = ["HATCHLING", "PUP", "JUVENILE", "ADULT", "ELDER"];

describe("stage scale", () => {
  it("grows a hatchling into an adult and never shrinks along the way", () => {
    expect(stageScale("HATCHLING")).toBe(0.8);
    expect(stageScale("JUVENILE")).toBe(0.9);
    expect(stageScale("ADULT")).toBe(1);
    expect(stageScale("ELDER")).toBe(1);
    for (let index = 1; index < RAMP.length; index++) {
      expect(stageScale(RAMP[index]!)).toBeGreaterThanOrEqual(stageScale(RAMP[index - 1]!));
    }
    expect(Object.keys(STAGE_SCALE).sort()).toEqual([...RAMP, "EGG"].sort());
  });

  it("follows the derived stage the sim reports, hatch through elderhood", () => {
    const room = new Room();
    const born = hatchedState(ctx);
    for (const { stage, atTick } of STAGE_STARTS) {
      const state = projectImmortal(born, atTick + 1, ctx);
      room.syncDerived(derive(state), state.asleep, 0);
      expect(room.petScale).toBe(stageScale(stage));
    }
    // The elder keeps the adult's size — age shows in the brows, not the bulk.
    const elder = projectImmortal(born, 22 * TICKS_PER_DAY, ctx);
    room.syncDerived(derive(elder), elder.asleep, 0);
    expect(room.petScale).toBe(1);
  });

  it("scales the drawn rectangle around a fixed bottom-center anchor", () => {
    const frame = SPRITE_FRAMES.idleSide1;
    const adult = drawRect(frame, 130, 172, 1);
    const hatchling = drawRect(frame, 130, 172, stageScale("HATCHLING"));

    expect(adult).toEqual({ dx: Math.round(130 - frame.w / 2), dy: 172 - frame.h, dw: frame.w, dh: frame.h });
    expect(hatchling.dw).toBe(Math.round(frame.w * 0.8));
    expect(hatchling.dh).toBe(Math.round(frame.h * 0.8));
    // Same floor, same centre line: only the silhouette changes.
    expect(hatchling.dy + hatchling.dh).toBe(172);
    expect(hatchling.dx + hatchling.dw / 2).toBeCloseTo(130, 0);
  });
});
