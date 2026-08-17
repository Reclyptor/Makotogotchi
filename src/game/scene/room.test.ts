// Visible growth (SPEC §21.9). The scene's only job here is arithmetic — a
// stage picks a scale, and a scale picks a rectangle — so both halves are
// tested directly rather than through a canvas.

import { describe, expect, it } from "vitest";
import { Room, ROOM_WIDTH, STAGE_SCALE, stageScale, wanderBand } from "./room";
import { RUG } from "./backdrop";
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

// The pet is 137px wide in a 260px room. The wander band used to be the
// rug's own span, which is a range of *centres* — so at either end the pet
// stood half off the rug with its silhouette running through the wall.
describe("the wander band", () => {
  // The widest pet frame, and how far the idle pose's outer foot reaches
  // from the centre line — both read off the sheet, so the band's promises
  // are checked against the art rather than against its own constants.
  const halfWidth = SPRITE_FRAMES.walk1.w / 2;
  const footReach = SPRITE_FRAMES.idleSide1.w / 2 - 27;

  it("keeps the whole pet inside the room at every stage", () => {
    for (const scale of Object.values(STAGE_SCALE)) {
      const band = wanderBand(scale);
      expect(band.min).toBeLessThanOrEqual(band.max);
      expect(band.min - halfWidth * scale).toBeGreaterThanOrEqual(0);
      expect(band.max + halfWidth * scale).toBeLessThanOrEqual(ROOM_WIDTH);
    }
  });

  it("keeps the pet standing on the rug at every stage", () => {
    for (const scale of Object.values(STAGE_SCALE)) {
      const band = wanderBand(scale);
      expect(band.min - footReach * scale).toBeGreaterThanOrEqual(RUG.x);
      expect(band.max + footReach * scale).toBeLessThanOrEqual(RUG.x + RUG.w);
    }
  });

  it("stays centred on the rug, and a smaller pet gets more room to roam", () => {
    const centre = RUG.x + RUG.w / 2;
    const adult = wanderBand(1);
    const hatchling = wanderBand(STAGE_SCALE.HATCHLING);
    expect((adult.min + adult.max) / 2).toBeCloseTo(centre, 5);
    expect((hatchling.min + hatchling.max) / 2).toBeCloseTo(centre, 5);
    expect(hatchling.max - hatchling.min).toBeGreaterThan(adult.max - adult.min);
  });

  it("collapses to a fixed spot rather than inverting when the pet outgrows the rug", () => {
    const band = wanderBand(4);
    expect(band.min).toBe(band.max);
    expect(band.min).toBe(ROOM_WIDTH / 2);
  });
});
