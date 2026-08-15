// The golden replay (SPEC §16.3): a fixed event log with a fixed seed folds
// to a byte-identical state, checked against a committed fixture. Any
// unintended change to game rules — decay rates, curve shapes, RNG stream,
// fold order — breaks this loudly. If it broke because the rules changed ON
// PURPOSE, regenerate with `vitest run -u` and review the fixture diff like
// code.

import { describe, expect, it } from "vitest";
import { draw32 } from "./rng";
import { project } from "./project";
import { EventLog, QUIET_SEED, replay, testCtx, withSeed } from "./testkit";
import { TICKS_PER_DAY } from "./tuning";

const ctx = testCtx();

describe("golden replay", () => {
  it("the reference generation folds to the committed fixture", async () => {
    // A full arc on the sickness-quiet seed: hatch, a week of two-caretaker
    // care (through the JUVENILE window into the ADULT form decision), then
    // abandonment until starvation. Curated once; never edited casually.
    // Four care sessions a day from two caretakers — roughly the volume the
    // decay rates actually demand (SPEC §2.5: sustaining the pet takes more
    // than one person's budget). Checkup MEDICATEs bound any sickness to a
    // treated window; the LULLABY closes each evening.
    const log = new EventLog();
    log.hatched(180, "Makoto");
    for (let day = 0; day < 7; day++) {
      const at = (tick: number) => day * TICKS_PER_DAY + tick;
      log.care(at(400), "FEED", "emilio");
      log.care(at(420), "CLEAN", "emilio");
      log.care(at(440), "PLAY", "ana");
      log.care(at(460), "MEDICATE", "ana");
      log.care(at(2000), "FEED", "ana");
      log.care(at(2020), "PLAY", "emilio");
      log.care(at(2040), "PET", "ana");
      log.care(at(3600), "FEED", "emilio");
      log.care(at(3620), "CLEAN", "ana");
      log.care(at(3640), "PLAY", "ana");
      log.care(at(5200), "FEED", "ana");
      log.care(at(5220), "PLAY", "emilio");
      log.care(at(5240), "MEDICATE", "emilio");
      log.care(at(5260), "LULLABY", "ana");
    }
    const afterCare = replay(log.events, ctx, withSeed(QUIET_SEED));
    await expect(JSON.stringify(afterCare, null, 2)).toMatchFileSnapshot("./__fixtures__/golden-week.json");

    const { state: final } = project(afterCare, 12 * TICKS_PER_DAY, ctx);
    await expect(JSON.stringify(final, null, 2)).toMatchFileSnapshot("./__fixtures__/golden-death.json");
  });

  it("the RNG stream is frozen — known answers never change", () => {
    // If these values move, every generation's sickness history changes.
    expect(draw32(0xc0ffee, 0, 1)).toMatchInlineSnapshot(`2628792717`);
    expect(draw32(0xc0ffee, 8640, 1)).toMatchInlineSnapshot(`2256023281`);
    expect(draw32(1337, 123456, 1)).toMatchInlineSnapshot(`1563852408`);
  });
});
