// GET /api/quest — today's communal goal and how far the room has got
// (SPEC §21.7). Progress is derived on every call from one pet-day of the
// event log, so there is nothing to keep in sync and nothing to reset.

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { runtime } from "@/server/runtime";
import { questSettled, questView } from "@/server/quests";
import { env } from "@/server/env";
import { rateLimit } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Progress is re-derived from a pet-day of the event log on every call.
  const limited = await rateLimit(request, { kind: "read" });
  if (limited) return limited;

  const { engine, generation } = await runtime();
  const current = await generation();
  const state = await engine.view(current);
  const database = await db();
  const view = await questView(database, current, state, env().PET_TIMEZONE, Date.now());
  const settled = await questSettled(database, current.id, view.dayIndex);

  return NextResponse.json(
    {
      dayIndex: view.dayIndex,
      quest: {
        id: view.quest.id,
        title: view.quest.title,
        description: view.quest.describe(view.target),
        unit: view.quest.unit,
      },
      current: view.current,
      target: view.target,
      settled,
      helpers: view.hands,
      handsTarget: view.handsTarget,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
