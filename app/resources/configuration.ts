import { Box, Sequence, SpriteProps } from "~/components/Sprite";

const SPRITESHEET = "app/resources/sprites.png" as const;
const CANVAS_WIDTH = 139 as const;
const CANVAS_HEIGHT = 139 as const;

type Rectangle = { x: number, y: number, w: number, h: number };

const SPRITES = {
  // Makoto
  jog1: { x: 39, y: 33, w: 115, h: 138 },
  jog2: { x: 160, y: 33, w: 115, h: 138 },
  jog3: { x: 281, y: 33, w: 115, h: 138 },
  idleSide1: { x: 402, y: 33, w: 137, h: 138 },
  idleSide2: { x: 545, y: 33, w: 137, h: 138 },
  idleSide3: { x: 688, y: 33, w: 137, h: 138 },
  sleep1: { x: 831, y: 33, w: 137, h: 132 },
  sleep2: { x: 974, y: 33, w: 137, h: 132 },
  eat1: { x: 1117, y: 28, w: 126, h: 137 },
  eat2: { x: 1249, y: 28, w: 126, h: 137 },
  idleFront1: { x: 39, y: 176, w: 115, h: 138 },
  idleFront2: { x: 160, y: 176, w: 115, h: 138 },
  idleFront3: { x: 281, y: 176, w: 115, h: 138 },
  lift1: { x: 402, y: 176, w: 137, h: 138 },
  lift2: { x: 545, y: 176, w: 137, h: 138 },
  game1: { x: 688, y: 182, w: 137, h: 121 },
  game2: { x: 831, y: 182, w: 137, h: 121 },
  game3: { x: 974, y: 182, w: 137, h: 121 },
  sick1: { x: 1117, y: 171, w: 132, h: 137 },
  sick2: { x: 1254, y: 171, w: 132, h: 137 },
  dead1: { x: 28, y: 325, w: 137, h: 132 },
  dead2: { x: 171, y: 325, w: 137, h: 132 },
  clone1: { x: 314, y: 319, w: 137, h: 138 },
  clone2: { x: 457, y: 319, w: 137, h: 138 },
  clone3: { x: 600, y: 319, w: 137, h: 138 },
  clone4: { x: 743, y: 319, w: 137, h: 138 },
  clone5: { x: 886, y: 319, w: 137, h: 138 },
  clone6: { x: 1029, y: 319, w: 137, h: 138 },
  clone7: { x: 1172, y: 319, w: 137, h: 138 },
  clone8: { x: 1315, y: 319, w: 137, h: 138 },
  angry1: { x: 33, y: 462, w: 143, h: 143 },
  angry2: { x: 176, y: 462, w: 143, h: 143 },
  tired1: { x: 325, y: 462, w: 137, h: 138 },
  tired2: { x: 468, y: 462, w: 137, h: 138 },
  unhappyEat1: { x: 611, y: 462, w: 126, h: 138 },
  unhappyEat2: { x: 743, y: 462, w: 126, h: 138 },
  lights1: { x: 880, y: 462, w: 138, h: 138 },
  lights2: { x: 1023, y: 462, w: 138, h: 138 },
  tea1: { x: 1166, y: 479, w: 138, h: 121 },
  tea2: { x: 1309, y: 479, w: 138, h: 121 },
  pekori: { x: 33, y: 611, w: 138, h: 137 },
  bored1: { x: 176, y: 611, w: 138, h: 137 },
  bored2: { x: 319, y: 611, w: 138, h: 137 },
  bored3: { x: 462, y: 611, w: 138, h: 137 },
  drpepper1: { x: 605, y: 611, w: 138, h: 137 },
  drpepper2: { x: 748, y: 611, w: 138, h: 137 },
  dustbath1: { x: 891, y: 611, w: 138, h: 137 },
  dustbath2: { x: 1034, y: 611, w: 138, h: 137 },
  dustbath3: { x: 1177, y: 611, w: 138, h: 137 },

  // Food
  plate: { x: 0, y: 1062, w: 82, h: 38 },
  fishman: { x: 88, y: 1062, w: 82, h: 38 },
  fish: { x: 180, y: 1062, w: 82, h: 38 },
  pepper1: { x: 275, y: 1056, w: 82, h: 44 },
  pepper2: { x: 370, y: 1056, w: 82, h: 44 },
  sausage: { x: 465, y: 1062, w: 82, h: 38 },
  pizza: { x: 558, y: 1062, w: 82, h: 38 },
} as const satisfies Record<string, Rectangle>;

const centered = (sprite: Rectangle): Box => ({
  ...sprite,
  dx: Math.trunc((CANVAS_WIDTH - sprite.w) / 2),
  dy: Math.trunc((CANVAS_HEIGHT - sprite.h) / 2),
});

const SEQUENCES = {
  clonePhase1: {
    interval: 1000,
    boxes: [
      centered(SPRITES.clone1),
      centered(SPRITES.clone2),
    ],
  },
  clonePhase2: {
    interval: 1000,
    boxes: [
      centered(SPRITES.clone3),
      centered(SPRITES.clone4),
    ],
  },
  clonePhase3: {
    interval: 1000,
    boxes: [
      centered(SPRITES.clone5),
      centered(SPRITES.clone6),
    ],
  },
  clonePhase4: {
    interval: 1000,
    boxes: [
      centered(SPRITES.clone7),
      centered(SPRITES.clone8),
    ],
  },
  walking: {
    interval: 1000,
    boxes: [
      centered(SPRITES.jog1),
      centered(SPRITES.jog2),
    ],
  },
  jogging: {
    interval: 200,
    boxes: [
      centered(SPRITES.jog1),
      centered(SPRITES.jog2),
      centered(SPRITES.jog1),
      centered(SPRITES.jog2),
      centered(SPRITES.jog1),
      centered(SPRITES.jog2),
      centered(SPRITES.jog1),
      centered(SPRITES.jog2),
      centered(SPRITES.jog1),
      centered(SPRITES.jog2),
      centered(SPRITES.jog1),
      centered(SPRITES.jog2),
      centered(SPRITES.jog3),
    ],
  },
  tired: {
    interval: 1000,
    boxes: [
      centered(SPRITES.tired1),
      centered(SPRITES.tired2),
    ],
  },
  idle: {
    interval: 1000,
    boxes: [
      centered(SPRITES.idleSide1),
      centered(SPRITES.idleSide2),
      centered(SPRITES.idleSide3),
    ],
  },
  playing: {
    interval: 1000,
    boxes: [
      centered(SPRITES.game1),
      centered(SPRITES.game2),
      centered(SPRITES.game3),
    ],
  },
  sleeping: {
    interval: 1000,
    boxes: [
      centered(SPRITES.sleep1),
      centered(SPRITES.sleep2),
    ],
  },
  sick: {
    interval: 1000,
    boxes: [
      centered(SPRITES.sick1),
      centered(SPRITES.sick2),
    ],
  },
  dead: {
    interval: 1000,
    boxes: [
      centered(SPRITES.dead1),
      centered(SPRITES.dead2),
    ],
  },
  hungry: {
    interval: 1000,
    boxes: [
      centered(SPRITES.eat1),
      centered(SPRITES.eat2),
    ],
  },
} as const satisfies Record<string, Sequence>;

const configuration: Omit<SpriteProps<keyof typeof SEQUENCES>, "sequence"> = {
  src: SPRITESHEET,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  sequences: SEQUENCES,
};

export default configuration;