"use client";

// Natsumi's Watch: Makoto sneaks across the desk for a sausage while Natsumi
// pretends not to look. Hold to scurry, release to freeze. She telegraphs the
// turn; get caught moving and she flicks Makoto back to the start, grinning. A
// treat reached is a point — and she resets Makoto herself for the next one,
// which is the whole relationship in one loop.

import { useEffect, useRef } from "react";
import type { FrameName } from "@/game/atlas.generated";
import { drawFrame, drawFrameAnchored, GAME_H, GAME_W, startGameLoop } from "./engine";
import type { GameProps } from "./types";

const RUN_MS = 30_000;
const FLOOR_Y = 96;
const START_X = 18;
const TREAT_X = 158;
const SPEED = 70; // px/s — the desk is a two-second dash if she never turns

const CAUGHT_MS = 700; // frozen and dizzy, with Natsumi grinning over Makoto
const CHEER_MS = 600; // celebrating a treat before she puts Makoto back

// Her cycle. The turn is the tell: short, but long enough to stop for.
const AWAY_MS = [1000, 2200] as const;
const TURN_MS = 420;
const WATCH_MS = [900, 1800] as const;

// She looms over the desk — twice Makoto's height — but stops short of the
// HUD row so the clock stays readable.
const NATSUMI_H = 78;
const NATSUMI_X = 220;
const PET_H = 34;
// The sausage-on-a-plate frame is more than twice as wide as it is tall;
// drawing it into a square would squash it into an unreadable blob.
const TREAT_W = 26;
const TREAT_H = 12;

const between = ([low, high]: readonly [number, number]): number => low + Math.random() * (high - low);

export default function NatsumisWatch({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let score = 0;
    let inputs = 0;
    let elapsed = 0;
    let petX = START_X;
    let phase: "away" | "turn" | "watch" = "away";
    let phaseMs = 0;
    let phaseFor = between(AWAY_MS);
    let caughtMs = 0;
    let cheerMs = 0;
    let walkMs = 0;
    // The raw press, and whether it has been counted: a press begun during the
    // pre-roll still moves Makoto the moment the count ends, and still counts
    // exactly one input — but not a countdown's worth of free ones.
    let pressed = false;
    let counted = false;

    const press = (): void => {
      pressed = true;
    };
    const release = (): void => {
      pressed = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Space" && event.code !== "ArrowRight") return;
      event.preventDefault();
      press();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space" || event.code === "ArrowRight") release();
    };
    canvas.addEventListener("pointerdown", press);
    // Release on the window: a pointer lifted off the canvas must still stop
    // Makoto, who would otherwise keep running under her nose.
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const { stop, armed } = startGameLoop((dtMs) => {
      const dt = dtMs / 1000;
      elapsed += dtMs;
      phaseMs += dtMs;
      caughtMs = Math.max(0, caughtMs - dtMs);
      cheerMs = Math.max(0, cheerMs - dtMs);

      const live = armed();
      if (!pressed) counted = false;
      else if (live && !counted) {
        inputs += 1;
        counted = true;
      }

      // Her cycle runs whether or not Makoto moves — the rhythm is the level.
      if (phaseMs >= phaseFor) {
        phaseMs = 0;
        if (phase === "away") {
          phase = "turn";
          phaseFor = TURN_MS;
        } else if (phase === "turn") {
          phase = "watch";
          phaseFor = between(WATCH_MS);
        } else {
          phase = "away";
          phaseFor = between(AWAY_MS);
        }
      }

      const held = live && pressed;
      const stunned = caughtMs > 0 || cheerMs > 0;
      const moving = held && !stunned;
      if (moving) {
        if (phase === "watch") {
          // Caught. All the ground, none of the points.
          caughtMs = CAUGHT_MS;
          petX = START_X;
        } else {
          petX += SPEED * dt;
          walkMs += dtMs;
          if (petX >= TREAT_X) {
            petX = TREAT_X;
            score += 1;
            reportScore(score);
            cheerMs = CHEER_MS;
          }
        }
      }
      // She always puts Makoto back at the start, with a fresh treat out.
      if (cheerMs === 0 && petX >= TREAT_X) petX = START_X;

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1d1825";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#3a3145";
      ctx.fillRect(0, FLOOR_Y + 4, GAME_W, GAME_H - FLOOR_Y);

      const natsumi: FrameName =
        caughtMs > 0 ? "natsumiGrin" : phase === "watch" ? "natsumiWatch" : phase === "turn" ? "natsumiTurn" : "natsumiAway";
      drawFrameAnchored(ctx, sheet, natsumi, NATSUMI_X, FLOOR_Y + 8, NATSUMI_H);

      drawFrame(ctx, sheet, "sausage", TREAT_X - TREAT_W / 2, FLOOR_Y - TREAT_H, TREAT_W, TREAT_H);

      const pose: FrameName =
        caughtMs > 0
          ? "sick1"
          : cheerMs > 0
            ? cheerMs % 320 < 160
              ? "cheer1"
              : "cheer2"
            : moving
              ? (["walk1", "walk2", "walk3", "walk4"] as const)[Math.floor(walkMs / 110) % 4]!
              : "idleSide1";
      drawFrameAnchored(ctx, sheet, pose, petX, FLOOR_Y + 2, PET_H);

      ctx.fillStyle = "#f5f0dc";
      ctx.font = "10px monospace";
      ctx.fillText(`score ${score}`, 8, 14);
      ctx.fillText(`${Math.max(0, Math.ceil((RUN_MS - elapsed) / 1000))}s`, GAME_W - 28, 14);
      if (phase === "watch" && caughtMs === 0) {
        ctx.fillStyle = "#fb7185";
        ctx.fillText("she's looking!", 84, 14);
      }

      if (elapsed >= RUN_MS) {
        stop();
        finish(score, inputs);
      }
    });

    return () => {
      stop();
      canvas.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [sheet, reportScore, finish]);

  return <canvas ref={canvasRef} width={GAME_W} height={GAME_H} className="w-full touch-none [image-rendering:pixelated]" />;
}
