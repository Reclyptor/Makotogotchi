// GET /api/feed — the tail of the current generation's activity, so a fresh
// page load shows history instead of an empty log. Entries mirror the live
// SSE messages (same seq numbering), letting the client merge the two
// streams exactly: keep history, then accept live messages with seq greater
// than the newest historical one.

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { events } from "@/server/db/collections";
import { runtime } from "@/server/runtime";
import { anonymousName, nicknameMap } from "@/server/social";
import { rateLimit } from "@/server/http";

export const dynamic = "force-dynamic";

const LIMIT = 50;

export type FeedEntryPayload = {
  seq: number;
  tick: number;
  at: string;
  type: "care" | "milestone" | "want";
  action?: string;
  caretakerId?: string;
  caretakerName?: string;
  applied?: number;
  kind?: string;
  detail?: string;
  /** Want entries (SPEC §25.7). */
  edge?: "opened" | "expired";
  wantKind?: string;
  wantItemId?: string;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  // One indexed tail query plus a nickname lookup, on every page load.
  const limited = await rateLimit(request, { kind: "read" });
  if (limited) return limited;

  const { generation } = await runtime();
  const current = await generation();
  const database = await db();

  const docs = await events(database)
    .find({ generationId: current.id, type: { $in: ["CARE", "MILESTONE", "WANT_OPENED", "WANT_EXPIRED"] } })
    .sort({ seq: -1 })
    .limit(LIMIT)
    .toArray();
  docs.reverse(); // oldest first — the order a log reads in

  const careIds = [...new Set(docs.flatMap((doc) => (doc.type === "CARE" ? [doc.caretakerId] : [])))];
  const names = await nicknameMap(database, careIds);

  // The expiry event does not carry what lapsed; its opening, when it is
  // still inside the tail, does (SPEC §25.7).
  const openedWants = new Map(
    docs.flatMap((doc) => (doc.type === "WANT_OPENED" ? [[doc.windowIndex, doc.want] as const] : [])),
  );

  const entries: FeedEntryPayload[] = docs.flatMap((doc): FeedEntryPayload[] => {
    if (doc.type === "CARE") {
      return [
        {
          seq: doc.seq,
          tick: doc.tick,
          at: doc.at.toISOString(),
          type: "care" as const,
          action: doc.action,
          caretakerId: doc.caretakerId,
          caretakerName: names.get(doc.caretakerId) ?? anonymousName(doc.caretakerId),
          applied: doc.applied ?? 0,
        },
      ];
    }
    if (doc.type === "MILESTONE") {
      return [
        {
          seq: doc.seq,
          tick: doc.tick,
          at: doc.at.toISOString(),
          type: "milestone" as const,
          kind: doc.kind,
          ...(doc.detail !== undefined ? { detail: doc.detail } : {}),
        },
      ];
    }
    if (doc.type === "WANT_OPENED" || doc.type === "WANT_EXPIRED") {
      const want = doc.type === "WANT_OPENED" ? doc.want : openedWants.get(doc.windowIndex);
      return [
        {
          seq: doc.seq,
          tick: doc.tick,
          at: doc.at.toISOString(),
          type: "want" as const,
          edge: doc.type === "WANT_OPENED" ? ("opened" as const) : ("expired" as const),
          ...(want !== undefined ? { wantKind: want.kind } : {}),
          ...(want?.itemId !== undefined ? { wantItemId: want.itemId } : {}),
        },
      ];
    }
    return [];
  });

  return NextResponse.json(
    { generationName: current.name, entries },
    { headers: { "Cache-Control": "no-store" } },
  );
}
