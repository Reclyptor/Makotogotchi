// The scene's geometry: a stage picks a scale, a scale picks a rectangle
// (SPEC §21.9), and the wander band keeps whatever is drawn inside the room.
// Mostly arithmetic, tested directly; the one case that needs a canvas gets a
// recording stub rather than a real one.

import { describe, expect, it, vi } from "vitest";
import { Room, ROOM_HEIGHT, ROOM_WIDTH, STAGE_SCALE, stageScale, wanderBand } from "./room";
import { RUG } from "./backdrop";
import { SPECTACLE_MS } from "./party";
import { drawRect } from "../engine/atlas";
import { BASE_CLIPS, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, WALK_CLIP } from "../anim/clips";
import { SPRITE_FRAMES, type FrameName } from "../atlas.generated";
import { derive } from "@/sim/derive";
import { hatchedState, projectImmortal, testCtx } from "@/sim/testkit";
import { HEALTH_MAX, NEED_MAX, STAGE_STARTS, TICKS_PER_DAY, type LifeStage } from "@/sim/tuning";

const ctx = testCtx();
const RAMP: LifeStage[] = ["HATCHLING", "PUP", "JUVENILE", "ADULT", "ELDER"];

type Matrix = { a: number; d: number; e: number; f: number };
type Rect = { x: number; y: number; w: number; h: number };
type CanvasState = { matrix: Matrix; clip: Rect | null; alpha: number };
const IDENTITY: Matrix = { a: 1, d: 1, e: 0, f: 0 };

/**
 * A stand-in for CanvasRenderingContext2D that models the real one's state
 * machine, because the parts a fake usually waves away are the parts that
 * bite. Two of them, both verified against Chromium:
 *
 *   • `setTransform` replaces the matrix and touches nothing else. It does
 *     not unwind the save stack, so it cannot undo a `save()` whose
 *     `restore()` never ran.
 *   • a clip, once installed, outlives every later transform change. Only a
 *     `restore()` takes it off — there is no reset for it.
 *
 * `failAtCall` kills the frame on its Nth call, standing in for any throw the
 * loop's guard swallows (engine/loop.ts).
 */
