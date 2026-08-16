// GET /api/feed — the tail of the current generation's activity, so a fresh
// page load shows history instead of an empty log. Entries mirror the live
// SSE messages (same seq numbering), letting the client merge the two
// streams exactly: keep history, then accept live messages with seq greater
// than the newest historical one.

import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { events } from "@/server/db/collections";
import { runtime } from "@/server/runtime";
import { anonymousName, nicknameMap } from "@/server/social";

export const dynamic = "force-dynamic";

const LIMIT = 50;

export type FeedEntryPayload = {
  seq: number;
  tick: number;
  at: string;
  type: "care" | "milestone";
  action?: string;
  caretakerId?: string;
  caretakerName?: string;
  applied?: number;
  kind?: string;
  detail?: string;
};

export async function GET(): Promise<NextResponse> {
  const { generation } = await runtime();
  const current = await generation();
  const database = await db();

  const docs = await events(database)
    .find({ generationId: current.id, type: { $in: ["CARE", "MILESTONE"] } })
    .sort({ seq: -1 })
    .limit(LIMIT)
    .toArray();
  docs.reverse(); // oldest first — the order a log reads in

  const careIds = [...new Set(docs.flatMap((doc) => (doc.type === "CARE" ? [doc.caretakerId] : [])))];
  const names = await nicknameMap(database, careIds);

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
    return [];
  });

  return NextResponse.json(
    { generationName: current.name, entries },
    { headers: { "Cache-Control": "no-store" } },
  );
}
