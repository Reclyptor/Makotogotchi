// GET /api/leaderboard?window=today|week|all|generation (SPEC §2.11).

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { runtime } from "@/server/runtime";
import { leaderboard, type LeaderboardWindow } from "@/server/social";

export const dynamic = "force-dynamic";

const WINDOWS: LeaderboardWindow[] = ["today", "week", "all", "generation"];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const raw = request.nextUrl.searchParams.get("window") ?? "week";
  if (!WINDOWS.includes(raw as LeaderboardWindow)) {
    return NextResponse.json({ error: "invalid_window" }, { status: 400 });
  }
  const { engine, generation } = await runtime();
  const current = await generation();
  const state = await engine.view(current);
  const rows = await leaderboard(await db(), raw as LeaderboardWindow, { generationId: current.id, nowTick: state.tick });
  return NextResponse.json({ window: raw, rows }, { headers: { "Cache-Control": "no-store" } });
}
