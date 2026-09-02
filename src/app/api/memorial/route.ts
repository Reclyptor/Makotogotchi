// GET /api/memorial — the wall of past generations (SPEC §2.10).

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { generations } from "@/server/db/collections";
import { TICKS_PER_DAY } from "@/sim/tuning";
import { rateLimit } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Scans the generations collection for every pet that has ever died.
  const limited = await rateLimit(request, { kind: "read" });
  if (limited) return limited;

  const docs = await generations(await db())
    .find({ died: { $ne: null } })
    .sort({ ordinal: -1 })
    .limit(100)
    .toArray();
  const entries = docs.map((doc) => ({
    ordinal: doc.ordinal,
    name: doc.name,
    cause: doc.died!.cause,
    diedAt: doc.died!.at,
    lifespanDays:
      doc.hatchedAtTick !== null ? Math.round(((doc.died!.tick - doc.hatchedAtTick) / TICKS_PER_DAY) * 10) / 10 : 0,
    ranking: doc.memorial?.ranking ?? [],
    quirks: doc.memorial?.quirks ?? null,
  }));
  return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
}
