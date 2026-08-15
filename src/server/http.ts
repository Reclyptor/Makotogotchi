// Shared HTTP-boundary helpers for the route handlers: caretaker cookie
// resolution and client IP extraction. Kept out of the route files so every
// endpoint resolves identity and IP identically.

import type { NextRequest } from "next/server";
import { CARETAKER_COOKIE, COOKIE_MAX_AGE_SECONDS, mintCaretaker, verifyCaretaker } from "./identity";

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
