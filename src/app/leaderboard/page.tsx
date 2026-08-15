// The caretaker rankings (SPEC §2.11): today / this week / all time / this
// generation, with a crown on the current leader.

import Link from "next/link";
import { db } from "@/server/db/client";
import { runtime } from "@/server/runtime";
import { leaderboard, type LeaderboardWindow } from "@/server/social";

export const dynamic = "force-dynamic";

const WINDOWS: { key: LeaderboardWindow; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "generation", label: "This Generation" },
  { key: "all", label: "All Time" },
];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const params = await searchParams;
  const active = (WINDOWS.find((candidate) => candidate.key === params.window)?.key ?? "week") as LeaderboardWindow;

  const { engine, generation } = await runtime();
  const current = await generation();
  const state = await engine.view(current);
  const rows = await leaderboard(await db(), active, { generationId: current.id, nowTick: state.tick });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Leaderboard</h1>
        <Link href="/" className="text-sm text-muted underline underline-offset-2 hover:text-foreground">
          ← back to {current.name ?? "the egg"}
        </Link>
      </header>

      <nav aria-label="Time window" className="flex flex-wrap gap-2 text-sm">
        {WINDOWS.map(({ key, label }) => (
          <Link
            key={key}
            href={`/leaderboard?window=${key}`}
            aria-current={key === active ? "page" : undefined}
            className={`rounded-md px-3 py-1 ${key === active ? "bg-accent/30 font-semibold" : "bg-surface text-muted hover:text-foreground"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <ol className="flex flex-col gap-1">
        {rows.map((row, index) => (
          <li key={row.caretakerId} className="flex items-center gap-3 rounded-md bg-surface px-3 py-2 text-sm">
            <span className="w-6 text-right tabular-nums text-muted">{index + 1}</span>
            <span className="flex-1 font-medium">
              {index === 0 && <span aria-label="current leader">👑 </span>}
              {row.name}
            </span>
            <span className="tabular-nums text-muted">{row.score.toLocaleString()}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-muted">Nobody has cared yet. Be the first.</li>}
      </ol>
    </main>
  );
}
