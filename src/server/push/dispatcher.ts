// The push dispatcher (SPEC §12): a pure state observer the leader tick
// feeds every 10 seconds. Triggers are functions of the observed state —
// never of milestone delivery — so a trigger crossed during someone else's
// care write is still noticed on the next observation.
//
// Discipline, because notification fatigue kills opt-in faster than
// anything else:
//   - each trigger fires once, then re-arms only after its value has
//     recovered past a margin and stayed there ≥ 30 minutes (hysteresis)
//   - each caretaker receives at most one push per 30 minutes
//   - stage/hatch/death triggers are once-per-generation by construction
//   - want pushes ride a separate playful lane (SPEC §25.6): they fire only
//     into an empty room, at most once per 4 hours per caretaker, defer to
//     any recent urgent push, and are never consulted by the urgent lane —
//     "Makoto is dying" is never followed minutes later by a snack request,
//     and a snack request can never starve a health alert.

import type { Db } from "mongodb";
import type Redis from "ioredis";
import { stageAt, type PetState, type WantOpen } from "@/sim/model";
import { CRITICAL_THRESHOLD, FADING_THRESHOLD, HEALTH_MAX, NEED_KEYS, STAGE_STARTS, type NeedKey } from "@/sim/tuning";
import { WANT_PUSH_THROTTLE_MS } from "@/sim/wants";
import { foodItem } from "@/sim/economy";
import { isMinigameId, MINIGAMES } from "@/sim/minigames";
import { listPresence } from "../presence";
import { allSubscriptions, deleteSubscription, type PushSubscriptionDoc } from "./store";

const HEALTH_LOW_THRESHOLD = HEALTH_MAX / 4; // 25%
const NEED_REARM_MARGIN = 50_000; // needs: recover 5% past the threshold...
const HEALTH_REARM_MARGIN = HEALTH_MAX / 20; // health: 5% in its own units...
const REARM_HOLD_MS = 30 * 60 * 1000; // ...held this long, before re-arming
const CARETAKER_THROTTLE_MS = 30 * 60 * 1000;
// Generations are mortal within ~a month (SPEC §2.3); expire trigger state
// well past that so keys never accumulate forever.
const FIRED_KEY_TTL_SECONDS = 60 * 24 * 60 * 60;

export type PushPayload = { title: string; body: string; tag: string };

/** Sends one payload to one endpoint; throws { statusCode } on failure. */
export type PushSender = (subscription: PushSubscriptionDoc, payload: PushPayload) => Promise<void>;