const recordingContext = (failAtCall = -1) => {
  /** Every sprite blit: where it landed, and whether the transform flipped it. */
  const drawn: { x0: number; x1: number; mirrored: boolean }[] = [];
  /** Every full-canvas paint, with the clip that was in force when it landed. */
  const paints: (Rect | null)[] = [];
  const stack: CanvasState[] = [];
  let state: CanvasState = { matrix: { ...IDENTITY }, clip: null, alpha: 1 };
  let path: Rect | null = null;
  let calls = 0;
  let failAt = failAtCall;

  const step = (): void => {
    calls += 1;
    if (calls === failAt) throw new TypeError("the frame died mid-draw");
  };

  const ctx2d = {
    imageSmoothingEnabled: false,
    fillStyle: "",
    font: "",
    textAlign: "",
    get globalAlpha(): number {
      return state.alpha;
    },
    set globalAlpha(value: number) {
      state.alpha = value;
    },
    setTransform: (a: number, _b: number, _c: number, d: number, e: number, f: number) => {
      step();
      state.matrix = { a, d, e, f };
    },
    save: () => void stack.push({ matrix: { ...state.matrix }, clip: state.clip, alpha: state.alpha }),
    restore: () => {
      const top = stack.pop();
      if (top) state = top;
    },
    translate: (x: number, y: number) => {
      step();
      state.matrix.e += state.matrix.a * x;
      state.matrix.f += state.matrix.d * y;
    },
    scale: (x: number, y: number) => {
      step();
      state.matrix.a *= x;
      state.matrix.d *= y;
    },
    beginPath: () => {
      step();
      path = null;
    },
    rect: (x: number, y: number, w: number, h: number) => {
      step();
      path = { x, y, w, h };
    },
    clip: () => {
      step();
      if (path) state.clip = path;
    },
    fillRect: () => step(),
    fillText: () => step(),
    createImageData: (w: number, h: number) => {
      step();
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData: (image: ImageData, dx: number, dy: number) => {
      step();
      // The room is not the only thing laid down as pixels — the framed
      // picture is too (scene/portrait.ts) — and this list is about the
      // full-canvas paint, so a small blit is not one of them.
      const whole = dx === 0 && dy === 0 && image.width === ROOM_WIDTH && image.height === ROOM_HEIGHT;
      if (whole) paints.push(state.clip);
    },
    drawImage: (...args: number[]) => {
      step();
      // The 9-argument form: the last four are the destination rectangle.
      const [dx, , dw] = args.slice(5);
      const a = state.matrix.e + state.matrix.a * dx!;
      const b = state.matrix.e + state.matrix.a * (dx! + dw!);
      drawn.push({ x0: Math.min(a, b), x1: Math.max(a, b), mirrored: state.matrix.a < 0 });
    },
  };

  return {
    ctx: ctx2d as unknown as CanvasRenderingContext2D,
    drawn,
    paints,
    depth: () => stack.length,
    current: () => state,
    calls: () => calls,
    /** Let the next frame run to completion on this same dirty context. */
    survive: () => {
      failAt = -1;
      drawn.length = 0;
      paints.length = 0;
    },
  };
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
  room.syncAtmosphere({ hour: 13, minute: 0, month: 6, dayIndex: 1, seed: 1, themeId: null, venueId: "home" });
  return { room, state: contented, derived: derive(contented) };
};

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

// The gravestone came up with its letters backwards. A stroll to the right
// mirrors the art, the facing outlives the stroll, and the one frame that
// carries text inherited it when she died mid-wander.
describe("the gravestone", () => {
  it("is one still frame, not a cycle through the round alternate design", () => {
    expect(BASE_CLIPS.dead.frames).toEqual(["dead1"]);
  });

  it("keeps its letters readable whichever way she was last walking", () => {
    vi.useFakeTimers();
    try {
      // The stroll picks its destination from Date.now() in nine-second
      // slots; walk the slots until one sends her right of where she stands.
      const strolledRight = (): ReturnType<typeof contentedRoom> => {
        for (let slot = 0; slot < 64; slot++) {
          vi.setSystemTime(slot * 9000);
          const scene = contentedRoom();
          const recorder = recordingContext();
          scene.room.syncDerived(scene.derived, false, 0);
          scene.room.render(recorder.ctx, 1000);
          if (recorder.drawn.some((entry) => entry.mirrored)) return scene;
        }
        throw new Error("no wander slot sent the pet right");
      };
      const { room, state } = strolledRight();

      const recorder = recordingContext();
      room.syncDerived(derive({ ...state, diedAtTick: TICKS_PER_DAY }), false, 2000);
      room.render(recorder.ctx, 3000);
      const gravestone = Math.round(SPRITE_FRAMES.dead1.w * room.petScale);
      expect(recorder.drawn.map((entry) => entry.x1 - entry.x0)).toEqual([gravestone]);
      expect(recorder.drawn.some((entry) => entry.mirrored)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The room came back mirrored, or shifted, or stitched together out of two
// different frames — and stayed that way. Resetting the transform at the top
// of render() was not enough, and could not have been: it is the wrong shape
// of fix. The loop swallows a throwing frame, the throw escapes between a
// save() and its restore(), and what leaks is the whole context state — the
// transform, yes, but also the clip, the alpha, and the depth of the save
// stack. setTransform only ever addressed the first of those, and a clip
// cannot be reset from the inside at all. Meanwhile the scene's only
// full-canvas paint is the backdrop blit, so a leaked transform or clip stops
// the room from being repainted and the surviving pixels of older frames stay
// welded into it for the life of the canvas.
describe("a frame that dies half-drawn", () => {
  it("hands the next frame a context in exactly the state it found it", () => {
    const { room, derived } = contentedRoom();
    room.syncDerived(derived, false, 0);
    // How many calls a whole frame makes — every one of them a place to die.
    const survey = recordingContext();
    room.render(survey.ctx, 0);
    const total = survey.calls();
    expect(total).toBeGreaterThan(20);

    for (let failAt = 1; failAt <= total; failAt++) {
      const canvas = recordingContext(failAt);
      // The loop's guard, exactly as engine/loop.ts does it.
      try {
        room.render(canvas.ctx, 16);
      } catch {
        // swallowed on purpose — one bad frame must not freeze the scene
      }
      const where = `died at call ${failAt} of ${total}`;
      expect.soft(canvas.depth(), `${where}: save stack left deeper`).toBe(0);
      expect.soft(canvas.current().matrix, `${where}: transform left dirty`).toEqual(IDENTITY);
      expect.soft(canvas.current().clip, `${where}: clip left on`).toBeNull();
      expect.soft(canvas.current().alpha, `${where}: alpha left faded`).toBe(1);
    }
  });

  it("paints the whole room again on the very next frame", () => {
    const { room, derived } = contentedRoom();
    room.syncDerived(derived, false, 0);
    const survey = recordingContext();
    room.render(survey.ctx, 0);
    const total = survey.calls();

    for (let failAt = 1; failAt <= total; failAt++) {
      // One context, two frames — which is what the browser hands the loop.
      const canvas = recordingContext(failAt);
      try {
        room.render(canvas.ctx, 16);
      } catch {
        // swallowed on purpose
      }
      canvas.survive();
      room.render(canvas.ctx, 32);

      const where = `recovering from a frame that died at call ${failAt} of ${total}`;
      // The architecture blit is the scene's only full-canvas paint. Land it
      // under a leaked clip and the room stops being repainted at all.
      expect.soft(canvas.paints.length, `${where}: the room was not repainted`).toBeGreaterThan(0);
      expect.soft(canvas.paints[0], `${where}: the room was repainted through a clip`).toBeNull();
      for (const { x0, x1 } of canvas.drawn) {
        expect.soft(x0, `${where}: sprite crosses the left wall`).toBeGreaterThanOrEqual(0);
        expect.soft(x1, `${where}: sprite crosses the right wall`).toBeLessThanOrEqual(ROOM_WIDTH);
      }
    }
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

describe("skipping frames that would paint the same pixels", () => {
  /** How many draw calls a render actually issued at the canvas. */
  const paintedCalls = (recorder: ReturnType<typeof recordingContext>, render: () => void): number => {
    const before = recorder.calls();
    render();
    return recorder.calls() - before;
  };

  it("paints the first frame it is ever given", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000))).toBeGreaterThan(0);
  });

  it("does not paint the same instant twice", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000))).toBe(0);
  });

  it("paints again the moment the pet's clip advances", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    // Idle runs at 900ms a frame, so a second later is a different pose.
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000 + 900))).toBeGreaterThan(0);
  });

  it("paints again when a toast arrives, though nothing else moved", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.onMilestone("all better!", 1000);
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000))).toBeGreaterThan(0);
  });

  it("paints again when the room falls asleep and gains its dimming", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.syncDerived(derived, true, 1000);
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000))).toBeGreaterThan(0);
  });

  it("paints again when the hour redresses the room", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.syncAtmosphere({ hour: 2, minute: 0, month: 6, dayIndex: 1, seed: 1, themeId: null, venueId: "home" });
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000))).toBeGreaterThan(0);
  });

  it("paints again when the communal decor changes", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.decor = { decor: ["plant"], activeCosmetic: null };
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000))).toBeGreaterThan(0);
  });

  it("paints again when a hat goes on", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.decor = { decor: [], activeCosmetic: "crown" };
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000))).toBeGreaterThan(0);
  });

  it("repaints on demand when something outside the room clears the canvas", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.invalidate();
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000))).toBeGreaterThan(0);
  });

  it("still unwinds the context when a skipped frame follows a painted one", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.render(recorder.ctx, 1000);
    expect(recorder.depth()).toBe(0);
    expect(recorder.current().clip).toBeNull();
  });

  it("paints again while the sky is open, and settles once it closes", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    // Asleep, which is when a star shower actually happens — and which also
    // parks the stroll. The wander picks its destination from `Date.now()` in
    // nine-second slots, so an awake pet can silently change facing between
    // two renders of the *same* frame time and repaint for reasons that have
    // nothing to do with the spectacle.
    room.syncDerived(derived, true, 0);
    room.render(recorder.ctx, 1000);
    room.secret("stars", 1000);
    // Mid-run the shower is moving, so an instant that would otherwise have
    // been skipped has to paint.
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 4000))).toBeGreaterThan(0);
    // Once it has elapsed the room goes back to skipping identical frames — a
    // spectacle must not leave the loop repainting forever.
    const after = 1000 + SPECTACLE_MS + 5000;
    room.render(recorder.ctx, after);
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, after))).toBe(0);
  });

  it("keeps the stroll on real time rather than on frames painted", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    // Two renders at the same instant must advance the pet exactly as far as
    // one does — the second is a hash pass, not another step of the walk.
    room.render(recorder.ctx, 1000);
    room.render(recorder.ctx, 1000);
    const twice = recorder.drawn.map((entry) => entry.x0);
    const fresh = contentedRoom();
    const other = recordingContext();
    fresh.room.syncDerived(fresh.derived, false, 0);
    fresh.room.render(other.ctx, 1000);
    expect(twice).toEqual(other.drawn.map((entry) => entry.x0));
  });
});


