"use client";

// The care actions (SPEC §11.2) as tactile tiles: springy press feedback, a
// draining progress track while a cooldown runs, and the reason always
// visible. Availability comes from the same canPerform() the server
// enforces — the single authority (SPEC §4.1). aria-disabled (never
// disabled) keeps unavailable actions in the tab order with their reason in
// the accessible name (SPEC §11.3).

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

/**
 * How far a cooldown has left to run, 1 just after the action to 0 when it is
 * ready again. The sim's tick is a whole number that only moves every ten
 * seconds, so a bar driven by it lurches; this measures the remainder in
 * fractional ticks against the corrected clock, which drains smoothly between
 * ticks (SPEC §11.2).
 *
 * The span is the whole window the action is held for — armed to ready — not
 * the nominal length of one of the two overlapping cooldowns. Measuring
 * against a cooldown that ends before the action frees up is what made the
 * bar empty and then refill.
 */
export const cooldownProgress = (sinceTick: number, readyAtTick: number, nowTickExact: number): number => {
  const span = readyAtTick - sinceTick;
  if (span <= 0) return 0;
  const remaining = Math.max(0, readyAtTick - nowTickExact);
  return Math.min(1, remaining / span);
};

/** Whole seconds still to wait, for the label under the button. */
export const cooldownSeconds = (retryAtTick: number, nowTickExact: number): number =>
  Math.max(1, Math.ceil(Math.max(0, retryAtTick - nowTickExact) * TICK_SECONDS));

export type ActionBarProps = {
  state: PetState;
  ctx: ProjectionContext;
  caretakerId: string;
  petName: string;
  /**
   * The corrected clock in fractional ticks, sampled at the caller's last
   * projection. It arrives as a prop so this component stays pure across
   * renders, so the bars move on the same 250ms cadence the meters do, and so
   * a bar empties on exactly the tick canPerform() starts saying yes.
   */
  nowTickExact: number;
  /** PLAY launches the minigame (SPEC §13.3) instead of posting directly. */
  onPlay: () => void;
};

export default function ActionBar({ state, ctx, caretakerId, petName, nowTickExact, onPlay }: ActionBarProps) {
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
          let cooldownFraction = 0; // 0 = ready, 1 = just used
          if (!verdict.ok) {
            if (verdict.retryAtTick !== undefined && verdict.sinceTick !== undefined) {
              cooldownFraction = cooldownProgress(verdict.sinceTick, verdict.retryAtTick, nowTickExact);
              const seconds = cooldownSeconds(verdict.retryAtTick, nowTickExact);
              hint =
                verdict.reason === "COOLDOWN_GLOBAL"
                  ? `${petName} is busy (${seconds}s)`
                  : `Catch your breath (${seconds}s)`;
            } else {
              hint = reasons[verdict.reason] ?? "Not right now";
            }
          }
          return (
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
              className={`press panel relative flex min-h-16 flex-col items-center justify-center gap-0.5 overflow-hidden !rounded-xl px-1 py-2 text-sm ${
                verdict.ok
                  ? "hover:border-accent/40 hover:shadow-[0_0_18px_-6px_var(--color-accent)]"
                  : "cursor-not-allowed opacity-45"
              }`}
            >
              <span aria-hidden="true" className="text-xl leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]">
                {meta.emoji}
              </span>
              <span className="text-[12px] font-semibold leading-tight">{meta.label}</span>
              <span className="min-h-3 max-w-full truncate px-1 text-[9px] leading-none text-muted">{hint ?? " "}</span>
              {/* Cooldown drain track along the bottom edge. */}
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-white/5">
                <span
                  className="block h-full rounded-r-full bg-accent transition-[width] duration-200 ease-linear"
                  style={{ width: `${cooldownFraction * 100}%` }}
                />
              </span>
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