export class PushDispatcher {
  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly key: (name: string) => string,
    private readonly send: PushSender,
    private readonly now: () => number = Date.now,
  ) {}

  /** Observe the authoritative state; fire whatever the rules say is due. */
  async observe(state: PetState): Promise<void> {
    const name = state.generation.name ?? "The egg";
    const generationId = state.generation.id;

    if (state.bornAtTick === null) return; // nothing to alert on yet

    // "Recent" gates one-shot milestones: a dispatcher first observing a
    // pet that hatched days ago (fresh deploy, push newly configured) must
    // mark the trigger consumed WITHOUT notifying anyone retroactively.
    const RECENT_TICKS = 60; // 10 minutes

    await this.oncePerGeneration(generationId, "hatched", state.tick - state.bornAtTick <= RECENT_TICKS, {
      title: `${name} hatched! 🐣`,
      body: "A new chinchilla needs caretakers.",
      tag: "hatched",
    });

    if (state.diedAtTick !== null) {
      await this.oncePerGeneration(generationId, "died", state.tick - state.diedAtTick <= RECENT_TICKS, {
        title: `${name} has died 🪦`,
        body: "Visit the memorial. A new egg will appear soon.",
        tag: "died",
      });
      return; // no other alert matters now
    }

    const stage = stageAt(state.bornAtTick, state.tick);
    if (stage !== "HATCHLING") {
      const stageStart = STAGE_STARTS.find((entry) => entry.stage === stage)?.atTick ?? 0;
      const sinceStage = state.tick - state.bornAtTick - stageStart;
      await this.oncePerGeneration(generationId, `evolved:${stage}`, sinceStage <= RECENT_TICKS, {
        title: `${name} evolved! ✨`,
        body: `${name} is now ${stage.toLowerCase()}${state.form ? ` (${state.form.toLowerCase()})` : ""}.`,
        tag: "evolved",
      });
    }

    if (state.sick) {
      await this.hysteresisTrigger(generationId, "sick", {
        title: `${name} is sick! 🌡️`,
        body: "Untreated sickness is fatal within a day. Someone bring medicine.",
        tag: "sick",
      });
    } else {
      await this.observeRecovery(generationId, "sick");
    }

    for (const need of NEED_KEYS) {
      const value = state.needs[need];
      if (value < CRITICAL_THRESHOLD) {
        await this.hysteresisTrigger(generationId, `critical:${need}`, {
          title: `${name} needs help! ⚠️`,
          body: `${needLabel(need)} is critically low.`,
          tag: `critical-${need}`,
        });
      } else if (value >= CRITICAL_THRESHOLD + NEED_REARM_MARGIN) {
        await this.observeRecovery(generationId, `critical:${need}`);
      }
    }

    // An elder in its twilight (SPEC §2.10): fading is reversible, and this
    // is the alert that says so while there is still time.
    if (stage === "ELDER" && state.healthRaw < FADING_THRESHOLD) {
      await this.hysteresisTrigger(generationId, "fading", {
        title: `${name} is fading 🍂`,
        body: "Old age is catching up. Keeping every need high brings health back.",
        tag: "fading",
      });
    } else if (state.healthRaw >= FADING_THRESHOLD + HEALTH_REARM_MARGIN) {
      await this.observeRecovery(generationId, "fading");
    }

    if (state.healthRaw < HEALTH_LOW_THRESHOLD) {
      await this.hysteresisTrigger(generationId, "health", {
        title: `${name} is dying ❤️‍🩹`,
        body: "Health is below 25%. It needs everyone, now.",
        tag: "health",
      });
    } else if (state.healthRaw >= HEALTH_LOW_THRESHOLD + HEALTH_REARM_MARGIN) {
      await this.observeRecovery(generationId, "health");
    }

    // The pet is asking for something and nobody is around to hear it
    // (SPEC §25.6). The open want is read straight off the state; presence
    // is checked BEFORE the once-key is claimed, so a room that empties
    // mid-window still gets its nudge.
    const want = state.wantOpen;
    if (want != null) {
      const watching = await listPresence(this.redis, this.key("presence"));
      if (watching.length === 0) {
        const claimed = await this.redis.set(
          this.firedKey(generationId, `want:${want.window}`),
          "1",
          "EX",
          FIRED_KEY_TTL_SECONDS,
          "NX",
        );
        if (claimed === "OK") await this.broadcast(wantPayload(name, want), "playful");
      }
    }
  }

  private firedKey(generationId: string, trigger: string): string {
    return this.key(`push:fired:${generationId}:${trigger}`);
  }

  private async oncePerGeneration(
    generationId: string,
    trigger: string,
    recent: boolean,
    payload: PushPayload,
  ): Promise<void> {
    const claimed = await this.redis.set(this.firedKey(generationId, trigger), "1", "EX", FIRED_KEY_TTL_SECONDS, "NX");
    if (claimed === "OK" && recent) await this.broadcast(payload);
  }

  /**
   * Fire when the condition holds and the trigger is armed. Any observation
   * of the condition also cancels an in-progress recovery streak — that is
   * the hysteresis: oscillation around the boundary cannot re-notify.
   */
  private async hysteresisTrigger(generationId: string, trigger: string, payload: PushPayload): Promise<void> {
    await this.redis.del(this.key(`push:recovery:${generationId}:${trigger}`));
    const claimed = await this.redis.set(this.firedKey(generationId, trigger), "1", "EX", FIRED_KEY_TTL_SECONDS, "NX");
    if (claimed === "OK") await this.broadcast(payload);
  }

  /** Track recovery; once held long enough, the trigger re-arms. */
  private async observeRecovery(generationId: string, trigger: string): Promise<void> {
    const firedKey = this.firedKey(generationId, trigger);
    if (!(await this.redis.exists(firedKey))) return;
    const recoveryKey = this.key(`push:recovery:${generationId}:${trigger}`);
    const startedAt = await this.redis.get(recoveryKey);
    if (!startedAt) {
      await this.redis.set(recoveryKey, String(this.now()));
      return;
    }
    if (this.now() - Number(startedAt) >= REARM_HOLD_MS) {
      await this.redis.del(firedKey);
      await this.redis.del(recoveryKey);
    }
  }

  /** Send to every subscriber, respecting the lane's per-caretaker throttle. */
  private async broadcast(payload: PushPayload, lane: "urgent" | "playful" = "urgent"): Promise<void> {
    const subscriptions = await allSubscriptions(this.db);
    for (const subscription of subscriptions) {
      // Timestamp comparison against the injected clock (not a Redis TTL):
      // the dispatcher's whole notion of time must come from one source.
      const urgentKey = this.key(`push:throttle:${subscription.caretakerId}`);
      const lastUrgent = await this.redis.get(urgentKey);
      const urgentRecently = lastUrgent !== null && this.now() - Number(lastUrgent) < CARETAKER_THROTTLE_MS;
      if (lane === "urgent") {
        if (urgentRecently) continue;
        await this.redis.set(urgentKey, String(this.now()), "EX", 24 * 60 * 60);
      } else {
        // Playful consults urgent recency but never consumes the urgent
        // key, and urgent never reads the playful one (SPEC §25.6).
        if (urgentRecently) continue;
        const playfulKey = this.key(`push:playful:${subscription.caretakerId}`);
        const lastPlayful = await this.redis.get(playfulKey);
        if (lastPlayful !== null && this.now() - Number(lastPlayful) < WANT_PUSH_THROTTLE_MS) continue;
        await this.redis.set(playfulKey, String(this.now()), "EX", 24 * 60 * 60);
      }
      try {
        await this.send(subscription, payload);
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await deleteSubscription(this.db, subscription.endpoint);
        }
        // Other failures: the endpoint may recover; try again next trigger.
      }
    }
  }
}

export const needLabel = (need: NeedKey): string => need[0]!.toUpperCase() + need.slice(1);

/** What the pet is asking for, in one push-sized sentence (SPEC §25.6). */
const wantPayload = (name: string, want: WantOpen): PushPayload => {
  let ask: string;
  switch (want.kind) {
    case "crave-food":
      ask = `${name} is craving ${(want.itemId !== undefined ? foodItem(want.itemId)?.label : undefined) ?? "a treat"}!`;
      break;
    case "play-game":
      ask = `${name} wants to play ${want.itemId !== undefined && isMinigameId(want.itemId) ? MINIGAMES[want.itemId].title : "a game"}!`;
      break;
    case "cuddle":
      ask = `${name} wants cuddles.`;
      break;
    case "dust-bath":
      ask = `${name} wants a dust bath.`;
      break;
    default:
      // A kind this build does not know — an older pod during a rolling
      // deploy. Still worth the nudge.
      ask = `${name} wants something.`;
  }
  return { title: `${name} wants something 💭`, body: `${ask} Nobody's around right now.`, tag: "want" };
};
