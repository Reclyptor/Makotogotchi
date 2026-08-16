// The generation lifecycle (SPEC §2.10), driven by the leader's tick:
//
//   death → seal (memorial ranking, survival tenure) → 2h mourning
//   → next egg → naming vote → hatch
//
// Every step is idempotent and guarded by a durable Mongo condition, so a
// leader crash or handover mid-transition simply retries next tick.

import type { Db } from "mongodb";
import type { Generation, PetState } from "@/sim/model";
import { INCUBATION_TICKS, MOURNING_TICKS } from "@/sim/tuning";
import { generations, isDuplicateKeyError } from "../db/collections";
import { createGeneration } from "../db/repository";
import { generationRanking, incrementGenerationsSurvived } from "../social";
import { resolveWinner } from "../votes";
import type { PetEngine } from "./engine";

export class Lifecycle {
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    private readonly engine: PetEngine,
    now?: () => number, // test seam; defaults to Date.now
  ) {
    this.now = now ?? Date.now;
  }

  /**
   * Inspect post-tick state; returns the successor generation if one was
   * born, so the caller can swap its cached pointer immediately.
   */
  async check(generation: Generation, state: PetState): Promise<Generation | null> {
    if (state.diedAtTick !== null) {
      await this.sealOnce(generation.id);
      if (state.tick >= state.diedAtTick + MOURNING_TICKS) {
        return this.rotate(generation);
      }
      return null;
    }

    if (state.bornAtTick === null && state.tick >= INCUBATION_TICKS) {
      const winner = await resolveWinner(this.db, generation.id);
      if (winner) {
        await this.engine.hatch(generation, winner);
      }
      // No proposals: the egg waits — incubation extends (SPEC §2.10).
    }
    return null;
  }

  /** Seal exactly once across restarts: the guard is the memorial field. */
  private async sealOnce(generationId: string): Promise<void> {
    const claimed = await generations(this.db).findOneAndUpdate(
      { _id: generationId, memorial: null, died: { $ne: null } },
      { $set: { memorial: { sealedAt: new Date(), ranking: [] } } },
    );
    if (!claimed) return; // already sealed, or death not yet recorded
    const ranking = await generationRanking(this.db, generationId);
    await generations(this.db).updateOne({ _id: generationId }, { $set: { "memorial.ranking": ranking } });
    await incrementGenerationsSurvived(this.db, generationId);
  }

  /** Lay the next egg. Guarded by ordinal uniqueness against double-rotation. */
  private async rotate(previous: Generation): Promise<Generation | null> {
    const successor = await generations(this.db).findOne({ ordinal: previous.ordinal + 1 });
    if (successor) {
      return {
        id: successor._id,
        ordinal: successor.ordinal,
        seed: successor.seed,
        genesisEpochMs: successor.genesisEpochMs,
        name: successor.name,
      };
    }
    const generation: Generation = {
      id: `gen-${crypto.randomUUID()}`,
      ordinal: previous.ordinal + 1,
      seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
      genesisEpochMs: this.now(),
      name: null,
    };
    try {
      await createGeneration(this.db, generation);
    } catch (error) {
      // Unique ordinal index: another leader won the race — adopt theirs.
      if (isDuplicateKeyError(error)) return this.rotate(previous);
      throw error;
    }
    return generation;
  }
}
