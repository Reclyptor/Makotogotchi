"use client";

// The pet's current ask (SPEC §25.7): a slim strip beside the quest banner
// with the wish and a countdown to its window's end. No fetch and no
// subscription — the open want rides the authoritative state the page
// already projects at 4 Hz, so this is a pure view of props.

import type { WantOpen } from "@/sim/model";
import { windowEndTick } from "@/sim/wants";
import { TICK_SECONDS } from "@/sim/tuning";
import { wantAsk } from "./copy";

export type WantBannerProps = {
  want: WantOpen | null;
  /** The corrected clock in fractional ticks — the countdown's timebase. */
  nowTickExact: number;
  petName: string;
};

export default function WantBanner({ want, nowTickExact, petName }: WantBannerProps) {
  if (!want) return null;

  const remainingSeconds = Math.max(0, Math.floor((windowEndTick(want.window) - nowTickExact) * TICK_SECONDS));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");

  return (
    <section aria-label={`${petName}'s wish`} className="panel animate-pop w-full !rounded-full px-4 py-2">
      <p className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">
          <span aria-hidden="true">💭 </span>
          {wantAsk(petName, want.kind, want.itemId)}
        </span>
        <span className="shrink-0 tabular-nums text-muted">
          {minutes}:{seconds}
        </span>
      </p>
    </section>
  );
}
