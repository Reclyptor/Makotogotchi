// POST /api/care — perform a care action (SPEC §9). Nothing from the client
// is trusted beyond the action name; magnitudes and resulting state are
// computed by src/sim on the server (SPEC §8.4).
//
// 429 means "you are moving too fast" (rate limit, Retry-After header).
// 409 means "the pet can't accept that right now" (game rules) — a different
// thing, and the UI says so differently.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CARE_ACTIONS } from "@/sim/tuning";
import { runtime } from "@/server/runtime";
import { key, redis } from "@/server/redis/client";
import { LIMITS, takeToken } from "@/server/ratelimit";
import { caretakerCookieHeader, clientIp, resolveCaretaker } from "@/server/http";

const bodySchema = z.object({ action: z.enum(CARE_ACTIONS) });

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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));
  }

  const { engine, generation } = await runtime();
  const outcome = await engine.care(generation, parsed.data.action, identity.caretakerId);

  if (!outcome.ok) {
    return withCookie(
      NextResponse.json(
        {
          error: "not_now",
          reason: outcome.rejection.reason,
          ...(outcome.rejection.retryAtTick !== undefined ? { retryAtTick: outcome.rejection.retryAtTick } : {}),
        },
        { status: 409 },
      ),
    );
  }
  return withCookie(NextResponse.json({ applied: outcome.applied, tick: outcome.state.tick }));
}
