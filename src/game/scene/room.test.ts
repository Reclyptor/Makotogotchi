// The scene's geometry: a stage picks a scale, a scale picks a rectangle
// (SPEC §21.9), and the wander band keeps whatever is drawn inside the room.
// Mostly arithmetic, tested directly; the one case that needs a canvas gets a
// recording stub rather than a real one.

import { describe, expect, it } from "vitest";
import { Room, ROOM_WIDTH, STAGE_SCALE, stageScale, wanderBand } from "./room";
import { RUG } from "./backdrop";
import { drawRect } from "../engine/atlas";
import { BASE_CLIPS, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, WALK_CLIP } from "../anim/clips";
import { SPRITE_FRAMES, type FrameName } from "../atlas.generated";
import { derive } from "@/sim/derive";
import { hatchedState, projectImmortal, testCtx } from "@/sim/testkit";
import { HEALTH_MAX, NEED_MAX, STAGE_STARTS, TICKS_PER_DAY, type LifeStage } from "@/sim/tuning";

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

// Petting shifted the whole room off to the left, sometimes, and stayed that
// way. Two faults in series: care is stamped with performance.now() in the
// stream handler while the scene renders with the requestAnimationFrame
// timestamp — sampled earlier in the same frame — so the clip started in the
// frame's future and named no frame at all; and the resulting throw escaped
// the mirrored draw before its restore(), leaking that mirror into every
// frame after it.
describe("rendering a pet that was just petted", () => {
  /** Records where sprites land, with the current transform applied. */
  const recordingContext = () => {
    const drawn: { x0: number; x1: number }[] = [];
    let matrix = { a: 1, d: 1, e: 0, f: 0 };
    const stack: (typeof matrix)[] = [];
    const noop = (): void => {};
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: "",
      font: "",
      textAlign: "",
      setTransform: (a: number, _b: number, _c: number, d: number, e: number, f: number) => {
        matrix = { a, d, e, f };
        stack.length = 0;
      },
      save: () => void stack.push({ ...matrix }),
      restore: () => {
        matrix = stack.pop() ?? matrix;
      },
      translate: (x: number, y: number) => {
        matrix.e += matrix.a * x;
        matrix.f += matrix.d * y;
      },
      scale: (x: number, y: number) => {
        matrix.a *= x;
        matrix.d *= y;
      },
      beginPath: noop,
      rect: noop,
      clip: noop,
      fillRect: noop,
      fillText: noop,
      drawImage: (...args: number[]) => {
        // The 9-argument form: the last four are the destination rectangle.
        const [dx, , dw] = args.slice(5);
        const a = matrix.e + matrix.a * dx!;
        const b = matrix.e + matrix.a * (dx! + dw!);
        drawn.push({ x0: Math.min(a, b), x1: Math.max(a, b) });
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
  };

  const contentedRoom = () => {
    const room = new Room();
    // No image loads in a test; a stand-in makes the atlas draw.
    (room.atlas as unknown as { image: unknown }).image = {};
    const born = hatchedState(ctx);
    const settled = projectImmortal(born, TICKS_PER_DAY, ctx);
    const contented = {
      ...settled,
      needs: { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX },
      healthRaw: HEALTH_MAX,
      sick: false,
      asleep: false,
    };
    room.syncAtmosphere({ hour: 13, minute: 0, month: 6, dayIndex: 1, seed: 1, themeId: null, ownedVenues: [] });
    return { room, derived: derive(contented) };
  };

  it("stays inside the room when the pet is stamped ahead of the frame clock", () => {
    const { ctx: canvas, drawn } = recordingContext();
    const { room, derived } = contentedRoom();
    expect(derived.animation).toBe("idle");

    for (let frame = 0; frame < 600; frame++) {
      const now = frame * 16;
      // The race: the handler's clock is a few ms ahead of this frame's.
      if (frame % 37 === 0) room.onCare("PET", "💛 you", now + 8);
      room.syncDerived(derived, false, now);
      room.update(16);
      drawn.length = 0;
      expect(() => room.render(canvas, now), `frame ${frame}`).not.toThrow();
      for (const { x0, x1 } of drawn) {
        expect.soft(x0, `frame ${frame} crosses the left wall`).toBeGreaterThanOrEqual(0);
        expect.soft(x1, `frame ${frame} crosses the right wall`).toBeLessThanOrEqual(ROOM_WIDTH);
      }
    }
    expect(drawn.length).toBeGreaterThan(0);
  });
});

// The pet is 137px wide in a 260px room. The wander band used to be the rug's
// own span, which is a range of *centres* — so at either end the pet stood
// half off the rug with its silhouette running through the wall.
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

  // Not just the idle pose: whatever the pet is doing when it comes to rest —
  // sneezing, cheering, asleep in its bed — is drawn at wherever the band left
  // it, and reactions are not all the idle frame's size.
  it("keeps every frame it can draw inside the room, at every stage", () => {
    const frames = new Set<FrameName>();
    for (const clip of Object.values(BASE_CLIPS)) clip.frames.forEach((frame) => frames.add(frame));
    for (const clip of Object.values(ONE_SHOT_CLIPS)) clip.frames.forEach((frame) => frames.add(frame));
    for (const clip of IDLE_FLOURISH_CLIPS) clip.frames.forEach((frame) => frames.add(frame));
    WALK_CLIP.frames.forEach((frame) => frames.add(frame));
    expect(frames.size).toBeGreaterThan(20);

    for (const scale of Object.values(STAGE_SCALE)) {
      const band = wanderBand(scale);
      for (const name of frames) {
        for (const petX of [band.min, band.max]) {
          const { dx, dw } = drawRect(SPRITE_FRAMES[name], Math.round(petX), 172, scale);
          expect.soft(dx, `${name} at ${scale}× crosses the left wall`).toBeGreaterThanOrEqual(0);
          expect.soft(dx + dw, `${name} at ${scale}× crosses the right wall`).toBeLessThanOrEqual(ROOM_WIDTH);
        }
      }
    }
  });

  it("collapses to a fixed spot rather than inverting when the pet outgrows the rug", () => {
    const band = wanderBand(4);
    expect(band.min).toBe(band.max);
    expect(band.min).toBe(ROOM_WIDTH / 2);
  });
});
