// Anonymous caretaker identity (SPEC §8.1): an HttpOnly cookie carrying
// `<id>.<HMAC-SHA256(id, secret)>`. No login, no PII — the HMAC only makes
// the id unforgeable, so cooldowns, budgets, streaks, and leaderboard totals
// cannot be spoofed by editing a cookie.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export const CARETAKER_COOKIE = "mgc_ct";
export const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const sign = (caretakerId: string): string =>
  createHmac("sha256", env().CARETAKER_SECRET).update(caretakerId).digest("base64url");

export const mintCaretaker = (): { caretakerId: string; cookieValue: string } => {
  const caretakerId = randomUUID();
  return { caretakerId, cookieValue: `${caretakerId}.${sign(caretakerId)}` };
};

export const verifyCaretaker = (cookieValue: string | undefined): string | null => {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const caretakerId = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  const expected = sign(caretakerId);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return caretakerId;
};
