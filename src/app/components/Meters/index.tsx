"use client";

// The five need meters as segmented retro bars (SPEC §11.2–11.3): ten
// chunky cells per need, filled left to right with a per-need hue, animated
// on change. Semantics first — each row is a real role="meter" with a text
// value, and critical states carry an icon and the word "low", never colour
// alone.

import type { DerivedState } from "@/sim/derive";
import { NEED_KEYS, type NeedKey } from "@/sim/tuning";

const METER_ROWS = [
  { key: "hunger", label: "Hunger", emoji: "🍖", hue: "#fb923c" },
  { key: "energy", label: "Energy", emoji: "⚡", hue: "#facc15" },
  { key: "hygiene", label: "Hygiene", emoji: "✨", hue: "#38bdf8" },
  { key: "joy", label: "Joy", emoji: "💛", hue: "#a78bfa" },
  { key: "health", label: "Health", emoji: "❤️", hue: "#fb7185" },
] as const;

const CRITICAL_PERCENT = 20;

/** The allowance is per need, and these are the same emoji the rows use. */
const ALLOWANCE_EMOJI: Record<NeedKey, string> = {
  hunger: "🍖",
  energy: "⚡",
  hygiene: "✨",
  joy: "💛",
};

export type MetersProps = {
  percentages: DerivedState["percentages"];
  /** How many named caretakers the difficulty is set for (SPEC §23.1, §23.3). */
  population: number;
  /** What that community multiplies need decay by. */
  careMultiplier: number;
  /**
   * How much of this caretaker's own weekly allowance is left per need, 0–100
   * (SPEC §2.5), or null before a caretaker cookie exists — a viewer with no
   * identity has no allowance to report, and inventing a full one for them
   * would be the one number on this panel that means nothing.
   *
   * The line above states the demand; without this one the supply was
   * invisible, and a spent allowance was indistinguishable from a bug.
   */
  allowance: Record<NeedKey, number> | null;
  petName: string;
};

export default function Meters({ percentages, population, careMultiplier, allowance, petName }: MetersProps) {
  // A needier pet should read as a bigger community, never as a silent nerf.
  const crowd = `${population} named caretaker${population === 1 ? "" : "s"} this week`;
  const demand = careMultiplier > 1 ? ` · ${petName} needs ${careMultiplier.toFixed(1)}× the care` : "";
  const allowanceText = allowance && NEED_KEYS.map((need) => `${ALLOWANCE_EMOJI[need]} ${allowance[need]}%`).join(" · ");
  return (
    <ul className="panel flex w-full flex-col gap-2 px-4 py-3">
      {METER_ROWS.map(({ key, label, emoji, hue }) => {
        const value = percentages[key];
        const low = value < CRITICAL_PERCENT;
        return (
          <li key={key} className="flex items-center gap-2.5 text-sm">
            <span aria-hidden="true" className={`w-6 text-center text-base ${low ? "animate-wiggle" : ""}`}>
              {emoji}
            </span>
            <span className="w-16 shrink-0 text-[13px] font-medium text-muted">{label}</span>
            <div
              role="meter"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
              aria-valuetext={`${value}%${low ? " — critically low" : ""}`}
              className="relative h-4 flex-1 overflow-hidden rounded-full"
              style={{
                background: "rgba(0,0,0,0.35)",
                boxShadow: "inset 0 1px 3px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.06)",
              }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${value}%`,
                  background: `linear-gradient(180deg, ${hue}f0, ${hue}b8)`,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -2px 3px rgba(0,0,0,0.25), 0 0 10px ${hue}44`,
                }}
              />
            </div>
            <span
              className={`w-13 shrink-0 text-right text-[13px] tabular-nums ${low ? "font-bold text-rose" : "text-muted"}`}
            >
              {value}%{low && <span aria-hidden="true"> ⚠</span>}
            </span>
          </li>
        );
      })}
      <li className="px-1 pt-0.5 text-[11px] leading-tight text-muted">
        <span aria-hidden="true">👥 </span>
        {crowd}
        {demand}
      </li>
      {allowanceText && (
        <li className="px-1 text-[11px] leading-tight text-muted">
          <span aria-hidden="true">🎟️ </span>
          <span className="sr-only">Your remaining care allowance this week: </span>
          Your week&rsquo;s allowance · <span className="tabular-nums">{allowanceText}</span>
        </li>
      )}
    </ul>
  );
}
