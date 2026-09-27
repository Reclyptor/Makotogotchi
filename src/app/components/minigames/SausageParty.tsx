"use client";

// Sausage Party: a tea party, except it is sausages, except the sausages are
// the Makotos who misbehaved and nobody at the table knows it (SPEC §13.3.2).
//
// The tray holds one dish; tap the guest holding that dish up. Right guest
// is a point and they leave happy; wrong guest costs them patience, and a
// guest whose patience runs out storms off unserved. One tap, three things
// to read at once — the roster's only matching game.
//
// The rules live in sausagePartyRules.ts. This file is the board: it draws a
// Table, turns taps into serves, and makes every outcome visible — a wrong
// plate, a walkout, a tap while the kitchen is still plating. The first
// version kept all three silent, and a game whose failures are silent reads
// as random.

import { useEffect, useRef } from "react";
import type { FrameName } from "@/game/atlas.generated";
import { drawFrame, drawFrameAnchored, GAME_H, GAME_W, startGameLoop } from "./engine";
import { advance, createTable, PATIENCE_MS, serve, type Table } from "./sausagePartyRules";
import type { GameProps } from "./types";

const RUN_MS = 35_000;
const TABLE_Y = 70;
const SEAT_X = [46, 130, 214] as const;
const SEAT_HIT = 40; // how far a tap can be from a seat and still count
const GUEST_H = 36;

// The tray owns the bottom strip: what is being served is the one thing the
// player must read first, so it is the biggest prop on the board and sits in
// the middle, not in a corner beside three look-alikes.
const TRAY_X = GAME_W / 2;
const TRAY_Y = 86;
const PLATE_W = 48;
const PLATE_H = 30;

const FLASH_MS = 260;
const JITTER_MS = 200;

const GUEST_POSES: readonly FrameName[] = ["clone1", "clone3", "clone5"];

const CREAM = "#f5f0dc";
const MUTED = "#8b8397";
const GOLD = "#fff261";
const ROSE = "#fb7185";
const GREEN = "#34d399";

