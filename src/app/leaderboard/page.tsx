// The caretaker rankings (SPEC §2.11): today / this week / all time / this
// generation, with a crown on the current leader — plus the minigame record
// boards (SPEC §21.3), which rank machines rather than devotion.

import Link from "next/link";
import { db } from "@/server/db/client";
import { runtime } from "@/server/runtime";
import { leaderboard, type LeaderboardWindow } from "@/server/social";
import { gameRecords, type RecordHolder } from "@/server/records";
import { isoWeekKeyAtTick } from "@/server/schedule";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

const holderText = (holder: RecordHolder | null): string => (holder ? `${holder.score} · ${holder.name}` : "—");

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
  const boards = await gameRecords(await db(), isoWeekKeyAtTick(current.genesisEpochMs, state.tick, env().PET_TIMEZONE));

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

      {/* Records: one aligned row per game, weekly beside all-time. */}
      <section aria-label="Records" className="flex flex-col gap-1">
        <h2 className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Records</h2>
        <ul className="flex flex-col">
          {boards.map((board) => (
            <li
              key={board.game}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-white/[0.04]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">
                  <span aria-hidden="true">{board.emoji} </span>
                  {board.title}
                </p>
                <p className="truncate text-[11px] leading-tight text-muted">this week · all time</p>
              </div>
              <span className="w-28 truncate text-right text-xs tabular-nums text-muted">{holderText(board.weekly)}</span>
              <span className="w-28 truncate text-right text-xs font-semibold tabular-nums text-gold">
                {holderText(board.alltime)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
