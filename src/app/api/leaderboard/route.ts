// GET /api/leaderboard?window=today|week|all|generation (SPEC §2.11).

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { runtime } from "@/server/runtime";
import { leaderboard, type LeaderboardWindow } from "@/server/social";
import { rateLimit } from "@/server/http";

export const dynamic = "force-dynamic";

const WINDOWS: LeaderboardWindow[] = ["today", "week", "all", "generation"];

/** Narrows the query string once, so nothing downstream has to re-assert it. */
const isWindow = (raw: string): raw is LeaderboardWindow => WINDOWS.includes(raw as LeaderboardWindow);

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Every window but "all" is a $group across the whole contributions
  // collection — the most expensive read the app serves.
  const limited = await rateLimit(request, { kind: "read" });
  if (limited) return limited;

  const raw = request.nextUrl.searchParams.get("window") ?? "week";
  if (!isWindow(raw)) {
    return NextResponse.json({ error: "invalid_window" }, { status: 400 });
  }
  const { engine, generation } = await runtime();
  const current = await generation();
  const state = await engine.view(current);
  const rows = await leaderboard(await db(), raw, { generationId: current.id, nowTick: state.tick });
  return NextResponse.json({ window: raw, rows }, { headers: { "Cache-Control": "no-store" } });
}
