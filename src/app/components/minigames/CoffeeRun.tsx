"use client";

// Coffee Run: Makoto brews a pot, and Natsumi destroys the drip machine every
// single time (SPEC §13.3.2). Hold to brew, release to pour — pouring banks
// whatever is in the pot as cups. She walks in on her own schedule; be caught
// mid-brew and she smashes the machine, taking the whole pot with it. One
// button, and the only question in the game is when to stop.

import { useEffect, useRef } from "react";
import type { FrameName } from "@/game/atlas.generated";
import { drawFrame, drawFrameAnchored, GAME_H, GAME_W, startGameLoop } from "./engine";
import type { GameProps } from "./types";

const RUN_MS = 30_000;
const COUNTER_Y = 96;

const MAX_POT = 5;
const MS_PER_CUP = 700;

// Her round trip: away, walking in, standing over the machine, walking off.
const GONE_MS = [2600, 4200] as const;
const APPROACH_MS = 1300;
const OVER_MS = 700;
const LEAVING_MS = 900;

const SMASHED_MS = 1000;
const POUR_MS = 500;

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

const between = ([low, high]: readonly [number, number]): number => low + Math.random() * (high - low);
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

export default function CoffeeRun({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let score = 0;
    let inputs = 0;
    let elapsed = 0;
    let pot = 0;
    let smashedMs = 0;
    let pourMs = 0;
    let steamMs = 0;
    let phase: "gone" | "coming" | "over" | "leaving" = "gone";
    let phaseMs = 0;
    let phaseFor = between(GONE_MS);
    // The raw press, and whether this press has been counted — a press begun
    // during the pre-roll still brews the moment the count ends.
    let pressed = false;
    let counted = false;

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
      phaseMs += dtMs;
      smashedMs = Math.max(0, smashedMs - dtMs);
      pourMs = Math.max(0, pourMs - dtMs);
      steamMs += dtMs;

      const live = armed();
      const brewing = live && pressed && smashedMs === 0;
      // Both edges are deliberate acts — starting the pot and pouring it — so
      // both count toward the server's inputs floor.
      if (live && pressed && !counted) {
        inputs += 1;
        counted = true;
      }
      if (!pressed && counted) {
        inputs += 1;
        counted = false;
        // Releasing pours: whatever whole cups are in the pot are banked.
        const cups = Math.floor(pot);
        if (cups > 0 && smashedMs === 0) {
          score += cups;
          reportScore(score);
          pourMs = POUR_MS;
        }
        pot = 0;
      }
      if (brewing) pot = Math.min(MAX_POT, pot + dtMs / MS_PER_CUP);

      if (phaseMs >= phaseFor) {
        phaseMs = 0;
        if (phase === "gone") {
          phase = "coming";
          phaseFor = APPROACH_MS;
        } else if (phase === "coming") {
          phase = "over";
          phaseFor = OVER_MS;
          // She arrives. A pot on the go is a pot on the floor.
          if (brewing) {
            smashedMs = SMASHED_MS;
            pot = 0;
          }
        } else if (phase === "over") {
          phase = "leaving";
          phaseFor = LEAVING_MS;
        } else {
          phase = "gone";
          phaseFor = between(GONE_MS);
        }
      }

      const natsumiX =
        phase === "coming"
          ? lerp(NATSUMI_AWAY_X, NATSUMI_OVER_X, Math.min(1, phaseMs / APPROACH_MS))
          : phase === "over"
            ? NATSUMI_OVER_X
            : phase === "leaving"
              ? lerp(NATSUMI_OVER_X, NATSUMI_AWAY_X, Math.min(1, phaseMs / LEAVING_MS))
              : NATSUMI_AWAY_X;

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

      drawFrameAnchored(ctx, sheet, smashedMs > 0 ? "natsumiGrin" : "natsumiWatch", natsumiX, COUNTER_Y + 8, NATSUMI_H);

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
