// The scene's geometry: a stage picks a scale, a scale picks a rectangle
// (SPEC §21.9), and the wander band keeps whatever is drawn inside the room.
// Mostly arithmetic, tested directly; the one case that needs a canvas gets a
// recording stub rather than a real one.

import { describe, expect, it, vi } from "vitest";
import { Room, ROOM_HEIGHT, ROOM_WIDTH, STAGE_SCALE, stageScale, wanderBand } from "./room";
import { RUG } from "./backdrop";
import type { AuraPaint, AuraPainter } from "./auraTypes";
import { SPECTACLE_MS } from "./party";
import { drawRect, overlayOffset } from "../engine/placement";
import { BASE_CLIPS, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, WALK_CLIP } from "../anim/clips";
import { HEAD_ANCHORS } from "./head";
import { MOULDING, WALL_SLOTS } from "./ancestors";
import { SPRITE_FRAMES, SPRITE_MASKS, type FrameName } from "../atlas.generated";
import type { HolidayScene } from "./holidays/scene";
import { GARMENT_REGIONS } from "./garment.generated";
import { TEST_GARMENT } from "./garment.testkit";
import { SAGE_CLOAK } from "./sageCloak";
import { derive } from "@/sim/derive";
import { hatchedState, projectImmortal, testCtx } from "@/sim/testkit";
import { HEALTH_MAX, NEED_MAX, STAGE_STARTS, TICKS_PER_DAY, type LifeStage } from "@/sim/tuning";

// The aura's art is Fable's to choose (scene/aura.ts); what the room owes it is
// when, in what order and with what clock it is called. The stand-in marks each
// half in a shared log and puts one rectangle on the canvas that rides the
// clock, so the digest has something to see move.
const drawLog: { half: "behind" | "front" | "pet"; frame: string; nowMs: number; scale: number; reduced: boolean }[] = [];
const stubHalf =
  (half: "behind" | "front"): AuraPaint =>
  (ctx, _atlas, frame, nowMs, scale, reduced) => {
    drawLog.push({ half, frame, nowMs, scale, reduced });
    ctx.fillRect(reduced ? 0 : Math.round(nowMs / 10), 0, 2, 2);
  };
const STUB_AURA: AuraPainter = { behind: stubHalf("behind"), front: stubHalf("front") };

// The scene's real art is not under test here, only what the room does with a
// scene, so a stand-in built from frames that have always been on the sheet —
// each a different size, so a draw can be told from its neighbours.
vi.mock("./holidays", async () => {
  const { CABIN: theme } = await import("./backdrop/theme");
  const { TEST_GARMENT } = await import("./garment.testkit");
  const scene: HolidayScene = {
    id: "halloween",
    theme,
    props: [
      { frame: "rock1", x: 60, y: 150, layer: "behind" },
      { frame: "sock1", x: 200, y: 170, layer: "front", flicker: true },
    ],
    costume: { hat: "coffeeMug", robe: TEST_GARMENT, staff: "wizardStaff" },
    window: { bats: true, moon: [255, 160, 60] },
  };
  return { holidayScene: () => scene };
});

