// The naming vote (SPEC §2.10). GET returns the live tally; POST proposes a
// name or moves the caller's single vote. Only meaningful while the egg
// incubates — a born pet's generation rejects with 409.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { runtime } from "@/server/runtime";
import { proposeName, tallyVotes, voteForName } from "@/server/votes";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";

export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ propose: z.string().min(1).max(64) }),
  z.object({ voteFor: z.string().min(1).max(64) }),
]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  const limited = await rateLimit(request, { kind: "read" });
  if (limited) return withCookie(limited);

  const { generation } = await runtime();
  const current = await generation();
  const tally = await tallyVotes(await db(), current.id, identity.caretakerId);
  return withCookie(NextResponse.json({ tally }));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  // Proposing and voting both write, and the egg's window is exactly when
  // the room is busiest.
  const limited = await rateLimit(request, { kind: "write", caretakerId: identity.caretakerId });
  if (limited) return withCookie(limited);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));

  const { engine, generation } = await runtime();
  const current = await generation();
  const state = await engine.view(current);
  if (state.bornAtTick !== null) {
    return withCookie(NextResponse.json({ error: "already_named" }, { status: 409 }));
  }

  const database = await db();
  if ("propose" in parsed.data) {
    const result = await proposeName(database, current.id, identity.caretakerId, parsed.data.propose);
    if (!result.ok) return withCookie(NextResponse.json({ error: result.reason }, { status: 400 }));
  } else {
    const result = await voteForName(database, current.id, identity.caretakerId, parsed.data.voteFor.toLowerCase());
    if (!result.ok) return withCookie(NextResponse.json({ error: result.reason }, { status: 404 }));
  }
  const tally = await tallyVotes(database, current.id, identity.caretakerId);
  return withCookie(NextResponse.json({ tally }));
}
