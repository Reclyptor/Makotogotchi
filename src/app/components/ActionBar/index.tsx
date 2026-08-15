"use client";

// The care actions (SPEC §11.2). Availability comes from the same
// canPerform() the server enforces — the single authority (SPEC §4.1) — so a
// disabled button always knows its reason, with a live countdown for
// cooldowns. Buttons stay keyboard-operable and expose the reason via
// aria-label even while disabled.

import { useCallback, useState } from "react";
import { canPerform } from "@/sim/validate";
import { CARE_ACTIONS, TICK_SECONDS, type CareAction } from "@/sim/tuning";
import type { PetState, ProjectionContext } from "@/sim/model";

const ACTION_META: Record<CareAction, { label: string; emoji: string }> = {
  FEED: { label: "Feed", emoji: "🍖" },
  PLAY: { label: "Play", emoji: "🎮" },
  CLEAN: { label: "Clean", emoji: "🌪️" },
  MEDICATE: { label: "Medicate", emoji: "💊" },
  LULLABY: { label: "Lullaby", emoji: "🎵" },
  PET: { label: "Pet", emoji: "💛" },
};

const REASON_TEXT = (petName: string): Record<string, string> => ({
  NOT_BORN: `${petName} hasn't hatched yet`,
  DEAD: `${petName} is gone`,
  ASLEEP: `${petName} is asleep`,
  TOO_TIRED: `${petName} is too tired to play`,
  NOT_SICK: `${petName} isn't sick`,
  NOT_SLEEPY: `${petName} isn't sleepy`,
});

export type ActionBarProps = {
  state: PetState;
  ctx: ProjectionContext;
  caretakerId: string;
  petName: string;
  /** PLAY launches the minigame (SPEC §13.3) instead of posting directly. */
  onPlay: () => void;
};

export default function ActionBar({ state, ctx, caretakerId, petName, onPlay }: ActionBarProps) {
  const [notice, setNotice] = useState<string | null>(null);

  const act = useCallback(
    async (action: CareAction) => {
      setNotice(null);
      const response = await fetch("/api/care", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }).catch(() => null);
      if (!response) {
        setNotice("Connection hiccup — try again.");
        return;
      }
      if (response.status === 429) {
        setNotice("Easy! You're moving too fast.");
      } else if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null;
        setNotice(REASON_TEXT(petName)[body?.reason ?? ""] ?? `${petName} can't do that right now.`);
      } else if (response.ok) {
        const body = (await response.json().catch(() => null)) as { applied?: number } | null;
        if (body && body.applied === 0) setNotice(`${petName} wants someone else's attention.`);
      }
    },
    [petName],
  );

  const reasons = REASON_TEXT(petName);

  return (
    <div className="flex w-full flex-col gap-2">
      <div role="group" aria-label="Care actions" className="grid w-full grid-cols-3 gap-2 sm:grid-cols-6">
        {CARE_ACTIONS.map((action) => {
          const verdict = canPerform(state, action, caretakerId, ctx);
          const meta = ACTION_META[action];
          let hint: string | null = null;
          if (!verdict.ok) {
            if (verdict.retryAtTick !== undefined) {
              const seconds = Math.max(1, (verdict.retryAtTick - state.tick) * TICK_SECONDS);
              hint =
                verdict.reason === "COOLDOWN_GLOBAL"
                  ? `${petName} is busy (${seconds}s)`
                  : `Catch your breath (${seconds}s)`;
            } else {
              hint = reasons[verdict.reason] ?? "Not right now";
            }
          }
          return (
            // aria-disabled instead of disabled: unavailable actions stay in
            // the tab order so keyboard and screen-reader users can reach
            // them and hear the reason (SPEC §11.3).
            <button
              key={action}
              type="button"
              onClick={() => {
                if (!verdict.ok) return;
                if (action === "PLAY") onPlay();
                else void act(action);
              }}
              aria-disabled={!verdict.ok}
              aria-label={hint ? `${meta.label} — ${hint}` : meta.label}
              title={hint ?? meta.label}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg bg-surface px-2 py-1.5 text-sm outline-offset-2 transition-colors ${
                verdict.ok ? "hover:bg-accent/20 active:bg-accent/30" : "cursor-not-allowed opacity-40"
              }`}
            >
              <span aria-hidden="true" className="text-lg leading-none">
                {meta.emoji}
              </span>
              <span className="leading-tight">{meta.label}</span>
              <span className="min-h-3 text-[10px] leading-none text-muted">{hint ?? " "}</span>
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="min-h-5 text-center text-sm text-muted">
        {notice}
      </p>
    </div>
  );
}
