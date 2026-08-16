"use client";

// Simon Squeaks: a memory game. Makoto performs a growing sequence of poses
// on the canvas while the matching pads light up below; the player echoes the
// sequence back by pressing the pads in order. One completed round is one
// point, which keeps the pace far under the envelope's 0.5 points/s cap, and
// every pad press counts as an input so inputs always exceeds score. The run
// ends on the first wrong press, at a perfect 15 rounds, or once 100 seconds
// have elapsed — comfortably inside the 120s duration ceiling.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FrameName } from "@/game/atlas.generated";
import { drawFrameAnchored, GAME_W } from "./engine";
import type { GameProps } from "./types";

const CANVAS_H = 90;
const SHOW_MS = 550; // how long each sequence step stays lit
const GAP_MS = 180; // dark gap between sequence steps
const PRESS_MS = 300; // flash after a correct press
const NEXT_ROUND_MS = 600; // breather before the next round plays
const MAX_ROUNDS = 15;
const TIME_LIMIT_MS = 100_000;

type Pad = { label: string; color: string; pose: FrameName };

const PADS: readonly Pad[] = [
  { label: "Gold pad", color: "#fbbf24", pose: "cheer1" },
  { label: "Sky pad", color: "#38bdf8", pose: "cry1" },
  { label: "Rose pad", color: "#fb7185", pose: "angry1" },
  { label: "Violet pad", color: "#a78bfa", pose: "tired1" },
];

export default function SimonSqueaks({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<"show" | "input" | "over">("show");
  const [litPad, setLitPad] = useState<number | null>(null);
  const [pose, setPose] = useState<FrameName>("idleFront1");
  const [round, setRound] = useState(1);

  // Game state lives in refs so the timeout chains never read stale closures.
  const sequenceRef = useRef<number[]>([]);
  const progressRef = useRef(0);
  const scoreRef = useRef(0);
  const inputsRef = useRef(0);
  const finishedRef = useRef(false);
  const timeoutsRef = useRef<Set<number>>(new Set());

  // Every timeout goes through here so unmount can sweep them all.
  const schedule = useCallback((fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timeoutsRef.current.delete(id);
      fn();
    }, ms);
    timeoutsRef.current.add(id);
  }, []);

  const endRun = useCallback((): void => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setLitPad(null);
    setPose("idleFront1");
    setPhase("over");
    finish(scoreRef.current, inputsRef.current);
  }, [finish]);

  // Play the current sequence: light each pad and strike its pose, then hand
  // control to the player.
  const playSequence = useCallback((): void => {
    setPhase("show");
    const sequence = sequenceRef.current;
    sequence.forEach((pad, index) => {
      const onAt = index * (SHOW_MS + GAP_MS);
      schedule(() => {
        setLitPad(pad);
        setPose(PADS[pad]!.pose);
      }, onAt);
      schedule(() => {
        setLitPad(null);
        setPose("idleFront1");
      }, onAt + SHOW_MS);
    });
    schedule(() => {
      progressRef.current = 0;
      setPhase("input");
    }, sequence.length * (SHOW_MS + GAP_MS));
  }, [schedule]);

  const startRound = useCallback((): void => {
    sequenceRef.current.push(Math.floor(Math.random() * PADS.length));
    setRound(sequenceRef.current.length);
    playSequence();
  }, [playSequence]);

  const handlePad = (pad: number): void => {
    if (phase !== "input" || finishedRef.current) return;
    inputsRef.current += 1;
    if (pad !== sequenceRef.current[progressRef.current]) {
      endRun();
      return;
    }
    setLitPad(pad);
    setPose(PADS[pad]!.pose);
    schedule(() => {
      setLitPad(null);
      setPose("idleFront1");
    }, PRESS_MS);
    progressRef.current += 1;
    if (progressRef.current === sequenceRef.current.length) {
      scoreRef.current += 1;
      reportScore(scoreRef.current);
      if (scoreRef.current >= MAX_ROUNDS) {
        endRun();
        return;
      }
      // Lock the pads during the breather so stray taps don't count.
      setPhase("show");
      schedule(startRound, NEXT_ROUND_MS);
    }
  };

  // Start the run on mount. Resetting the refs first makes a strict-mode
  // remount restart cleanly instead of doubling the sequence. The time limit
  // is a scheduled cutoff, so even an abandoned run ends inside the envelope.
  useEffect(() => {
    sequenceRef.current = [];
    progressRef.current = 0;
    scoreRef.current = 0;
    inputsRef.current = 0;
    startRound();
    schedule(endRun, TIME_LIMIT_MS);
    const timeouts = timeoutsRef.current;
    return () => {
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
    };
  }, [startRound, schedule, endRun]);

  // Repaint whenever the pose or lit pad changes; a wash of the pad's color
  // behind Makoto ties the canvas to the pad grid.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1d1825";
    ctx.fillRect(0, 0, GAME_W, CANVAS_H);
    if (litPad !== null) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = PADS[litPad]!.color;
      ctx.fillRect(0, 0, GAME_W, CANVAS_H);
      ctx.globalAlpha = 1;
    }
    drawFrameAnchored(ctx, sheet, pose, 130, 88, 64);
  }, [sheet, pose, litPad]);

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <canvas ref={canvasRef} width={GAME_W} height={CANVAS_H} className="w-full [image-rendering:pixelated]" />
      <p className="text-xs text-muted tabular-nums">Round {round}</p>
      <div className="grid w-full grid-cols-4 gap-2">
        {PADS.map((pad, index) => (
          <button
            key={pad.label}
            type="button"
            aria-label={pad.label}
            aria-disabled={phase !== "input"}
            onClick={() => handlePad(index)}
            className="press h-12 rounded-xl"
            style={{ backgroundColor: litPad === index ? pad.color : `${pad.color}4d` }}
          />
        ))}
      </div>
    </div>
  );
}