describe("the ancient code in the room (SPEC §26)", () => {
  const paintedCalls = (recorder: ReturnType<typeof recordingContext>, render: () => void): number => {
    const before = recorder.calls();
    render();
    return recorder.calls() - before;
  };

  it("opens the sky for a caretaker who wants motion", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.secret("stars", 1000);
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 4000))).toBeGreaterThan(0);
  });

  it("under reduced motion the toast carries it alone", () => {
    // SPEC §26.6: the same rule §21.5 already applies to rare events. The
    // toast still lands — it is the in-canvas echo of the feed line — but
    // nothing washes, falls, or streaks.
    const plain = contentedRoom();
    const quiet = contentedRoom();
    quiet.room.reducedMotion = true;

    const plainRec = recordingContext();
    const quietRec = recordingContext();
    plain.room.syncDerived(plain.derived, false, 0);
    quiet.room.syncDerived(quiet.derived, false, 0);
    plain.room.render(plainRec.ctx, 1000);
    quiet.room.render(quietRec.ctx, 1000);

    plain.room.secret("stars", 1000);
    quiet.room.secret("stars", 1000);

    // A frame late in the run: the moving room is still drawing the shower,
    // the still one has nothing left to say once its toast has faded.
    expect(paintedCalls(plainRec, () => plain.room.render(plainRec.ctx, 6000))).toBeGreaterThan(0);
    expect(paintedCalls(quietRec, () => quiet.room.render(quietRec.ctx, 6000))).toBe(0);
  });

  it("does not double-dim a sleeping room", () => {
    // The indigo wash stands in for the night dim (SPEC §26.4); both at once
    // would darken twice and lift in two visible stages.
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, true, 0);
    room.render(recorder.ctx, 1000);
    room.secret("stars", 1000);
    room.render(recorder.ctx, 4000);
    // Nothing to assert about pixels here beyond that it kept drawing; the
    // handover itself is asserted on the Spectacle, which owns the flag.
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 4500))).toBeGreaterThan(0);
  });
});

