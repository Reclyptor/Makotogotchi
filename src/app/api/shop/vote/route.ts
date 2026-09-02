// POST /api/shop/vote — back a venue for tomorrow (SPEC §22.9). Makoto stays
// home unless the room votes it somewhere else, so this is the only way a day
// out ever happens.
//
// Votes are non-refundable, like the pools they sit beside. The wire carries
// TICKETS rather than coins because the per-day ceiling is denominated in
// tickets: the server has to clamp in that unit, and it prices them itself so
// a client cannot name its own exchange rate.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BALLOT_MAX_EXTRA_TICKETS } from "@/sim/atmosphere";
import { db } from "@/server/db/client";
import { voteForTomorrow } from "@/server/shop";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  venueId: z.string().min(1).max(64),
  tickets: z.number().int().min(1).max(BALLOT_MAX_EXTRA_TICKETS),
});

const STATUS: Record<string, number> = {
  UNKNOWN_VENUE: 400,
  NOT_IN_ROTATION: 409,
  INSUFFICIENT_COINS: 402,
  BALLOT_FULL: 409,
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  // This route spends coins, so it takes both buckets exactly as care does.
  const limited = await rateLimit(request, identity, "write");
  if (limited) return withCookie(limited);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));

  const database = await db();
  const result = await voteForTomorrow(database, identity.caretakerId, parsed.data.venueId, parsed.data.tickets);
  if (!result.ok) {
    return withCookie(NextResponse.json({ error: result.reason }, { status: STATUS[result.reason] ?? 400 }));
  }

  // The new ballot rides the room broadcast `voteForTomorrow` already sent;
  // what comes back here is only what this caretaker's own shop needs to
  // settle immediately rather than waiting on the stream.
  return withCookie(
    NextResponse.json({ ok: true, venueId: result.venueId, tickets: result.tickets, spent: result.spent, forDay: result.forDay }),
  );
}
