import { SpriteProps } from "~/components/Sprite";

const sequences = {
  walking: {
    duration: 400,
    boxes: [
      { x: 36, y: 32 },
      { x: 150, y: 32 },
    ],
  },
};

const configuration: SpriteProps<keyof typeof sequences> = {
  src: "app/resources/sprites.png",
  width: 110,
  height: 129,
  sequence: "walking",
  sequences,
};

export default configuration;