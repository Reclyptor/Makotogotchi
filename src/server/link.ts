// Device linking (SPEC §8.1): a named caretaker mints a short code, another
// device claims it and becomes the same caretaker. The code lives in Redis
// for ten minutes and is consumed on first use, so it is a handshake rather
// than a credential — nothing about it survives to be phished or reused.

import { randomInt } from "node:crypto";
import type { Db } from "mongodb";
import { key, redis } from "./redis/client";
import { caretakers } from "./social";

/** No 0/O, 1/I/L: a code is read off one screen and typed on another. */
export const LINK_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 6;
export const LINK_CODE_TTL_SECONDS = 10 * 60;

export type MintResult = { ok: true; code: string; expiresInSeconds: number } | { ok: false; reason: "UNNAMED" };

const codeKey = (code: string): string => key(`link:${code}`);

const randomCode = (): string => {
  let code = "";
  for (let index = 0; index < LINK_CODE_LENGTH; index++) code += LINK_ALPHABET[randomInt(LINK_ALPHABET.length)]!;
  return code;
};

/** A caller-typed code as it was minted: upper-cased, separators dropped, or null if it could not be one. */
export const normalizeLinkCode = (raw: string): string | null => {
  const code = raw.toUpperCase().replace(/[\s-]+/gu, "");
  return code.length === LINK_CODE_LENGTH && [...code].every((char) => LINK_ALPHABET.includes(char)) ? code : null;
};

/** Mint a code for `caretakerId` — a named caretaker only (SPEC §8.1). */
export const mintLinkCode = async (db: Db, caretakerId: string): Promise<MintResult> => {
  const named = await caretakers(db).countDocuments({ _id: caretakerId, nickname: { $ne: null } }, { limit: 1 });
  if (named === 0) return { ok: false, reason: "UNNAMED" };
  // NX so a colliding code — 31⁶ of them, ten minutes each — is never
  // silently handed to two people.
  for (;;) {
    const code = randomCode();
    const stored = await redis().set(codeKey(code), caretakerId, "EX", LINK_CODE_TTL_SECONDS, "NX");
    if (stored === "OK") return { ok: true, code, expiresInSeconds: LINK_CODE_TTL_SECONDS };
  }
};

/** Consume a code: the caretaker it was minted for, once, or null. */
export const claimLinkCode = async (raw: string): Promise<string | null> => {
  const code = normalizeLinkCode(raw);
  if (code === null) return null;
  const caretakerId = await redis().getdel(codeKey(code));
  return caretakerId ?? null;
};
