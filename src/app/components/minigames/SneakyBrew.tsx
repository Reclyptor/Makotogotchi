"use client";

// Sneaky Brew: Makoto brews a pot, and Natsumi destroys the drip machine every
// single time (SPEC §13.3.2). Hold to brew, release to pour — pouring banks
// whatever is in the pot as cups. She walks in on her own schedule; be caught
// mid-brew and she smashes the machine, taking the whole pot with it. One
// button, and the only question in the game is when to stop.

import { useEffect, useRef } from "react";
import type { FrameName } from "@/game/atlas.generated";
import { drawFrame, drawFrameAnchored, GAME_H, GAME_W, startGameLoop } from "./engine";
import { advance, APPROACH_MS, createBrew, LEAVING_MS, MAX_POT, RUN_MS, type Brew } from "./sneakyBrewRules";
import type { GameProps } from "./types";

const COUNTER_Y = 96;

const MACHINE_X = 152;
const MACHINE_W = 44;
const MACHINE_H = 46;
const NATSUMI_H = 78;
const NATSUMI_AWAY_X = 300;
const NATSUMI_OVER_X = 206;
const PET_X = 62;
const PET_H = 34;

// Where the carafe sits inside the machine frame, as fractions of it, so the
// brew level can be drawn into the glass without a second sprite per level.
const CARAFE = { x: 12 / 22, y: 12 / 23, w: 8 / 22, h: 7 / 23 };

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const natsumiX = ({ natsumi, phaseMs }: Brew): number => {
  if (natsumi === "coming") return lerp(NATSUMI_AWAY_X, NATSUMI_OVER_X, Math.min(1, phaseMs / APPROACH_MS));
  if (natsumi === "over") return NATSUMI_OVER_X;
  if (natsumi === "leaving") return lerp(NATSUMI_OVER_X, NATSUMI_AWAY_X, Math.min(1, phaseMs / LEAVING_MS));
  return NATSUMI_AWAY_X;
};

export default function SneakyBrew({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let brew = createBrew(Math.random);
    let elapsed = 0;
    let steamMs = 0;
    let pressed = false;

    const press = (): void => {
      pressed = true;
    };
    const release = (): void => {
      pressed = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Space") return;
      event.preventDefault();
      press();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space") release();
    };
    canvas.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const { stop, armed } = startGameLoop((dtMs) => {
      elapsed += dtMs;
      steamMs += dtMs;
      const stepped = advance(brew, dtMs, { pressed, live: armed() }, Math.random);
      brew = stepped.brew;
      if (stepped.events.some((event) => event.kind === "poured")) reportScore(brew.score);
      const { pot, score, inputs, brewing, smashedMs, pourMs } = brew;

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1d1825";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#3a3145";
      ctx.fillRect(0, COUNTER_Y + 4, GAME_W, GAME_H - COUNTER_Y);

      const machineY = COUNTER_Y + 4 - MACHINE_H;
      const machine: FrameName = smashedMs > 0 ? "coffeeSmashed" : "coffeeMachine";
      drawFrame(ctx, sheet, machine, MACHINE_X, machineY, MACHINE_W, MACHINE_H);
      // The brew level rises in the carafe itself.
      if (smashedMs === 0 && pot > 0) {
        const height = (MACHINE_H * CARAFE.h * pot) / MAX_POT;
        ctx.fillStyle = "#6e4028";
        ctx.fillRect(
          Math.round(MACHINE_X + MACHINE_W * CARAFE.x + 1),
          Math.round(machineY + MACHINE_H * CARAFE.y + MACHINE_H * CARAFE.h - height),
          Math.round(MACHINE_W * CARAFE.w - 2),
          Math.round(height),
        );
      }
      if (brewing && smashedMs === 0) {
        drawFrame(ctx, sheet, steamMs % 480 < 240 ? "steam1" : "steam2", MACHINE_X + 26, machineY - 10, 6, 10);
      }

      drawFrameAnchored(ctx, sheet, smashedMs > 0 ? "natsumiGrin" : "natsumiWatch", natsumiX(brew), COUNTER_Y + 8, NATSUMI_H);

      const pose: FrameName =
        smashedMs > 0 ? "cry1" : pourMs > 0 ? "cheer1" : brewing ? (steamMs % 300 < 150 ? "lift1" : "lift2") : "idleSide1";
      drawFrameAnchored(ctx, sheet, pose, PET_X, COUNTER_Y + 4, PET_H);
      if (pourMs > 0) drawFrame(ctx, sheet, "coffeeMug", PET_X + 16, COUNTER_Y - 20, 14, 11);

      ctx.fillStyle = "#f5f0dc";
      ctx.font = "10px monospace";
      ctx.fillText(`cups ${score}`, 8, 14);
      ctx.fillText(`${Math.max(0, Math.ceil((RUN_MS - elapsed) / 1000))}s`, GAME_W - 28, 14);
      if (smashedMs > 0) {
        ctx.fillStyle = "#fb7185";
        ctx.fillText("she smashed it!", 82, 14);
      } else if (pot >= 1) {
        ctx.fillStyle = "#fff261";
        ctx.fillText(`pot ${Math.floor(pot)}`, 96, 14);
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
