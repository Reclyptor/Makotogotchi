// The spectated minigame (SPEC §13.3). One run at a time — the spectacle is
// the point. The client plays locally and reports; the server validates a
// per-game plausibility envelope rather than simulating the game: real
// elapsed time, a hard score rate, and an input floor per point. The result
// feeds PLAY through the ordinary care path with a performance multiplier.
// Which game is being played is fixed at start and stored server-side, so a
// client cannot start a cheap envelope and finish an expensive one.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { key, redis } from "@/server/redis/client";
import { runtime } from "@/server/runtime";
import { canPerform } from "@/sim/validate";
import { MINIGAME_IDS, MINIGAMES, plausibleRun, type MinigameId } from "@/sim/minigames";
import { anonymousName, creditCoins, nicknameMap, recordContribution } from "@/server/social";
import { caretakerCookieHeader, resolveCaretaker } from "@/server/http";
import type { EngineMessage } from "@/server/engine/messages";

export const dynamic = "force-dynamic";

const SESSION_KEY = "minigame";
const SESSION_SLACK_MS = 15_000;

const bodySchema = z.union([
  z.object({ phase: z.literal("start"), game: z.enum(MINIGAME_IDS) }),
  z.object({ phase: z.literal("score"), score: z.number().int().min(0).max(200) }),
  z.object({ phase: z.literal("finish"), score: z.number().int().min(0).max(200), inputs: z.number().int().min(0).max(2000) }),
]);

type Session = { caretakerId: string; startedAtMs: number; game: MinigameId };

const publish = async (message: EngineMessage): Promise<void> => {
  await redis().publish(key("events"), JSON.stringify(message));
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));

  const { engine, generation } = await runtime();
  const current = await generation();
  const sessionKey = key(SESSION_KEY);
  const caretakerName = async (): Promise<string> => {
    const names = await nicknameMap(await db(), [identity.caretakerId]);
    return names.get(identity.caretakerId) ?? anonymousName(identity.caretakerId);
  };

  if (parsed.data.phase === "start") {
    const state = await engine.view(current);
    const verdict = canPerform(state, "PLAY", identity.caretakerId, { schedule: { initialPhase: "WAKE", boundaries: [] } });
    // The schedule shortcut is safe: PLAY's gates are sleep state and
    // energy, both read from state, not from the context.
    if (!verdict.ok) {
      return withCookie(NextResponse.json({ error: "not_now", reason: verdict.reason }, { status: 409 }));
    }
    const game = MINIGAMES[parsed.data.game];
    const session: Session = { caretakerId: identity.caretakerId, startedAtMs: Date.now(), game: game.id };
    const claimed = await redis().set(sessionKey, JSON.stringify(session), "PX", game.maxDurationMs + SESSION_SLACK_MS, "NX");
    if (claimed !== "OK") {
      // A duplicate start from the same caretaker for the same game (a
      // remount, a retried request) rejoins its own fresh session instead
      // of reading as "someone else is playing".
      const raw = await redis().get(sessionKey);
      const existing = raw ? (JSON.parse(raw) as Session) : null;
      if (existing && existing.caretakerId === identity.caretakerId && existing.game === game.id) {
        return withCookie(NextResponse.json({ ok: true }));
      }
      return withCookie(NextResponse.json({ error: "busy", reason: "GAME_IN_PROGRESS" }, { status: 409 }));
    }
    await publish({
      type: "minigame",
      phase: "start",
      caretakerId: identity.caretakerId,
      caretakerName: await caretakerName(),
      game: game.id,
    });
    return withCookie(NextResponse.json({ ok: true }));
  }

  // Ends the spectacle for everyone — sent on EVERY finish path, success or
  // not: a rejected result must still take the "is playing" banner down.
  const raw = await redis().get(sessionKey);
  const session = raw ? (JSON.parse(raw) as Session) : null;
  const sessionGame = session ? MINIGAMES[session.game] : null;

  const endSpectacle = async (score?: number, applied?: number): Promise<void> => {
    await publish({
      type: "minigame",
      phase: "finish",
      caretakerId: identity.caretakerId,
      caretakerName: await caretakerName(),
      ...(sessionGame ? { game: sessionGame.id } : {}),
      ...(score !== undefined ? { score } : {}),
      ...(applied !== undefined ? { applied } : {}),
    });
  };

  if (!session || !sessionGame || session.caretakerId !== identity.caretakerId) {
    if (parsed.data.phase === "finish") await endSpectacle();
    return withCookie(NextResponse.json({ error: "no_session" }, { status: 409 }));
  }

  if (parsed.data.phase === "score") {
    // At most one broadcast per 2s.
    const guard = await redis().set(key("minigame-score-guard"), "1", "PX", 2000, "NX");
    if (guard === "OK") {
      await publish({
        type: "minigame",
        phase: "score",
        caretakerId: identity.caretakerId,
        game: sessionGame.id,
        score: parsed.data.score,
      });
    }
    return withCookie(NextResponse.json({ ok: true }));
  }

  // finish — validate the game's envelope, then run PLAY with the earned
  // multiplier.
  await redis().del(sessionKey);
  const elapsedMs = Date.now() - session.startedAtMs;
  const { score, inputs } = parsed.data;
  if (!plausibleRun(sessionGame, elapsedMs, score, inputs)) {
    await endSpectacle();
    return withCookie(NextResponse.json({ error: "implausible" }, { status: 422 }));
  }

  const outcome = await engine.care(current, "PLAY", identity.caretakerId, { performance: sessionGame.performance(score) });
  if (!outcome.ok) {
    await endSpectacle();
    return withCookie(NextResponse.json({ error: "not_now", reason: outcome.rejection.reason }, { status: 409 }));
  }

  const coins = sessionGame.coins(score);
  const ledger = await recordContribution(await db(), {
    caretakerId: identity.caretakerId,
    generationId: current.id,
    action: "PLAY",
    applied: outcome.applied,
    tick: outcome.state.tick,
  });
  await creditCoins(await db(), identity.caretakerId, coins);
  await endSpectacle(score, outcome.applied);
  return withCookie(NextResponse.json({ applied: outcome.applied, coins: ledger.coins + coins, score }));
}
