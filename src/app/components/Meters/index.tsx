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
const SEGMENTS = 10;

export type MetersProps = {
  percentages: DerivedState["percentages"];
};

export default function Meters({ percentages }: MetersProps) {
  return (
    <ul className="panel flex w-full flex-col gap-2 px-4 py-3">
      {METER_ROWS.map(({ key, label, emoji, hue }) => {
        const value = percentages[key];
        const low = value < CRITICAL_PERCENT;
        const filled = Math.round((value / 100) * SEGMENTS);
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
              className="flex flex-1 gap-[3px]"
            >
              {Array.from({ length: SEGMENTS }, (_, index) => {
                const on = index < filled;
                return (
                  <span
                    key={index}
                    className="h-3.5 flex-1 rounded-[4px] transition-all duration-300"
                    style={
                      on
                        ? { backgroundColor: hue, boxShadow: `0 0 6px ${hue}55` }
                        : { backgroundColor: "rgba(255,255,255,0.06)" }
                    }
                  />
                );
              })}
            </div>
            <span
              className={`w-13 shrink-0 text-right text-[13px] tabular-nums ${low ? "font-bold text-rose" : "text-muted"}`}
            >
              {value}%{low && <span aria-hidden="true"> ⚠</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
