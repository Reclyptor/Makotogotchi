"use client";

// Sausage Party: a tea party, except it is sausages, except the sausages are
// the Makotos who misbehaved and nobody at the table knows it (SPEC §13.3.2).
//
// A dish comes up on the tray; tap the guest holding that dish up. Right guest
// is a point and they leave happy; wrong guest costs them patience, and a
// guest whose patience runs out leaves without being served. One tap, three
// things to read at once — the roster's only matching game.

import { useEffect, useRef } from "react";
import type { FrameName } from "@/game/atlas.generated";
import { drawFrame, drawFrameAnchored, GAME_H, GAME_W, startGameLoop } from "./engine";
import type { GameProps } from "./types";

const RUN_MS = 35_000;
const TABLE_Y = 78;
const SEATS = [46, 130, 214] as const;
const SEAT_HIT = 40; // how far a tap can be from a seat and still count

// What can be asked for. Sausage first, because that is the whole joke.
const DISHES = ["partyPlate", "coffeeMug", "onigiri", "fish"] as const satisfies readonly FrameName[];
type Dish = (typeof DISHES)[number];

const PATIENCE_MS = 7000; // a guest waits this long before giving up
const WRONG_COST_MS = 2200; // and loses this much of it to a wrong plate
const SERVED_MS = 700; // celebrating before the seat turns over
const ARRIVE_MS = 500;
// The next dish takes a moment to come up, which is what paces the game —
// without it the only limit on scoring would be how fast a player can tap.
const RELOAD_MS = 900;

const GUEST_POSES: readonly FrameName[] = ["clone1", "clone3", "clone5"];

type Guest = {
  wants: Dish;
  patience: number;
  /** Counts down while they celebrate a correct plate, then they leave. */
  servedMs: number;
  /** Counts down as they sit down, before they can be served. */
  arrivingMs: number;
};

const randomDish = (): Dish => DISHES[Math.floor(Math.random() * DISHES.length)]!;
const newGuest = (): Guest => ({ wants: randomDish(), patience: PATIENCE_MS, servedMs: 0, arrivingMs: ARRIVE_MS });

