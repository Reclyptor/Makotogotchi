"use client";

// Don't Get Sausaged: Natsumi barks a command and Makoto has a shrinking
// window to obey it. Obey and the window tightens; hesitate or hit the wrong
// pad and she turns him into a sausage, which is what she does to Makotos who
// displease her (SPEC §13.3.2) — and the run is over.
//
// Simon Squeaks' pads with the memory taken out and pure reaction put in. Like
// Simon it runs on timers rather than the shared loop, so it opens the
// pre-roll itself.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FrameName } from "@/game/atlas.generated";
import { drawFrame, drawFrameAnchored, GAME_W } from "./engine";
import { MINIGAME_COUNTDOWN_MS } from "@/sim/minigames";
import type { GameProps } from "./types";

const CANVAS_H = 92;
const MAX_ROUNDS = 25;
const TIME_LIMIT_MS = 55_000;

// The window she gives him, and how fast it closes as he keeps up.
const START_WINDOW_MS = 1900;
const WINDOW_STEP_MS = 55;
const MIN_WINDOW_MS = 700;
const BEAT_MS = 500; // the pause between obeying and the next order

type Command = { label: string; colour: string; pose: FrameName };

const COMMANDS: readonly Command[] = [
  { label: "Sit", colour: "#fbbf24", pose: "idleFront1" },
  { label: "Spin", colour: "#38bdf8", pose: "jog2" },
  { label: "Sleep", colour: "#a78bfa", pose: "sleep1" },
  { label: "Cheer", colour: "#34d399", pose: "cheer1" },
];

export default function DontGetSausaged({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [order, setOrder] = useState<number | null>(null);
  const [pose, setPose] = useState<FrameName>("idleFront1");
  const [sausaged, setSausaged] = useState(false);
  const [round, setRound] = useState(0);

  const scoreRef = useRef(0);
  const inputsRef = useRef(0);
  const orderRef = useRef<number | null>(null);
  const windowRef = useRef(START_WINDOW_MS);
  const finishedRef = useRef(false);
  const timeoutsRef = useRef<Set<number>>(new Set());
  // The window's own timer, cancelled the moment he obeys.
  const windowTimerRef = useRef(0);

  const schedule = useCallback((fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      timeoutsRef.current.delete(id);
      fn();
    }, ms);
    timeoutsRef.current.add(id);
    return id;
  }, []);

  const endRun = useCallback(
    (turnedIntoASausage: boolean): void => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      window.clearTimeout(windowTimerRef.current);
      orderRef.current = null;
      setOrder(null);
      setSausaged(turnedIntoASausage);
      finish(scoreRef.current, inputsRef.current);
    },
    [finish],
  );

  const giveOrder = useCallback((): void => {
    if (finishedRef.current) return;
    const next = Math.floor(Math.random() * COMMANDS.length);
    orderRef.current = next;
    setOrder(next);
    setPose("idleFront1");
    setRound((current) => current + 1);
    window.clearTimeout(windowTimerRef.current);
    // Hesitating is the same as disobeying.
    windowTimerRef.current = schedule(() => endRun(true), windowRef.current);
  }, [schedule, endRun]);

  const obey = (pad: number): void => {
    if (orderRef.current === null || finishedRef.current) return;
    inputsRef.current += 1;
    if (pad !== orderRef.current) {
      endRun(true);
      return;
    }
    window.clearTimeout(windowTimerRef.current);
    orderRef.current = null;
    setOrder(null);
    setPose(COMMANDS[pad]!.pose);
    scoreRef.current += 1;
    reportScore(scoreRef.current);
    windowRef.current = Math.max(MIN_WINDOW_MS, windowRef.current - WINDOW_STEP_MS);
    if (scoreRef.current >= MAX_ROUNDS) {
      endRun(false);
      return;
    }
    schedule(giveOrder, BEAT_MS);
  };

  // Start after the pre-roll (SPEC §13.3.1), with the cutoff waiting with it
  // so the count never eats into the run.
  useEffect(() => {
    scoreRef.current = 0;
    inputsRef.current = 0;
    windowRef.current = START_WINDOW_MS;
    schedule(giveOrder, MINIGAME_COUNTDOWN_MS);
    schedule(() => endRun(false), MINIGAME_COUNTDOWN_MS + TIME_LIMIT_MS);
    const timeouts = timeoutsRef.current;
    return () => {
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
      window.clearTimeout(windowTimerRef.current);
    };
  }, [schedule, giveOrder, endRun]);

  // Repaint on every state change: Natsumi giving the order, Makoto obeying
  // it, and — if it went badly — the plate.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1d1825";
    ctx.fillRect(0, 0, GAME_W, CANVAS_H);
    ctx.fillStyle = "#3a3145";
    ctx.fillRect(0, CANVAS_H - 10, GAME_W, 10);

    drawFrameAnchored(ctx, sheet, sausaged ? "natsumiGrin" : "natsumiWatch", 214, CANVAS_H - 6, 74);

    if (sausaged) {
      // He is on a plate now. The party will never know.
      drawFrame(ctx, sheet, "partyPlate", 52, CANVAS_H - 30, 34, 26);
    } else {
      drawFrameAnchored(ctx, sheet, pose, 66, CANVAS_H - 6, 42);
    }

    ctx.font = "12px monospace";
    if (order !== null) {
      ctx.fillStyle = COMMANDS[order]!.colour;
      ctx.fillText(`${COMMANDS[order]!.label.toUpperCase()}!`, 108, 30);
    } else if (sausaged) {
      ctx.fillStyle = "#fb7185";
      ctx.fillText("sausaged.", 108, 30);
    }
    ctx.font = "10px monospace";
    ctx.fillStyle = "#f5f0dc";
    ctx.fillText(`obeyed ${scoreRef.current}`, 8, 14);
  }, [sheet, pose, order, sausaged]);

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <canvas ref={canvasRef} width={GAME_W} height={CANVAS_H} className="w-full [image-rendering:pixelated]" />
      {/* Before the first order lands there is no round yet — say so rather
          than showing a round zero. */}
      <p className="text-xs text-muted tabular-nums">{round === 0 ? "Get ready…" : `Round ${round}`}</p>
      <div className="grid w-full grid-cols-4 gap-2">
        {COMMANDS.map((command, index) => (
          <button
            key={command.label}
            type="button"
            aria-label={command.label}
            aria-disabled={order === null}
            onClick={() => obey(index)}
            className="press h-12 rounded-xl text-xs font-semibold text-black/70"
            style={{ backgroundColor: order === index ? command.colour : `${command.colour}4d` }}
          >
            {command.label}
          </button>
        ))}
      </div>
    </div>
  );
}
