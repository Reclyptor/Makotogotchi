// POST /api/konami — someone entered the ancient code (SPEC §26.2).
//
// Pure broadcast, in the shape /api/react established: nothing is written to
// Mongo, nothing is appended to the event log, and the published payload
// carries no caretaker. It therefore never replays, leaves no memorial trace,
// and cannot be attributed — which is what makes it safe for the code to leak,
// as it inevitably will.
//
// The mood is derived here rather than sent, because §8.4 holds everywhere and
// because deriving it once is what keeps every screen showing the same thing.
//
// Every call publishes. There was a room-wide guard here once — one spectacle
// per five minutes — and it is worth knowing why it is gone before adding it
// back. It did not make the event rare, it made the feature look broken: the
// loser still ran the spectacle locally, so the person typing always saw the
// sky open and nobody else ever did. That is the same thing a dead broadcast
// looks like, and it is how it was reported. It also fired constantly, because
// an easter egg spreads by one person trying it and immediately telling the
// next person to try it — both inside the window, the second one silent. The
// token buckets above are the flood bound now; the moment is material-free
// (§26.7), so a flood is noise, not an exploit.

import { NextResponse, type NextRequest } from "next/server";
import { runtime } from "@/server/runtime";
import { key, redis } from "@/server/redis/client";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";
import { spectacleMood } from "@/sim/secret";
import type { EngineMessage } from "@/server/engine/messages";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  const limited = await rateLimit(request, { kind: "write", caretakerId: identity.caretakerId });
  if (limited) return withCookie(limited);

  const { engine, generation } = await runtime();
  const mood = spectacleMood(await engine.view(await generation()));

  const message: EngineMessage = { type: "secret", mood };
  await redis().publish(key("events"), JSON.stringify(message));
  return withCookie(NextResponse.json({ mood }));
}