const ctx = testCtx();
const RAMP: LifeStage[] = ["HATCHLING", "PUP", "JUVENILE", "ADULT", "ELDER", "SAGE"];

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
  const drawn: { x0: number; x1: number; y0: number; y1: number; mirrored: boolean }[] = [];
  /** Every filled rectangle, in canvas pixels. */
  const fills: { x0: number; x1: number; y0: number; y1: number; mirrored: boolean }[] = [];
  /** Every full-canvas paint, with the clip that was in force when it landed. */
  const paints: (Rect | null)[] = [];
  /** Every smaller image laid onto the canvas — a picture landing on the wall. */
  const blits: { dx: number; dy: number; width: number; height: number }[] = [];
  /** Everything painted, in the order it landed: a fill with its colour, a sprite with its size. */
  const trail: { fill: string | null; w: number; h: number }[] = [];
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
    fillRect: (x: number, y: number, w: number, h: number) => {
      step();
      trail.push({ fill: String(ctx2d.fillStyle), w, h });
      const { a, d, e, f } = state.matrix;
      const [p, q] = [e + a * x, e + a * (x + w)];
      fills.push({ x0: Math.min(p, q), x1: Math.max(p, q), y0: f + d * y, y1: f + d * (y + h), mirrored: a < 0 });
    },
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
      else blits.push({ dx, dy, width: image.width, height: image.height });
    },
    drawImage: (...args: number[]) => {
      step();
      // The 9-argument form: the last four are the destination rectangle.
      const [dx, dy, dw, dh] = args.slice(5);
      trail.push({ fill: null, w: dw!, h: dh! });
      const a = state.matrix.e + state.matrix.a * dx!;
      const b = state.matrix.e + state.matrix.a * (dx! + dw!);
      const y0 = state.matrix.f + state.matrix.d * dy!;
      drawn.push({ x0: Math.min(a, b), x1: Math.max(a, b), y0, y1: y0 + state.matrix.d * dh!, mirrored: state.matrix.a < 0 });
    },
  };

  return {
    ctx: ctx2d as unknown as CanvasRenderingContext2D,
    drawn,
    fills,
    paints,
    blits,
    trail,
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

const contentedRoom = (days = 1) => {
  const room = new Room();
  // No image loads in a test; a stand-in makes the atlas draw.
  (room.atlas as unknown as { image: unknown }).image = {};
  const born = hatchedState(ctx);
  const settled = projectImmortal(born, days * TICKS_PER_DAY, ctx);
  const contented = {
    ...settled,
    needs: { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX },
    healthRaw: HEALTH_MAX,
    sick: false,
    asleep: false,
  };
  room.syncAtmosphere({ hour: 13, minute: 0, month: 6, dayIndex: 1, seed: 1, themeId: null, venueId: "home", holidayId: null, fireworks: false });
  return { room, state: contented, derived: derive(contented) };
};

// Brought to ruleset 4 on its 22nd day: it meditates from day 40 and is a
// Sage from day 42 (SPEC §2.8).
const agedRoom = (days: number) => {
  const { room, state } = contentedRoom(22);
  const aged = {
    ...projectImmortal({ ...state, sageRuleFromTick: state.tick }, days * TICKS_PER_DAY, ctx),
    needs: state.needs,
    sick: false,
    asleep: false,
  };
  return { room, aged, derived: derive(aged) };
};

describe("stage scale", () => {
  it("grows a hatchling into an adult and never shrinks along the way", () => {
    expect(stageScale("HATCHLING")).toBe(0.8);
    expect(stageScale("JUVENILE")).toBe(0.9);
    expect(stageScale("ADULT")).toBe(1);
    expect(stageScale("ELDER")).toBe(1);
    expect(stageScale("SAGE")).toBe(1);
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
// carries text inherited it when the pet died mid-wander.
describe("the gravestone", () => {
  it("is one still frame, not a cycle through the round alternate design", () => {
    expect(BASE_CLIPS.dead.frames).toEqual(["dead1"]);
  });

  it("keeps its letters readable whichever way the pet was last walking", () => {
    vi.useFakeTimers();
    try {
      // The stroll picks its destination from Date.now() in nine-second
      // slots; walk the slots until one sends the pet right of where it stands.
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
// The crown sat two pixels left of the front view's ear dip and four short of
// filling it, so the right ear's outline poked out beside it — and the idle
// clip's side view has its dip fourteen pixels further left again, so no one
// fixed position could ever have been right. Hats now follow a per-frame
// head anchor (SPEC §10.5).
describe("a hat on the head", () => {
  const petFrames = (): FrameName[] => {
    const names = new Set<FrameName>();
    for (const clip of [...Object.values(BASE_CLIPS), ...Object.values(ONE_SHOT_CLIPS), ...IDLE_FLOURISH_CLIPS, WALK_CLIP]) {
      for (const frame of clip.frames) names.add(frame);
    }
    return [...names];
  };

  it("has an anchor, or an explicit none, for every frame the pet is drawn in", () => {
    for (const frame of petFrames()) expect(HEAD_ANCHORS[frame], `${frame} has no head anchor`).not.toBeUndefined();
  });

  it("wears nothing on the egg, the gravestone or the medicine", () => {
    for (const frame of [...BASE_CLIPS.egg.frames, ...BASE_CLIPS.dead.frames, ...ONE_SHOT_CLIPS.medicated.frames]) {
      expect(HEAD_ANCHORS[frame], frame).toBeNull();
    }
  });

  // An adult, drawn at full scale so canvas pixels are frame pixels. Reduced
  // motion pins the pet to the first idle frame, so the crown's band can be
  // checked against that frame's art: it must span exactly the dip between
  // the ears, sitting on the head outline at its floor.
  const crowned = () => {
    const { room, derived } = contentedRoom(10);
    room.reducedMotion = true;
    room.decor = { decor: [], activeCosmetic: "crown", ancestors: [] };
    room.syncDerived(derived, false, 0);
    expect(room.petScale).toBe(1);
    return room;
  };
  const crownBand = (fills: ReturnType<typeof recordingContext>["fills"]) =>
    fills.find((fill) => fill.x1 - fill.x0 === 27 && fill.y1 - fill.y0 === 7);

  it("draws the crown's band across the ear dip of the frame on screen", () => {
    const room = crowned();
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    const frame = BASE_CLIPS.idle.frames[0]!;
    const anchor = HEAD_ANCHORS[frame]!;
    const sprite = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[frame].w)!;
    const band = crownBand(recorder.fills)!;
    expect(band).toBeDefined();
    // In the frame's own pixels: the band is centred on the anchor column,
    // and its bottom edge is the head outline's row, measured from the pet's
    // feet at y = 172.
    const centre = Math.floor(SPRITE_FRAMES[frame].w / 2) + anchor.x;
    expect(band.x0 - sprite.x0).toBe(centre - 13);
    expect(band.x1 - sprite.x0).toBe(centre + 14);
    expect(band.y1 - 172).toBe(anchor.y);
  });

  // The tufts used to hang nine rows below the ear dip — the top of the
  // skull — so their fur stood above the head outline between the ears and
  // read as a second, paler pair of ears on every elder. They now stand over
  // the eyes, from an anchor of their own.
  it("keeps every frame's brow tufts inside the head, never above its outline", () => {
    for (const [frame, anchor] of Object.entries(HEAD_ANCHORS)) {
      if (!anchor) continue;
      expect(anchor.brows.y - SPRITE_FRAMES.elderBrows.h, frame).toBeGreaterThanOrEqual(anchor.y);
    }
  });

  // A sage's beard hangs from the mouth, and the mouth is a row of fur under
  // the eyes: the beard's top row never rises past the bottom of a two-row
  // eye, which sits sixteen rows under the brow bars — the one-pixel gap
  // above the eyes plus the eyes themselves — so it can never cover them.
  it("hangs every frame's beard under the eyes, never over them", () => {
    for (const [frame, anchor] of Object.entries(HEAD_ANCHORS)) {
      if (!anchor) continue;
      expect(anchor.beard.y - SPRITE_FRAMES.sageBeard.h, frame).toBeGreaterThanOrEqual(anchor.brows.y + 16);
      expect(anchor.beard.y, frame).toBeLessThan(0);
    }
  });

  // The meditation frames are the front-facing adult sat down: the same
  // head, so the same columns for everything worn on it, and the second
  // frame's breath lifts the head one art pixel with all of it.
  it("anchors the meditation frames on the front-facing head, rising a pixel on the inhale", () => {
    const settled = HEAD_ANCHORS.meditate1!;
    const risen = HEAD_ANCHORS.meditate2!;
    const front = HEAD_ANCHORS.idleFront1!;
    expect([settled.x, settled.brows.x, settled.beard.x]).toEqual([front.x, front.brows.x, front.beard.x]);
    expect([risen.x, risen.brows.x, risen.beard.x]).toEqual([front.x, front.brows.x, front.beard.x]);
    for (const lift of [settled.y - risen.y, settled.brows.y - risen.brows.y, settled.beard.y - risen.beard.y]) {
      expect(lift).toBeGreaterThanOrEqual(5);
      expect(lift).toBeLessThanOrEqual(6);
    }
  });

  it("stands an elder's brow tufts over the eyes, and takes them off the gravestone", () => {
    const { room, derived, state } = contentedRoom(22);
    expect(derived.stage).toBe("ELDER");
    room.reducedMotion = true;
    room.syncDerived(derived, false, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    const frame = BASE_CLIPS.idle.frames[0]!;
    const { brows } = HEAD_ANCHORS[frame]!;
    const sprite = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[frame].w)!;
    const tufts = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES.elderBrows.w)!;
    expect(tufts).toBeDefined();
    // Bottom-centre on the brow point, measured from the pet's feet at y = 172.
    expect(tufts.x0 - sprite.x0).toBe(Math.floor(SPRITE_FRAMES[frame].w / 2) + brows.x - SPRITE_FRAMES.elderBrows.w / 2);
    expect(tufts.y1 - 172).toBe(brows.y);

    room.syncDerived(derive({ ...state, diedAtTick: state.tick }), false, 2000);
    const mourning = recordingContext();
    room.render(mourning.ctx, 3000);
    expect(mourning.drawn.map((entry) => entry.x1 - entry.x0)).toEqual([SPRITE_FRAMES.dead1.w]);
  });

  it("hangs a Sage's beard from the mouth, under its tufts, and none on an elder", () => {
    const { room, derived } = agedRoom(43);
    expect(derived.stage).toBe("SAGE");
    room.reducedMotion = true;
    room.syncDerived(derived, false, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    const frame = BASE_CLIPS.idle.frames[0]!;
    const { beard } = HEAD_ANCHORS[frame]!;
    const sprite = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[frame].w)!;
    const widths = recorder.drawn.map((entry) => entry.x1 - entry.x0);
    expect(widths).toContain(SPRITE_FRAMES.elderBrows.w);
    const drawnBeard = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES.sageBeard.w)!;
    expect(drawnBeard).toBeDefined();
    expect(drawnBeard.x0 - sprite.x0).toBe(Math.floor(SPRITE_FRAMES[frame].w / 2) + beard.x - Math.floor(SPRITE_FRAMES.sageBeard.w / 2));
    expect(drawnBeard.y1 - 172).toBe(beard.y);

    const elder = contentedRoom(22);
    elder.room.reducedMotion = true;
    elder.room.syncDerived(elder.derived, false, 0);
    const elderRecorder = recordingContext();
    elder.room.render(elderRecorder.ctx, 1000);
    expect(elderRecorder.drawn.some((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES.sageBeard.w)).toBe(false);
  });

  // The beard was drawn over everything, so a Sage in bed wore it on top of
  // the quilt and drank its tea through it.
  it("tucks a Sage's beard under the quilt by the frame's mask, where the plain draw would hang it", () => {
    const strip: { args: unknown[]; composite: string }[] = [];
    const stripCtx = {
      globalCompositeOperation: "source-over",
      save: () => {},
      restore() {
        this.globalCompositeOperation = "source-over";
      },
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      clearRect: () => {},
      drawImage(...args: unknown[]) {
        strip.push({ args, composite: this.globalCompositeOperation });
      },
      // The room's other caches compose on the same stubbed document.
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => {},
    };
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => stripCtx }) });
    try {
      const { room, aged } = agedRoom(43);
      room.reducedMotion = true;
      room.syncDerived(derive({ ...aged, asleep: true, sleepReason: "NIGHT" }), true, 0);
      const recorder = recordingContext();
      room.render(recorder.ctx, 1000);
      const frame = BASE_CLIPS.sleeping.frames[0]!;
      const { beard } = HEAD_ANCHORS[frame]!;
      const sprite = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[frame].w)!;
      const drawnBeard = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES.sageBeard.w)!;
      expect(drawnBeard).toBeDefined();
      // Where the room hung it over the sprite is where the mask was read from.
      const offset = overlayOffset(SPRITE_FRAMES[frame], SPRITE_FRAMES.sageBeard, beard.x, beard.y);
      expect({ x: drawnBeard.x0 - sprite.x0, y: drawnBeard.y0 - sprite.y0 }).toEqual(offset);
      const mask = SPRITE_MASKS[frame]!;
      const erased = strip.find((entry) => entry.composite === "destination-out");
      expect(erased?.args.slice(1, 5)).toEqual([mask.x, mask.y, mask.w, mask.h]);
      expect(erased?.args[6]).toBe(-offset.y);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // A Sage leans on a cane only when its paws are free (SPEC §21.9). Every
  // frame that eats, sips, games, sleeps, bathes or meditates carries no cane
  // anchor, and neither does the gravestone.
  const BUSY_PAW_FRAMES = [
    ...BASE_CLIPS.sleeping.frames,
    ...BASE_CLIPS.meditating.frames,
    ...BASE_CLIPS.dead.frames,
    ...ONE_SHOT_CLIPS.eating.frames,
    ...ONE_SHOT_CLIPS.unhappyEating.frames,
    ...ONE_SHOT_CLIPS.playing.frames,
    ...ONE_SHOT_CLIPS.bathing.frames,
    ...ONE_SHOT_CLIPS.soothed.frames,
    ...ONE_SHOT_CLIPS.medicated.frames,
  ];

  it("holds no cane on any frame whose paws are busy", () => {
    for (const frame of BUSY_PAW_FRAMES) expect(HEAD_ANCHORS[frame]?.cane ?? null, frame).toBeNull();
  });

  it("holds the cane on the walk and the idle, where the paws are free", () => {
    for (const frame of [...WALK_CLIP.frames, ...BASE_CLIPS.idle.frames]) expect(HEAD_ANCHORS[frame]?.cane, frame).toBeTruthy();
  });

  it("leans a Sage on its cane at the frame's anchor, in front of the tufts and the beard, and not an elder", () => {
    const { room, derived } = agedRoom(43);
    room.reducedMotion = true;
    room.syncDerived(derived, false, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    const frame = BASE_CLIPS.idle.frames[0]!;
    const cane = HEAD_ANCHORS[frame]!.cane!;
    const sprite = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[frame].w)!;
    const drawnCane = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES.sageCane.w)!;
    expect(drawnCane).toBeDefined();
    expect(drawnCane.x0 - sprite.x0).toBe(Math.floor(SPRITE_FRAMES[frame].w / 2) + cane.x - Math.floor(SPRITE_FRAMES.sageCane.w / 2));
    expect(drawnCane.y1 - 172).toBe(cane.y);

    // The paw holds it, so it stands in front of the beard that now reaches the grip; behind the body, first of all.
    const order = recorder.drawn.map((entry) => entry.x1 - entry.x0);
    const caneAt = order.indexOf(SPRITE_FRAMES.sageCane.w);
    if (cane.behind) {
      expect(caneAt).toBeLessThan(order.indexOf(SPRITE_FRAMES[frame].w));
    } else {
      expect(caneAt).toBeGreaterThan(order.indexOf(SPRITE_FRAMES[frame].w));
      expect(caneAt).toBeGreaterThan(order.indexOf(SPRITE_FRAMES.elderBrows.w));
      expect(caneAt).toBeGreaterThan(order.indexOf(SPRITE_FRAMES.sageBeard.w));
    }

    const elder = contentedRoom(22);
    elder.room.reducedMotion = true;
    elder.room.syncDerived(elder.derived, false, 0);
    const elderRecorder = recordingContext();
    elder.room.render(elderRecorder.ctx, 1000);
    expect(elderRecorder.drawn.some((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES.sageCane.w)).toBe(false);
  });

  it("puts the cane down for a sleeping Sage", () => {
    const { room, aged } = agedRoom(43);
    room.reducedMotion = true;
    room.syncDerived(derive({ ...aged, asleep: true, sleepReason: "NIGHT" }), true, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    expect(recorder.drawn.some((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES.sageCane.w)).toBe(false);
  });

  it("mirrors the cane with the pet when it faces right", () => {
    vi.useFakeTimers();
    try {
      for (let slot = 0; slot < 64; slot++) {
        vi.setSystemTime(slot * 9000);
        const { room, derived } = agedRoom(43);
        room.syncDerived(derived, false, 0);
        const recorder = recordingContext();
        room.render(recorder.ctx, 1000);
        if (!recorder.drawn.some((entry) => entry.mirrored)) continue;
        const drawnCane = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES.sageCane.w);
        expect(drawnCane?.mirrored).toBe(true);
        return;
      }
      throw new Error("no wander slot sent the pet right");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sits a meditating elder in the meditation pose, tufts on and no beard yet", () => {
    const { room, derived } = agedRoom(41);
    expect(derived.animation).toBe("meditating");
    room.reducedMotion = true;
    room.syncDerived(derived, false, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    const widths = recorder.drawn.map((entry) => entry.x1 - entry.x0);
    expect(widths).toContain(SPRITE_FRAMES.meditate1.w);
    expect(widths).toContain(SPRITE_FRAMES.elderBrows.w);
    expect(widths).not.toContain(SPRITE_FRAMES.sageBeard.w);
  });

  // The sleeping art wears its own nightcap, and the crown was drawn straight
  // over it — a blue-and-gold smear on the head all night.
  it("leaves the cosmetic off a sleeping pet's nightcap but keeps an elder's tufts", () => {
    for (const frame of BASE_CLIPS.sleeping.frames) expect(HEAD_ANCHORS[frame]?.nightcap, frame).toBe(true);
    const { room, state } = contentedRoom(22);
    room.decor = { decor: [], activeCosmetic: "crown", ancestors: [] };
    room.syncDerived(derive({ ...state, asleep: true, sleepReason: "NIGHT" }), true, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    expect(crownBand(recorder.fills)).toBeUndefined();
    expect(recorder.drawn.some((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES.elderBrows.w)).toBe(true);
  });

  const onHoliday = (room: Room): void =>
    room.syncAtmosphere({ hour: 13, minute: 0, month: 10, dayIndex: 1, seed: 1, themeId: null, venueId: "home", holidayId: "halloween", fireworks: false });
  const drawnFrame = (recorder: ReturnType<typeof recordingContext>, frame: FrameName) =>
    recorder.drawn.findIndex(
      (entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[frame].w && Math.abs(entry.y1 - entry.y0) === SPRITE_FRAMES[frame].h,
    );

  const CLOTH = `rgb(${TEST_GARMENT.ramp.cloth.join(", ")})`;
  const sizeOf = (frame: FrameName) => ({ w: SPRITE_FRAMES[frame].w, h: SPRITE_FRAMES[frame].h });
  const firstOf = (recorder: ReturnType<typeof recordingContext>, find: (step: { fill: string | null; w: number; h: number }) => boolean): number =>
    recorder.trail.findIndex(find);

  it("dresses a Sage on a holiday in robe, tufts, beard, staff, then hat", () => {
    const { room, derived } = agedRoom(43);
    onHoliday(room);
    room.reducedMotion = true;
    room.syncDerived(derived, false, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    const drawnAs = (frame: FrameName) => firstOf(recorder, (step) => step.fill === null && step.w === sizeOf(frame).w && Math.abs(step.h) === sizeOf(frame).h);
    const worn = [firstOf(recorder, (step) => step.fill === CLOTH), drawnAs("elderBrows"), drawnAs("sageBeard"), drawnAs("wizardStaff"), drawnAs("coffeeMug")];
    expect(worn.every((index) => index >= 0)).toBe(true);
    expect(worn).toEqual([...worn].sort((a, b) => a - b));

    // The hat sits on the frame's hat anchor, bottom-centre, measured from the pet's feet at y = 172.
    const frame = BASE_CLIPS.idle.frames[0]!;
    const anchor = HEAD_ANCHORS[frame]!;
    const sprite = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[frame].w)!;
    const hat = recorder.drawn[drawnFrame(recorder, "coffeeMug")]!;
    expect(hat.y1 - 172).toBe(anchor.y);
    expect(hat.x0 - sprite.x0).toBe(Math.floor(SPRITE_FRAMES[frame].w / 2) + anchor.x - Math.floor(SPRITE_FRAMES.coffeeMug.w / 2));
  });

  // The staff finishes the costume: the same grip as the cane, drawn in its
  // place, so a Sage never holds both.
  it("swaps a Sage's cane for the costume's staff on a holiday, at the cane's own anchor", () => {
    const { room, derived } = agedRoom(43);
    onHoliday(room);
    room.reducedMotion = true;
    room.syncDerived(derived, false, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    const frame = BASE_CLIPS.idle.frames[0]!;
    const cane = HEAD_ANCHORS[frame]!.cane!;
    const sprite = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[frame].w)!;
    const staff = recorder.drawn[drawnFrame(recorder, "wizardStaff")]!;
    expect(staff).toBeDefined();
    expect(drawnFrame(recorder, "sageCane")).toBe(-1);
    expect(staff.x0 - sprite.x0).toBe(Math.floor(SPRITE_FRAMES[frame].w / 2) + cane.x - Math.floor(SPRITE_FRAMES.wizardStaff.w / 2));
    expect(staff.y1 - 172).toBe(cane.y);
  });

  it("gives an elder no staff on a holiday, and a Sage with its paws busy none either", () => {
    const elder = contentedRoom(22);
    onHoliday(elder.room);
    elder.room.reducedMotion = true;
    elder.room.syncDerived(elder.derived, false, 0);
    const elderRecorder = recordingContext();
    elder.room.render(elderRecorder.ctx, 1000);
    expect(drawnFrame(elderRecorder, "wizardStaff")).toBe(-1);

    const sage = agedRoom(43);
    onHoliday(sage.room);
    sage.room.reducedMotion = true;
    sage.room.syncDerived(derive({ ...sage.aged, asleep: true, sleepReason: "NIGHT" }), true, 0);
    const sageRecorder = recordingContext();
    sage.room.render(sageRecorder.ctx, 1000);
    expect(drawnFrame(sageRecorder, "wizardStaff")).toBe(-1);
  });

  describe("a Sage's cloak", () => {
    const CLOAK = `rgb(${SAGE_CLOAK.ramp.cloth.join(", ")})`;
    const clothOn = (room: Room): boolean => {
      room.reducedMotion = true;
      const recorder = recordingContext();
      room.render(recorder.ctx, 1000);
      return recorder.trail.some((step) => step.fill === CLOAK);
    };

    it("is worn by a Sage on an ordinary day", () => {
      const { room, derived } = agedRoom(43);
      room.syncDerived(derived, false, 0);
      expect(derived.stage).toBe("SAGE");
      expect(clothOn(room)).toBe(true);
    });

    it("gives way to the costume on a holiday", () => {
      const { room, derived } = agedRoom(43);
      onHoliday(room);
      room.syncDerived(derived, false, 0);
      expect(clothOn(room)).toBe(false);
    });

    it("is never worn by an elder", () => {
      const { room, derived } = agedRoom(41);
      room.syncDerived(derived, false, 0);
      expect(derived.stage).toBe("ELDER");
      expect(clothOn(room)).toBe(false);
    });

    it("is not worn in bed", () => {
      const { room, aged } = agedRoom(43);
      room.syncDerived(derive({ ...aged, asleep: true, sleepReason: "NIGHT" }), true, 0);
      expect(clothOn(room)).toBe(false);
    });
  });

  it("wears the garment on the pose's own body, from the neckline down", () => {
    const { room, derived } = contentedRoom(10);
    onHoliday(room);
    room.reducedMotion = true;
    room.syncDerived(derived, false, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    const frame = BASE_CLIPS.idle.frames[0]!;
    const region = GARMENT_REGIONS[frame]!;
    const sprite = recorder.drawn.find((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[frame].w)!;
    const cloth = recorder.fills.filter((_, index) => recorder.trail.filter((step) => step.fill !== null)[index]!.fill === CLOTH);
    expect(cloth.length).toBeGreaterThan(0);
    // Every piece of cloth is under the neckline's top row, in the frame's own pixels.
    const top = sprite.y0 + Math.round((region.neck - 1) * 5.5);
    for (const fill of cloth) expect(fill.y0).toBeGreaterThanOrEqual(top);
  });

  it("wears the costume hat in place of the worn cosmetic", () => {
    const { room, derived } = contentedRoom(10);
    onHoliday(room);
    room.reducedMotion = true;
    room.decor = { decor: [], activeCosmetic: "crown", ancestors: [] };
    room.syncDerived(derived, false, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    expect(crownBand(recorder.fills)).toBeUndefined();
    expect(drawnFrame(recorder, "coffeeMug")).toBeGreaterThanOrEqual(0);
  });

  it("leaves the cosmetic as it was off a holiday", () => {
    const { room, derived } = contentedRoom(10);
    room.reducedMotion = true;
    room.decor = { decor: [], activeCosmetic: "crown", ancestors: [] };
    room.syncDerived(derived, false, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    expect(crownBand(recorder.fills)).toBeDefined();
    expect(drawnFrame(recorder, "coffeeMug")).toBe(-1);
    expect(recorder.trail.some((step) => step.fill === CLOTH)).toBe(false);
  });

  it("keeps a sleeping pet's nightcap on a holiday, and no robe in bed", () => {
    const { room, state } = contentedRoom(10);
    onHoliday(room);
    room.syncDerived(derive({ ...state, asleep: true, sleepReason: "NIGHT" }), true, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    for (const frame of BASE_CLIPS.sleeping.frames) expect(GARMENT_REGIONS[frame], frame).toBeUndefined();
    expect(recorder.trail.some((step) => step.fill === CLOTH)).toBe(false);
    expect(drawnFrame(recorder, "coffeeMug")).toBe(-1);
  });

  it("mirrors the hat with the pet when it faces right", () => {
    vi.useFakeTimers();
    try {
      for (let slot = 0; slot < 64; slot++) {
        vi.setSystemTime(slot * 9000);
        const { room, derived } = contentedRoom(10);
        room.decor = { decor: [], activeCosmetic: "crown", ancestors: [] };
        room.syncDerived(derived, false, 0);
        const recorder = recordingContext();
        room.render(recorder.ctx, 1000);
        if (!recorder.drawn.some((entry) => entry.mirrored)) continue;
        expect(crownBand(recorder.fills)?.mirrored).toBe(true);
        return;
      }
      throw new Error("no wander slot sent the pet right");
    } finally {
      vi.useRealTimers();
    }
  });
});

// The home wall remembers the generations before this one (SPEC §22.10):
// one framed picture per ancestor in its slot, none anywhere else.
describe("the family wall", () => {
  const ancestors = [
    { ordinal: 4, name: "Makoto", sage: false },
    { ordinal: 3, name: "Mochi", sage: false },
    { ordinal: 2, name: "Pepper", sage: false },
  ];

  it("hangs one picture per ancestor, parent first, in the slots the spec lays out", () => {
    const { room, derived } = contentedRoom();
    room.decor = { decor: [], activeCosmetic: null, ancestors };
    room.syncDerived(derived, false, 0);
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    expect(recorder.blits).toEqual(
      WALL_SLOTS.slice(0, ancestors.length).map((slot) => ({
        dx: slot.x + MOULDING,
        dy: slot.y + MOULDING,
        width: slot.art,
        height: slot.art,
      })),
    );
  });

  it("hangs nothing on a bare wall, and stops at the slots it has", () => {
    const { room, derived } = contentedRoom();
    room.syncDerived(derived, false, 0);
    const bare = recordingContext();
    room.render(bare.ctx, 1000);
    expect(bare.blits).toEqual([]);

    const crowded = recordingContext();
    room.decor = { decor: [], activeCosmetic: null, ancestors: Array.from({ length: 9 }, (_, i) => ({ ordinal: 9 - i, name: "Makoto", sage: false })) };
    room.render(crowded.ctx, 2000);
    expect(crowded.blits.length).toBe(WALL_SLOTS.length);
  });

  it("stays home: a day trip carries none of the room's decor", () => {
    const { room, derived } = contentedRoom();
    room.decor = { decor: [], activeCosmetic: null, ancestors };
    room.syncDerived(derived, false, 0);
    room.syncAtmosphere({ hour: 13, minute: 0, month: 6, dayIndex: 1, seed: 1, themeId: null, venueId: "meadow", holidayId: null, fireworks: false });
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    expect(recorder.blits).toEqual([]);
  });
});

// A holiday dresses the room itself (SPEC §22.11): its props stand where the
// communal decor would, and the decor stays away.
describe("a holiday room", () => {
  const holidayRoom = () => {
    const { room, derived } = contentedRoom(10);
    room.syncAtmosphere({ hour: 13, minute: 0, month: 10, dayIndex: 1, seed: 1, themeId: null, venueId: "home", holidayId: "halloween", fireworks: false });
    room.decor = { decor: ["lamp", "plant", "kotatsu"], activeCosmetic: null, ancestors: [{ ordinal: 4, name: "Makoto", sage: false }] };
    room.syncDerived(derived, false, 0);
    return room;
  };
  const indexOf = (recorder: ReturnType<typeof recordingContext>, frame: FrameName): number =>
    recorder.drawn.findIndex((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[frame].w && Math.abs(entry.y1 - entry.y0) === SPRITE_FRAMES[frame].h);
  const LAMP_POLE = { w: 4, h: 66 };
  const hasLampPole = (recorder: ReturnType<typeof recordingContext>): boolean =>
    recorder.fills.some((fill) => fill.x1 - fill.x0 === LAMP_POLE.w && fill.y1 - fill.y0 === LAMP_POLE.h);

  it("draws the scene's props in place of the decor", () => {
    const recorder = recordingContext();
    holidayRoom().render(recorder.ctx, 1000);
    expect(hasLampPole(recorder)).toBe(false);
    expect(recorder.blits).toEqual([]);
    expect(indexOf(recorder, "rock1")).toBeGreaterThanOrEqual(0);
  });

  it("brings the decor back the day after", () => {
    const room = holidayRoom();
    room.syncAtmosphere({ hour: 13, minute: 0, month: 11, dayIndex: 2, seed: 1, themeId: null, venueId: "home", holidayId: null, fireworks: false });
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    expect(hasLampPole(recorder)).toBe(true);
    expect(indexOf(recorder, "rock1")).toBe(-1);
  });

  it("puts a prop behind the pet or in front of it as the scene says", () => {
    const recorder = recordingContext();
    const room = holidayRoom();
    room.reducedMotion = true; // pins the pet to its first idle frame
    room.render(recorder.ctx, 1000);
    const pet = recorder.drawn.findIndex((entry) => entry.x1 - entry.x0 === SPRITE_FRAMES[BASE_CLIPS.idle.frames[0]!].w);
    expect(indexOf(recorder, "rock1")).toBeLessThan(pet);
    expect(indexOf(recorder, "sock1")).toBeGreaterThan(pet);
  });

  // A candle's glow is a translucent rectangle a little past its sprite.
  const glowAlphas = (room: Room, nowMs: number): number[] => {
    const alphas: number[] = [];
    const recorder = recordingContext();
    const fill = recorder.ctx.fillRect.bind(recorder.ctx);
    recorder.ctx.fillRect = (x, y, w, h) => {
      if (w > SPRITE_FRAMES.sock1.w) alphas.push(recorder.current().alpha);
      fill(x, y, w, h);
    };
    room.render(recorder.ctx, nowMs);
    return alphas;
  };

  it("pulses a flickering prop's glow live, and holds it still under reduced motion", () => {
    const live = holidayRoom();
    const [early] = glowAlphas(live, 1000);
    const [later] = glowAlphas(live, 1000 + 200);
    expect(early).toBeDefined();
    expect(later).not.toBe(early);

    // A held room skips the second paint outright, so each time gets its own.
    const stillAt = (nowMs: number): number[] => {
      const still = holidayRoom();
      still.reducedMotion = true;
      return glowAlphas(still, nowMs);
    };
    expect(stillAt(1000)).toHaveLength(1);
    expect(stillAt(1000)).toEqual(stillAt(1000 + 200));
  });

  it("holds a dressed, still room still, so the garment costs no repaint", () => {
    const room = holidayRoom();
    room.reducedMotion = true;
    const recorder = recordingContext();
    room.render(recorder.ctx, 1000);
    const before = recorder.calls();
    room.render(recorder.ctx, 1000);
    expect(recorder.calls()).toBe(before);
  });

  it("paints again when the holiday arrives, though nothing else moved", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.syncAtmosphere({ hour: 13, minute: 0, month: 10, dayIndex: 1, seed: 1, themeId: null, venueId: "home", holidayId: "halloween", fireworks: false });
    const before = recorder.calls();
    room.render(recorder.ctx, 1000);
    expect(recorder.calls()).toBeGreaterThan(before);
  });
});

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
    room.syncAtmosphere({ hour: 2, minute: 0, month: 6, dayIndex: 1, seed: 1, themeId: null, venueId: "home", holidayId: null, fireworks: false });
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000))).toBeGreaterThan(0);
  });

  it("paints again when the communal decor changes", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.decor = { decor: ["plant"], activeCosmetic: null, ancestors: [] };
    expect(paintedCalls(recorder, () => room.render(recorder.ctx, 1000))).toBeGreaterThan(0);
  });

  it("paints again when a hat goes on", () => {
    const { room, derived } = contentedRoom();
    const recorder = recordingContext();
    room.syncDerived(derived, false, 0);
    room.render(recorder.ctx, 1000);
    room.decor = { decor: [], activeCosmetic: "crown", ancestors: [] };
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
    room.decor = { decor: ["plant"], activeCosmetic: null, ancestors: [] };
    const second = callLog();
    room.render(second.ctx, 1000);
    expect(second.log).not.toEqual(first.log);
  });
});

describe("the ki aura on the second day of meditation", () => {
  const rooms = (days: number) => {
    const { room, aged, derived } = agedRoom(days);
    room.aura = STUB_AURA;
    room.syncDerived(derived, false, 0);
    return { room, aged, derived };
  };
  /** A first frame is painted twice, once into the digest and once onto the canvas; this is the canvas's. */
  const onCanvas = () => drawLog.slice(drawLog.length / 2);
  const drawnOn = (days: number): string[] => {
    const { room } = rooms(days);
    drawLog.length = 0;
    room.render(recordingContext().ctx, 1000);
    return onCanvas().map((entry) => entry.half);
  };

  it("is drawn, behind then in front, only on the second day", () => {
    expect(rooms(41).derived.deepMeditation).toBe(true);
    expect(drawnOn(41)).toEqual(["behind", "front"]);
  });

  it("is not drawn on the first day, for an elder who is not meditating, or for a Sage", () => {
    expect(rooms(40.5).derived.deepMeditation).toBe(false);
    expect(drawnOn(40.5)).toEqual([]);
    expect(drawnOn(30)).toEqual([]);
    expect(rooms(43).derived.stage).toBe("SAGE");
    expect(drawnOn(43)).toEqual([]);
  });

  it("lays the back half down before the pet's sprite and the front half after it", () => {
    const { room } = rooms(41);
    const recorder = recordingContext();
    const petWidths: number[] = [SPRITE_FRAMES.meditate1.w, SPRITE_FRAMES.meditate2.w];
    const blit = recorder.ctx.drawImage.bind(recorder.ctx) as unknown as (...args: number[]) => void;
    const drawImage = (...args: number[]): void => {
      if (petWidths.includes(args[7]!)) drawLog.push({ half: "pet", frame: "", nowMs: 0, scale: 1, reduced: false });
      blit(...args);
    };
    (recorder.ctx as unknown as { drawImage: typeof drawImage }).drawImage = drawImage;
    drawLog.length = 0;
    room.render(recorder.ctx, 1000);
    expect(onCanvas().map((entry) => entry.half)).toEqual(["behind", "pet", "front"]);
  });

  it("lets go of the aura while a pat plays another clip over the meditation", () => {
    const { room } = rooms(41);
    room.onCare("PET", "petted", 1000);
    drawLog.length = 0;
    room.render(recordingContext().ctx, 1100);
    expect(drawLog).toEqual([]);
    // The pat's clip lapses and the seated pose, and the aura, come back.
    room.render(recordingContext().ctx, 1000 + 4 * 450 + 100);
    expect(drawLog.length).toBeGreaterThan(0);
  });

  it("hands the art the meditation frame on screen and the pet's own scale", () => {
    const { room } = rooms(41);
    drawLog.length = 0;
    room.render(recordingContext().ctx, 1000);
    for (const call of onCanvas()) {
      expect(BASE_CLIPS.meditating.frames).toContain(call.frame);
      expect(call.scale).toBe(room.petScale);
    }
  });

  it("draws nothing, and does not fail, when no art has been given", () => {
    const { room } = rooms(41);
    room.aura = null;
    drawLog.length = 0;
    room.render(recordingContext().ctx, 1000);
    expect(drawLog).toEqual([]);
  });

  it("hands the art the animation clock, and tells it when motion is reduced", () => {
    const { room } = rooms(41);
    drawLog.length = 0;
    room.render(recordingContext().ctx, 1000);
    expect(onCanvas().map((call) => [call.nowMs, call.reduced])).toEqual([[1000, false], [1000, false]]);
    room.reducedMotion = true;
    drawLog.length = 0;
    room.render(recordingContext().ctx, 1500);
    expect(onCanvas().map((call) => [call.nowMs, call.reduced])).toEqual([[1500, true], [1500, true]]);
  });

  it("repaints as the aura turns, and stays quiet once it is still", () => {
    const { room } = rooms(41);
    const recorder = recordingContext();
    const calls = (nowMs: number): number => {
      const before = recorder.calls();
      room.render(recorder.ctx, nowMs);
      return recorder.calls() - before;
    };
    calls(1000);
    // Inside one meditation frame (1600ms) the sprite holds, so only the aura moves.
    expect(calls(1200)).toBeGreaterThan(0);
    room.reducedMotion = true;
    calls(1300);
    expect(calls(1400)).toBe(0);
  });
});
