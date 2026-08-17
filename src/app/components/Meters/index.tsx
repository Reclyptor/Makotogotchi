"use client";

// The five need meters as segmented retro bars (SPEC §11.2–11.3): ten
// chunky cells per need, filled left to right with a per-need hue, animated
// on change. Semantics first — each row is a real role="meter" with a text
// value, and critical states carry an icon and the word "low", never colour
// alone.

import type { DerivedState } from "@/sim/derive";

const METER_ROWS = [
  { key: "hunger", label: "Hunger", emoji: "🍖", hue: "#fb923c" },
  { key: "energy", label: "Energy", emoji: "⚡", hue: "#facc15" },
  { key: "hygiene", label: "Hygiene", emoji: "✨", hue: "#38bdf8" },
  { key: "joy", label: "Joy", emoji: "💛", hue: "#a78bfa" },
  { key: "health", label: "Health", emoji: "❤️", hue: "#fb7185" },
] as const;

const CRITICAL_PERCENT = 20;

export type MetersProps = {
  percentages: DerivedState["percentages"];
  /** How many caretakers the difficulty is set for (SPEC §23.3). */
  population: number;
  /** What that community multiplies need decay by. */
  careMultiplier: number;
  petName: string;
};

export default function Meters({ percentages, population, careMultiplier, petName }: MetersProps) {
  // A needier pet should read as a bigger community, never as a silent nerf.
  const crowd = `${population} caretaker${population === 1 ? "" : "s"} this week`;
  const demand = careMultiplier > 1 ? ` · ${petName} needs ${careMultiplier.toFixed(1)}× the care` : "";
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
    </ul>
  );
}