export default function SausageParty({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let score = 0;
    let inputs = 0;
    let elapsed = 0;
    let guests: (Guest | null)[] = [newGuest(), newGuest(), newGuest()];
    let tray: Dish = randomDish();
    let nextTray: Dish = randomDish();
    let flashSeat = -1;
    let flashMs = 0;
    let wrongSeat = -1;
    let reloadMs = 0;

    // The tray only ever holds something at least one guest wants, so the
    // player is never handed a dead dish.
    const dealTray = (): void => {
      tray = nextTray;
      const wanted = guests.filter((guest): guest is Guest => guest !== null && guest.servedMs === 0).map((g) => g.wants);
      nextTray = wanted.length > 0 && Math.random() < 0.8 ? wanted[Math.floor(Math.random() * wanted.length)]! : randomDish();
    };

    const serve = (seat: number): void => {
      if (!armed()) return;
      inputs += 1;
      if (reloadMs > 0) return; // nothing on the tray to serve yet
      const guest = guests[seat];
      if (!guest || guest.servedMs > 0 || guest.arrivingMs > 0) return;
      if (guest.wants === tray) {
        score += 1;
        reportScore(score);
        guest.servedMs = SERVED_MS;
        flashSeat = seat;
        flashMs = 260;
        wrongSeat = -1;
        reloadMs = RELOAD_MS;
        dealTray();
      } else {
        guest.patience = Math.max(0, guest.patience - WRONG_COST_MS);
        wrongSeat = seat;
        flashMs = 260;
      }
    };

    const onPointerDown = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * GAME_W;
      let best = -1;
      for (const [seat, seatX] of SEATS.entries()) {
        if (Math.abs(seatX - x) <= SEAT_HIT) best = seat;
      }
      if (best >= 0) serve(best);
    };
    const KEY_SEATS: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, ArrowLeft: 0, ArrowDown: 1, ArrowRight: 2 };
    const onKey = (event: KeyboardEvent): void => {
      const seat = KEY_SEATS[event.code];
      if (seat === undefined) return;
      event.preventDefault();
      serve(seat);
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);

    const { stop, armed } = startGameLoop((dtMs) => {
      elapsed += dtMs;
      flashMs = Math.max(0, flashMs - dtMs);
      reloadMs = Math.max(0, reloadMs - dtMs);
      if (flashMs === 0) {
        flashSeat = -1;
        wrongSeat = -1;
      }

      guests = guests.map((guest) => {
        if (!guest) return newGuest();
        if (guest.arrivingMs > 0) return { ...guest, arrivingMs: guest.arrivingMs - dtMs };
        if (guest.servedMs > 0) {
          const servedMs = guest.servedMs - dtMs;
          return servedMs > 0 ? { ...guest, servedMs } : newGuest();
        }
        const patience = guest.patience - dtMs;
        // Out of patience: they give up and the seat turns over.
        return patience > 0 ? { ...guest, patience } : newGuest();
      });

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1d1825";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      // The table runs across the room, guests behind it, the tray in front.
      ctx.fillStyle = "#4a3a2c";
      ctx.fillRect(0, TABLE_Y, GAME_W, 8);
      ctx.fillStyle = "#3a3145";
      ctx.fillRect(0, TABLE_Y + 8, GAME_W, GAME_H - TABLE_Y - 8);

      for (const [seat, seatX] of SEATS.entries()) {
        const guest = guests[seat];
        if (!guest) continue;
        const settling = guest.arrivingMs > 0;
        const pose: FrameName = guest.servedMs > 0 ? "eat1" : settling ? "walk2" : GUEST_POSES[seat]!;
        drawFrameAnchored(ctx, sheet, pose, seatX, TABLE_Y + 4, 40);

        if (!settling && guest.servedMs === 0) {
          // What they are holding up, and how long they will hold it up for.
          drawFrame(ctx, sheet, guest.wants, seatX - 9, TABLE_Y - 62, 18, 14);
          const width = Math.round(26 * (guest.patience / PATIENCE_MS));
          ctx.fillStyle = "#241d2e";
          ctx.fillRect(seatX - 13, TABLE_Y - 44, 26, 4);
          ctx.fillStyle = guest.patience < PATIENCE_MS * 0.3 ? "#fb7185" : "#34d399";
          ctx.fillRect(seatX - 13, TABLE_Y - 44, width, 4);
        }
        if (seat === flashSeat) {
          ctx.strokeStyle = "#fff261";
          ctx.lineWidth = 2;
          ctx.strokeRect(seatX - 20, TABLE_Y - 46, 40, 50);
        }
        if (seat === wrongSeat) {
          ctx.strokeStyle = "#fb7185";
          ctx.lineWidth = 2;
          ctx.strokeRect(seatX - 20, TABLE_Y - 46, 40, 50);
        }
      }

      // The tray: what is being served now, and what is coming next.
      ctx.fillStyle = "#f5f0dc";
      ctx.font = "10px monospace";
      ctx.fillText(reloadMs > 0 ? "plating…" : "serving", 8, GAME_H - 20);
      if (reloadMs === 0) drawFrame(ctx, sheet, tray, 8, GAME_H - 18, 22, 17);
      ctx.fillStyle = "#8b8397";
      ctx.fillText("next", 40, GAME_H - 20);
      drawFrame(ctx, sheet, nextTray, 40, GAME_H - 16, 15, 12);

      ctx.fillStyle = "#f5f0dc";
      ctx.fillText(`served ${score}`, 96, 14);
      ctx.fillText(`${Math.max(0, Math.ceil((RUN_MS - elapsed) / 1000))}s`, GAME_W - 28, 14);

      if (elapsed >= RUN_MS) {
        stop();
        finish(score, inputs);
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
