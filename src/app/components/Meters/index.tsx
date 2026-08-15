"use client";

// The five need meters (SPEC §11.2–11.3). Semantic first: each is a real
// role="meter" with a text value — the colored bar is presentation. Colour is
// never the only carrier: critical needs gain an icon and the word "low".

import type { DerivedState } from "@/sim/derive";

const METER_ROWS = [
  { key: "hunger", label: "Hunger", emoji: "🍖" },
  { key: "energy", label: "Energy", emoji: "⚡" },
  { key: "hygiene", label: "Hygiene", emoji: "✨" },
  { key: "joy", label: "Joy", emoji: "💛" },
  { key: "health", label: "Health", emoji: "❤️" },
] as const;

const CRITICAL_PERCENT = 20;

export type MetersProps = {
  percentages: DerivedState["percentages"];
};

export default function Meters({ percentages }: MetersProps) {
  return (
    <ul className="flex w-full flex-col gap-1.5">
      {METER_ROWS.map(({ key, label, emoji }) => {
        const value = percentages[key];
        const low = value < CRITICAL_PERCENT;
        return (
          <li key={key} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className="w-6 text-center">
              {emoji}
            </span>
            <span className="w-16 shrink-0">{label}</span>
            <div
              role="meter"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
              aria-valuetext={`${value}%${low ? " — critically low" : ""}`}
              className="relative h-3 flex-1 overflow-hidden rounded-sm bg-black/40"
            >
              <div
                className={`h-full transition-[width] duration-500 ${low ? "bg-rose-500" : "bg-accent"}`}
                style={{ width: `${value}%` }}
              />
            </div>
            <span className={`w-14 text-right tabular-nums ${low ? "text-rose-400 font-semibold" : "text-muted"}`}>
              {value}%{low && <span aria-hidden="true"> ⚠</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