export default function SausageParty({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let table: Table = createTable(Math.random);
    let inputs = 0;
    let elapsed = 0;
    // Each kind of feedback keeps its own clock, so one never cuts another short.
    let servedFlash = { seat: -1, ms: 0 };
    let wrongFlash = { seat: -1, ms: 0, patienceBefore: 0 };
    let jitterMs = 0;
    let replated = false;

    const attempt = (seat: number): void => {
      if (!armed()) return;
      inputs += 1;
      const result = serve(table, seat);
      table = result.table;
      switch (result.outcome.kind) {
        case "served":
          reportScore(table.served);
          servedFlash = { seat, ms: FLASH_MS };
          replated = false;
          break;
        case "wrong":
          wrongFlash = { seat, ms: FLASH_MS, patienceBefore: result.outcome.patienceBefore };
          break;
        case "plating":
          // Not a wrong answer, but not nothing either: the plate wobbles so
          // the tap reads as "too early" rather than "didn't register".
          jitterMs = JITTER_MS;
          break;
        case "unavailable":
          break;
      }
    };

    const onPointerDown = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * GAME_W;
      let best = -1;
      for (const [seat, seatX] of SEAT_X.entries()) {
        if (Math.abs(seatX - x) <= SEAT_HIT) best = seat;
      }
      if (best >= 0) attempt(best);
    };
    const KEY_SEATS: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, ArrowLeft: 0, ArrowDown: 1, ArrowRight: 2 };
    const onKey = (event: KeyboardEvent): void => {
      const seat = KEY_SEATS[event.code];
      if (seat === undefined) return;
      event.preventDefault();
      attempt(seat);
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);

    const drawPatience = (seatX: number, y: number, patience: number, lostFrom: number | null): void => {
      const width = (value: number): number => Math.round(26 * (value / PATIENCE_MS));
      ctx.fillStyle = "#241d2e";
      ctx.fillRect(seatX - 13, y, 26, 4);
      if (lostFrom !== null) {
        // The chunk a wrong plate just cost, bright for a beat.
        ctx.fillStyle = ROSE;
        ctx.fillRect(seatX - 13, y, width(lostFrom), 4);
      }
      ctx.fillStyle = patience < PATIENCE_MS * 0.3 ? ROSE : GREEN;
      ctx.fillRect(seatX - 13, y, width(patience), 4);
    };

    const { stop, armed } = startGameLoop((dtMs) => {
      elapsed += dtMs;
      servedFlash.ms = Math.max(0, servedFlash.ms - dtMs);
      wrongFlash.ms = Math.max(0, wrongFlash.ms - dtMs);
      jitterMs = Math.max(0, jitterMs - dtMs);

      const stepped = advance(table, dtMs, Math.random);
      table = stepped.table;
      if (stepped.events.some((event) => event.kind === "replated")) replated = true;

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1d1825";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      // The table runs across the room, guests behind it, the tray in front.
      ctx.fillStyle = "#4a3a2c";
      ctx.fillRect(0, TABLE_Y, GAME_W, 8);
      ctx.fillStyle = "#3a3145";
      ctx.fillRect(0, TABLE_Y + 8, GAME_W, GAME_H - TABLE_Y - 8);

      for (const [seat, seatX] of SEAT_X.entries()) {
        const guest = table.guests[seat];
        if (!guest) continue;
        const pose: FrameName =
          guest.phase === "served" ? "eat1" : guest.phase === "leaving" ? "angry1" : guest.phase === "arriving" ? "walk2" : GUEST_POSES[seat]!;
        drawFrameAnchored(ctx, sheet, pose, seatX, TABLE_Y + 4, GUEST_H);

        if (guest.phase === "waiting") {
          // A speech bubble: what they are asking for, and how long they
          // will keep asking. Smaller than the tray on purpose — this is
          // the question, not the answer.
          ctx.fillStyle = CREAM;
          ctx.beginPath();
          ctx.roundRect(seatX - 12, 8, 24, 18, 4);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(seatX - 3, 26);
          ctx.lineTo(seatX + 3, 26);
          ctx.lineTo(seatX, 30);
          ctx.fill();
          drawFrame(ctx, sheet, guest.wants, seatX - 8, 11, 16, 12);
          const lost = wrongFlash.seat === seat && wrongFlash.ms > 0 ? wrongFlash.patienceBefore : null;
          drawPatience(seatX, 32, guest.patience, lost);
        } else if (guest.phase === "leaving") {
          ctx.fillStyle = ROSE;
          ctx.font = "bold 14px monospace";
          ctx.fillText("✗", seatX - 5, 22);
          drawPatience(seatX, 32, 0, null);
        }

        if (servedFlash.seat === seat && servedFlash.ms > 0) {
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = 2;
          ctx.strokeRect(seatX - 20, TABLE_Y - GUEST_H + 2, 40, GUEST_H + 4);
        }
        if (wrongFlash.seat === seat && wrongFlash.ms > 0) {
          ctx.strokeStyle = ROSE;
          ctx.lineWidth = 2;
          ctx.strokeRect(seatX - 20, TABLE_Y - GUEST_H + 2, 40, GUEST_H + 4);
        }
      }

      // The tray. A wobble while plating says "not yet" to an early tap.
      const jitter = jitterMs > 0 ? (Math.floor(jitterMs / 40) % 2 === 0 ? 2 : -2) : 0;
      const plateX = TRAY_X - PLATE_W / 2 + jitter;
      ctx.fillStyle = table.tray === null ? "#5a5266" : CREAM;
      ctx.beginPath();
      ctx.roundRect(plateX, TRAY_Y, PLATE_W, PLATE_H, 6);
      ctx.fill();
      ctx.font = "bold 8px monospace";
      if (table.tray === null) {
        ctx.fillStyle = jitterMs > 0 ? CREAM : MUTED;
        ctx.fillText(replated ? "re-plating…" : "plating…", plateX, TRAY_Y - 3);
      } else {
        ctx.fillStyle = GOLD;
        ctx.fillText("SERVE", plateX, TRAY_Y - 3);
        drawFrame(ctx, sheet, table.tray, plateX + 7, TRAY_Y + 2, 34, 26);
      }

      // What comes up after this one, small and muted so it never competes.
      ctx.fillStyle = MUTED;
      ctx.font = "8px monospace";
      ctx.fillText("next", TRAY_X + PLATE_W / 2 + 10, TRAY_Y + 8);
      drawFrame(ctx, sheet, table.next, TRAY_X + PLATE_W / 2 + 10, TRAY_Y + 11, 14, 11);

      ctx.font = "10px monospace";
      ctx.fillStyle = CREAM;
      ctx.fillText(`served ${table.served}`, 6, TRAY_Y + 10);
      ctx.fillStyle = table.walkouts > 0 ? ROSE : MUTED;
      ctx.fillText(`lost ${table.walkouts}`, 6, TRAY_Y + 24);
      ctx.fillStyle = CREAM;
      ctx.fillText(`${Math.max(0, Math.ceil((RUN_MS - elapsed) / 1000))}s`, GAME_W - 28, TRAY_Y + 10);

      if (elapsed >= RUN_MS) {
        stop();
        finish(table.served, inputs);
      }
    });

    return () => {
      stop();
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [sheet, reportScore, finish]);

  return <canvas ref={canvasRef} width={GAME_W} height={GAME_H} className="w-full touch-none [image-rendering:pixelated]" />;
}
