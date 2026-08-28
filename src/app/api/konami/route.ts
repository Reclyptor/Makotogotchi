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

import { NextResponse, type NextRequest } from "next/server";
import { runtime } from "@/server/runtime";
import { key, redis } from "@/server/redis/client";
import { LIMITS, takeToken } from "@/server/ratelimit";
import { caretakerCookieHeader, clientIp, resolveCaretaker } from "@/server/http";
import { shouldBroadcastSpectacle } from "@/server/secret";
import { spectacleMood } from "@/sim/secret";
import type { EngineMessage } from "@/server/engine/messages";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  const ipBucket = await takeToken(redis(), key(`rl:ip:${clientIp(request)}`), LIMITS.perIp.capacity, LIMITS.perIp.refillPerSecond);
  if (!ipBucket.allowed) {
    return withCookie(
      NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(ipBucket.retryAfterSeconds) } }),
    );
  }
  const caretakerBucket = await takeToken(
    redis(),
    key(`rl:ct:${identity.caretakerId}`),
    LIMITS.perCaretaker.capacity,
    LIMITS.perCaretaker.refillPerSecond,
  );
  if (!caretakerBucket.allowed) {
    return withCookie(
      NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(caretakerBucket.retryAfterSeconds) } },
      ),
    );
  }

  const { engine, generation } = await runtime();
  const mood = spectacleMood(await engine.view(await generation()));

  // Losing the guard is not an error (SPEC §26.2). The finder still gets
  // their spectacle — locally — and is never told they were second; a 429
  // here would punish someone for finding an easter egg a minute late, and
  // they have no way of knowing the room already had one.
  if (!(await shouldBroadcastSpectacle(redis(), key("konami:guard")))) {
    return withCookie(NextResponse.json({ broadcast: false, mood }));
  }

  const message: EngineMessage = { type: "secret", mood };
  await redis().publish(key("events"), JSON.stringify(message));
  return withCookie(NextResponse.json({ broadcast: true, mood }));
}
