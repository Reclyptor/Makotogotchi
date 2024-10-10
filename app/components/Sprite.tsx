import { useCallback, useEffect, useRef, useState } from "react";

export type Box = { x: number; y: number, w: number, h: number, dx: number, dy: number, m?: 1 };
export type Sequence = { interval: number; boxes: readonly Box[] };

export type SpriteProps = {
  src: string;
  width: number;
  height: number;
  sequence: Sequence;
};

const Sprite = (props: SpriteProps) => {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const sprites = useRef<HTMLImageElement | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);

  const clear = useCallback(() => {
    const context = canvas.current?.getContext("2d");
    if (canvas.current && context) {
      context.clearRect(0, 0, canvas.current.width, canvas.current.height);
    }
  }, []);

  const draw = useCallback((frame: number, sequence: Sequence) => {
    const context = canvas.current?.getContext("2d");
    if (canvas.current && context && sprites.current) {
      const box = sequence.boxes[frame];
      context.drawImage(sprites.current, box.x, box.y, box.w, box.h, box.dx, box.dy, box.w, box.h);
    }
  }, []);

  const loop = useCallback((frame: number, sequence: Sequence) => {
    clear();
    draw(frame, sequence);
    if (sequence.interval) {
      timeout.current = setTimeout(() => loop((frame + 1) % sequence.boxes.length, sequence), sequence.interval);
    }
  }, [clear, draw]);

  useEffect(() => {
    if (ready) {
      loop(0, props.sequence);
      return () => { timeout.current && clearTimeout(timeout.current); };
    }
  }, [loop, props.sequence, ready]);

  useEffect(() => {
    setReady(false);
    sprites.current = Object.assign(new Image(), { src: props.src });
    sprites.current.onload = () => setReady(true);
  }, [props.src]);

  return (
    <canvas ref={ canvas } width={ props.width } height={ props.height } />
  )
};

export default Sprite;