// Device linking (SPEC §8.1) against real Mongo and Redis: only the named
// mint, a code is six unambiguous characters that expire, and claiming it
// works exactly once however it is typed.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis, key, redis } from "./redis/client";
import { claimLinkCode, LINK_ALPHABET, LINK_CODE_LENGTH, LINK_CODE_TTL_SECONDS, mintLinkCode, normalizeLinkCode } from "./link";
import { setNickname } from "./social";
import { startTestInfra, type TestInfra } from "./testsetup";

let infra: TestInfra;

beforeAll(async () => {
  infra = startTestInfra();
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("minting a link code", () => {
  it("refuses an anonymous caretaker", async () => {
    expect(await mintLinkCode(await db(), "link-anon")).toEqual({ ok: false, reason: "UNNAMED" });
  });

  it("hands a named caretaker a short, unambiguous, expiring code", async () => {
    const database = await db();
    await setNickname(database, "link-ana", "LinkAna");
    const minted = await mintLinkCode(database, "link-ana");
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.code).toHaveLength(LINK_CODE_LENGTH);
    for (const char of minted.code) expect(LINK_ALPHABET).toContain(char);
    expect(minted.expiresInSeconds).toBe(LINK_CODE_TTL_SECONDS);
    const ttl = await redis().ttl(key(`link:${minted.code}`));
    expect(ttl).toBeGreaterThan(LINK_CODE_TTL_SECONDS - 30);
    expect(ttl).toBeLessThanOrEqual(LINK_CODE_TTL_SECONDS);
  });
});

describe("claiming a link code", () => {
  it("returns the caretaker once, however the code was typed, then never again", async () => {
    const database = await db();
    await setNickname(database, "link-bo", "LinkBo");
    const minted = await mintLinkCode(database, "link-bo");
    if (!minted.ok) throw new Error("mint failed");
    const typed = ` ${minted.code.slice(0, 3).toLowerCase()}-${minted.code.slice(3)} `;
    expect(await claimLinkCode(typed)).toBe("link-bo");
    expect(await claimLinkCode(minted.code)).toBeNull();
  });

  it("returns nothing for a code that never existed or could not be one", async () => {
    expect(await claimLinkCode("ZZZZZZ")).toBeNull();
    expect(await claimLinkCode("")).toBeNull();
    expect(await claimLinkCode("O0O0O0")).toBeNull();
    expect(normalizeLinkCode("abc def")).toBe("ABCDEF");
    expect(normalizeLinkCode("ABCDE")).toBeNull();
    expect(normalizeLinkCode("<script")).toBeNull();
  });
});
