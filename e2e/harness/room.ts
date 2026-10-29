// A bare page around the real Room (src/game/scene/room.ts), for the e2e that
// has to see what the room actually paints: the same class, atlas and canvas
// the game uses, without a pet stream to hand it a life stage. Bundled and
// served by the spec that drives it (e2e/sage-room.spec.ts).

import { Room, ROOM_HEIGHT, ROOM_WIDTH, stageScale } from "@/game/scene/room";
import { SPRITE_SHEET_URL, type FrameName } from "@/game/atlas.generated";
import { derive } from "@/sim/derive";
import { hatchedState, projectImmortal, testCtx } from "@/sim/testkit";
import { type HolidayId } from "@/sim/holidays";
import { TICKS_PER_DAY, type LifeStage } from "@/sim/tuning";

export type RenderOptions = {
  stage: LifeStage;
  frame: FrameName;
  holidayId: HolidayId | null;
  /** Pet-clock hour, so the room can be drawn in daylight or dark. */
  hour: number;
};

export type Painted = {
  width: number;
  height: number;
  /** The canvas's RGBA pixels. */
  pixels: number[];
  /** Where the frame landed, in canvas pixels, and at what scale. */
  scale: number;
  petX: number;
};

const room = new Room();
const canvas = document.createElement("canvas");
canvas.width = ROOM_WIDTH;
canvas.height = ROOM_HEIGHT;
canvas.style.imageRendering = "pixelated";
document.body.style.margin = "0";
document.body.append(canvas);
const ctx = canvas.getContext("2d")!;
const loaded = room.atlas.load(SPRITE_SHEET_URL);

const ctxFor = testCtx();
const state = projectImmortal(hatchedState(ctxFor), 10 * TICKS_PER_DAY, ctxFor);

const renderRoom = async (options: RenderOptions): Promise<Painted> => {
  await loaded;
  room.reducedMotion = true;
  // Every frame in turn, whatever the clip would be playing: the walk cycle's
  // four, the idle's, each held for as long as it is asked for.
  room.machine.frameAt = () => options.frame;
  room.syncAtmosphere({
    hour: options.hour,
    minute: 0,
    month: 10,
    dayIndex: 20_000,
    seed: 1,
    themeId: null,
    venueId: "home",
    holidayId: options.holidayId,
    fireworks: false,
  });
  room.syncDerived({ ...derive(state), stage: options.stage }, false, 0);
  room.invalidate();
  room.render(ctx, 1000);
  const { data } = ctx.getImageData(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
  return {
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    pixels: Array.from(data),
    scale: stageScale(options.stage),
    petX: ROOM_WIDTH / 2,
  };
};

Object.assign(window, { renderRoom });
