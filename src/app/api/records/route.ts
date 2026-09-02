// GET /api/records — both boards for every minigame (SPEC §21.3), with
// holder nicknames already resolved so the client renders straight through.

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { runtime } from "@/server/runtime";
import { gameRecords } from "@/server/records";
import { isoWeekKeyAtTick } from "@/server/schedule";
import { env } from "@/server/env";
import { rateLimit } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Both boards for every minigame, with holder names resolved.
  const limited = await rateLimit(request, { kind: "read" });
  if (limited) return limited;

  const { engine, generation } = await runtime();
  const current = await generation();
  const state = await engine.view(current);
  const weekKey = isoWeekKeyAtTick(current.genesisEpochMs, state.tick, env().PET_TIMEZONE);
  const games = await gameRecords(await db(), weekKey);
  return NextResponse.json({ weekKey, games }, { headers: { "Cache-Control": "no-store" } });
}
