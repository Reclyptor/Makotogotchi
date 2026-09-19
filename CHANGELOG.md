# Changelog

Notable changes to Makotogotchi. Format follows [Keep a Changelog]; versions
follow [Semantic Versioning]. Pre-1.0, so game-rule changes are minor bumps.

[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html

## [0.2.0] — 2026-09-18

Balance and clarity pass, driven by player reports. Every event log written
before this release folds byte-identically (SPEC §23.2).

### Added

- Wake countdown on a sleeping pet — "Wakes in 3h 20m", a duration, not a
  Chicago clock time (`d53fe5d`)
- Per-caretaker weekly allowance shown under the meters (`2197574`)
- Care tiles warn "Spent" or "Not needed" *before* the press (`2197574`)
- `zeroApplyReason` and `allowanceRemaining` — pure, read-only budget views
  (`2197574`)
- `AWAKE_HOURS` / `ASLEEP_HOURS` / `HOUR_BEFORE_SLEEP`, wrap-aware (`7a87025`)

### Changed

- **Night is 00:00–06:00**, down from 22:00–07:00 — three more waking hours
  for care to land in (`7a87025`)
- **Care multiplier counts presence, not attendance** — one visit is 1/7 of a
  caretaker, not a full week (`d969e57`)
- **Caretaker allowance scales with the multiplier** — holds the design's
  1.75-caretaker ratio at every community size (`7dba51c`)
- Difficulty table interpolates between whole caretakers, in integers
  (`d969e57`)
- Toys are funded communally, not bought outright; pools are per generation
  (`0e91d9c`)
- Pool offers collapse to "Finish it" when you can cover the remainder
  (`0e91d9c`)
- Energy Drink: 25% → 30%, ends a daytime sleep outright, works on lullaby
  sleep (`6c170c9`)
- Device-link entry point states the benefit — one name, one score, one streak
  (`7b7ee3b`)
- `maxDurationMs` → `sessionLifetimeMs`; it bounds the session, not the result
  (`354e48e`)

### Fixed

- **Energy no longer scales with the crowd.** Past ~2.65× a waking day cost
  more energy than the pet can hold, forcing naps that locked out `FEED`,
  `PLAY` and `CLEAN` — the multiplier spent its own caretakers' care windows
  (`8102ec5`)
- **Minigames no longer judge run length.** Only perfect runs were long enough
  to trip it, so it flagged flawless play and little else (`354e48e`)
- **Energy drink was a no-op.** Its bonus was exactly the gap between the nap
  line and the wake line (`6c170c9`)
- **"Makoto wants someone else's attention"** claimed a spent allowance when
  the need was simply full (`2197574`)
- Consumables are handed back when the action moves nothing — judged on the
  pet changing, not on `applied === 0` (`e91133f`)
- Care that restores nothing no longer pays the one-coin floor (`11134bc`)
- `scheduleFor` derived the opening phase from visit order, not chronology —
  latent until a night crossed midnight, which would have reported the pet
  asleep all morning (`7a87025`)
- `AWAKE_TICKS_PER_DAY` was hardcoded to 15h; any bedtime change would have
  desynced every allowance from real decay (`7a87025`)
- Sky segments and the quest evening check read `SLEEP_HOUR - 1`, which is −1
  at midnight (`7a87025`)

### Internal

- One Mongo and one Redis per test run instead of per file; isolation by
  `MONGODB_DB` + `REDIS_PREFIX`. Full suite: ~3.4s parallel, no flake, no
  leaked containers (`2245a9c`)
- `diminishedMagnitude` and `MAGNITUDE_ACTIONS` moved to `tuning.ts`
  (`2197574`)
- Property tests pin the budget below a week of decay, and the allowance ratio
  across the multiplier's range (`7dba51c`)

## [0.1.0]

- Initial release.
