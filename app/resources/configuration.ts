import { SpriteProps } from "~/components/Sprite";

const sequences = {
  walking: {
    duration: 400,
    boxes: [
      { x: 40, y: 32 },
      { x: 161, y: 32 },
    ],
  },
};

const configuration: SpriteProps<keyof typeof sequences> = {
  src: "app/resources/sprites.png",
  width: 118,
  height: 140,
  sequence: "walking",
  sequences,
};

export default configuration;
