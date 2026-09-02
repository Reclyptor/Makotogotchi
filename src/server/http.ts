// Shared HTTP-boundary helpers for the route handlers: caretaker cookie
// resolution, client IP extraction, and the §8.2 rate limit. Kept out of the
// route files so every endpoint resolves identity, reads the address, and
// meters traffic identically — a limit that is re-typed per route is a limit
// that is eventually forgotten on one.

import { NextResponse, type NextRequest } from "next/server";
import { CARETAKER_COOKIE, COOKIE_MAX_AGE_SECONDS, mintCaretaker, verifyCaretaker } from "./identity";
import { key, redis } from "./redis/client";
import { limits, takeToken, type TokenBucketLimit } from "./ratelimit";

export type CaretakerIdentity = {
  caretakerId: string;
  /** Present when a fresh cookie must be set on the response. */
  setCookie: string | null;
};

export const resolveCaretaker = (request: NextRequest): CaretakerIdentity => {
  const existing = verifyCaretaker(request.cookies.get(CARETAKER_COOKIE)?.value);
  if (existing) return { caretakerId: existing, setCookie: null };
  const minted = mintCaretaker();
  return { caretakerId: minted.caretakerId, setCookie: minted.cookieValue };
};

export const caretakerCookieHeader = (cookieValue: string): string =>
  `${CARETAKER_COOKIE}=${cookieValue}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;

/** Cloudflare gives the real client address; fall back for local dev. */
export const clientIp = (request: NextRequest): string =>
  request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

/**
 * What a route costs the server, which is what decides how it is metered.
 *
 * `read` answers from the stores and pays the per-address bucket alone —
 * several of these fire on a single page load, and they are shared work
 * rather than a caretaker spending an allowance.
 *
 * `write` changes something — appends to the log, moves coins, publishes to
 * every open stream — and pays the per-caretaker bucket on top, because for
 * those the interesting abuser is one identity behind many addresses as much
 * as one address behind many identities. It carries the caretaker to charge,
 * so a write scope cannot be asked for without one.
 */
export type RateLimitScope = { kind: "read" } | { kind: "write"; caretakerId: string };

/**
 * Meter the request (SPEC §8.2). Returns the 429 to send back, or null to
 * carry on; the caller attaches its own cookie exactly as it does to every
 * other response, so a caretaker minted on a refused request still keeps the
 * identity that refusal was counted against.
 */
export const rateLimit = async (request: NextRequest, scope: RateLimitScope): Promise<NextResponse | null> => {
  const budget = limits();
  const buckets: { name: string; limit: TokenBucketLimit }[] = [
    { name: `rl:ip:${clientIp(request)}`, limit: budget.perIp },
  ];
  if (scope.kind === "write") buckets.push({ name: `rl:ct:${scope.caretakerId}`, limit: budget.perCaretaker });

  for (const { name, limit } of buckets) {
    const bucket = await takeToken(redis(), key(name), limit.capacity, limit.refillPerSecond);
    if (!bucket.allowed) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(bucket.retryAfterSeconds) } },
      );
    }
  }
  return null;
};
