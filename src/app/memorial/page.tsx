// The memorial wall (SPEC §2.10): every past generation, its lifespan, how
// it died, and who kept it alive the longest.

import Link from "next/link";
import { db } from "@/server/db/client";
import { generations } from "@/server/db/collections";
import { FOOD_ITEMS } from "@/sim/economy";
import { MINIGAMES } from "@/sim/minigames";
import { TICKS_PER_DAY } from "@/sim/tuning";
import { isTitleId, TITLES } from "@/sim/titles";
import type { Quirks } from "@/sim/quirks";

export const dynamic = "force-dynamic";

const CAUSE_TEXT: Record<string, string> = {
  hunger: "starved",
  energy: "collapsed from exhaustion",
  hygiene: "wasted away in squalor",
  joy: "died of loneliness",
  sickness: "succumbed to illness",
  age: "passed peacefully of old age",
};

/** "loved pizza, hated peppers, was best at Wheel Sprint" (SPEC §21.4). */
const quirkText = (quirks: Quirks | undefined): string | null =>
  quirks === undefined
    ? null
    : `Loved ${FOOD_ITEMS[quirks.favoriteFood].label}, hated ${FOOD_ITEMS[quirks.dislikedFood].label}, was best at ${MINIGAMES[quirks.favoriteGame].title}.`;

export default async function MemorialPage() {
  const docs = await generations(await db())
    .find({ died: { $ne: null } })
    .sort({ ordinal: -1 })
    .limit(100)
    .toArray();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">🪦 Memorial</h1>
        <Link href="/" className="text-sm text-muted underline underline-offset-2 hover:text-foreground">
          ← back
        </Link>
      </header>

      {docs.length === 0 && (
        <p className="text-sm text-muted">No pet has died yet. May this wall stay empty a long, long time.</p>
      )}

      <ol className="flex flex-col gap-3">
        {docs.map((doc) => {
          const lifespanDays =
            doc.hatchedAtTick !== null ? Math.round(((doc.died!.tick - doc.hatchedAtTick) / TICKS_PER_DAY) * 10) / 10 : 0;
          const quirks = quirkText(doc.memorial?.quirks);
          return (
            <li key={doc._id} className="flex flex-col gap-2 rounded-lg bg-surface p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">{doc.name ?? "Unnamed"}</h2>
                <span className="text-xs text-muted">generation {doc.ordinal}</span>
              </div>
              <p className="text-sm text-muted">
                Lived {lifespanDays} days · {CAUSE_TEXT[doc.died!.cause] ?? doc.died!.cause} ·{" "}
                {doc.died!.at.toLocaleDateString()}
              </p>
              {quirks && <p className="text-sm italic text-muted">{quirks}</p>}
              {doc.memorial?.titles !== undefined && doc.memorial.titles.length > 0 && (
                <p className="text-sm text-muted">
                  {doc.memorial.titles
                    .map((row) => `${isTitleId(row.titleId) ? TITLES[row.titleId].chip + " " + TITLES[row.titleId].label : row.titleId}: ${row.name}`)
                    .join(" · ")}
                </p>
              )}
              {doc.memorial && doc.memorial.ranking.length > 0 && (
                <div className="text-sm">
                  <h3 className="text-xs uppercase tracking-wide text-muted">devoted caretakers</h3>
                  <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {doc.memorial.ranking.slice(0, 5).map((row, index) => (
                      <li key={row.caretakerId}>
                        {index === 0 ? "🏅 " : ""}
                        {row.name}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </main>
  );
}