describe("the skip never hides a frame that differs", () => {
  /**
   * An oracle for "would these two frames look the same", written
   * independently of the digest it is checking: every call is appended
   * verbatim, with the effective transform and paint state that was in force
   * when it happened. Where DigestContext folds all that into one 32-bit
   * number, this keeps the whole stream, so a hash that collides — or a piece
   * of context state the digest forgot to fold in — shows up as two logs that
   * differ while the room thought the frames were the same.
   */
  const callLog = () => {
    const log: string[] = [];
    type State = { m: number[]; alpha: number; fill: string; font: string; align: string };
    const stack: State[] = [];
    let state: State = { m: [1, 0, 0, 1, 0, 0], alpha: 1, fill: "", font: "", align: "" };
    const where = (): string => `[${state.m.join(",")}|${state.alpha}|${state.fill}|${state.font}|${state.align}]`;
    const ctx = {
      imageSmoothingEnabled: false,
      get globalAlpha() {
        return state.alpha;
      },
      set globalAlpha(value: number) {
        state.alpha = value;
      },
      get fillStyle() {
        return state.fill;
      },
      set fillStyle(value: string) {
        state.fill = value;
      },
      get font() {
        return state.font;
      },
      set font(value: string) {
        state.font = value;
      },
      get textAlign() {
        return state.align;
      },
      set textAlign(value: string) {
        state.align = value;
      },
      save: () => {
        log.push("save");
        stack.push({ ...state, m: [...state.m] });
      },
      restore: () => {
        log.push("restore");
        const top = stack.pop();
        if (top) state = top;
      },
      setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
        state.m = [a, b, c, d, e, f];
      },
      translate: (x: number, y: number) => {
        const [a, b, c, d, e, f] = state.m as [number, number, number, number, number, number];
        state.m = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
      },
      scale: (x: number, y: number) => {
        const [a, b, c, d, e, f] = state.m as [number, number, number, number, number, number];
        state.m = [a * x, b * x, c * y, d * y, e, f];
      },
      beginPath: () => log.push("beginPath"),
      rect: (x: number, y: number, w: number, h: number) => log.push(`rect ${x},${y},${w},${h}`),
      clip: () => log.push("clip"),
      fillRect: (x: number, y: number, w: number, h: number) => log.push(`fillRect ${x},${y},${w},${h} ${where()}`),
      fillText: (text: string, x: number, y: number) => log.push(`fillText ${text} ${x},${y} ${where()}`),
      drawImage: (_image: unknown, ...args: number[]) => log.push(`drawImage ${args.join(",")} ${where()}`),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: (_image: unknown, dx: number, dy: number) => log.push(`putImageData ${dx},${dy}`),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
  };

  it("skips only frames whose drawing is identical to what the canvas holds", () => {
    const { room, derived } = contentedRoom();
    room.syncDerived(derived, false, 0);

    let onCanvas: string[] = [];
    let painted = 0;
    let skipped = 0;
    let verified = 0;

    // Twelve seconds at the loop's cadence: long enough to cross idle clip
    // frames, drifting clouds, a full wander slot, and the pet resting again.
    for (let nowMs = 1000; nowMs < 13_000; nowMs += 1000 / 15) {
      const live = callLog();
      room.render(live.ctx, nowMs);

      if (live.log.length > 0) {
        painted += 1;
        onCanvas = live.log;
        continue;
      }

      skipped += 1;
      // Force the identical frame to draw and compare it, call for call,
      // against what is actually on the canvas.
      const forced = callLog();
      room.invalidate();
      room.render(forced.ctx, nowMs);
      expect(forced.log.length, `forced repaint at ${Math.round(nowMs)}ms drew nothing`).toBeGreaterThan(0);
      expect(forced.log, `frame at ${Math.round(nowMs)}ms was skipped but would have differed`).toEqual(onCanvas);
      verified += 1;
    }

    // The run must have exercised both outcomes, or it proves nothing.
    expect(painted).toBeGreaterThan(5);
    expect(skipped).toBeGreaterThan(20);
    expect(verified).toBe(skipped);
  });

  it("catches a scene that moved by a single pixel", () => {
    // A guard on the guard: the oracle above must be able to fail. Nudging
    // one drawn thing has to change the log it compares.
    const { room, derived } = contentedRoom();
    room.syncDerived(derived, false, 0);
    const first = callLog();
    room.render(first.ctx, 1000);
    room.decor = { decor: ["plant"], activeCosmetic: null };
    const second = callLog();
    room.render(second.ctx, 1000);
    expect(second.log).not.toEqual(first.log);
  });
});
