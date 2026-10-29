# Changelog

Notable changes to Makotogotchi. Format follows [Keep a Changelog]; versions
follow [Semantic Versioning]. Pre-1.0, so game-rule changes are minor bumps.

[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html

## [0.8.0] — 2026-10-28

An elder can grow old well. Ruleset 4 (`RULES{4}`, appended once on deploy)
adds a last stage: on day 40 an elder sits down to meditate for two days, and
rises a Sage. Every log written before it folds byte-identically, and one
under ruleset 3 or below stays an elder for good.

### Added

- **Deep meditation on day 40.** For two days needs and health hold still and
  nothing can go wrong; feeding, play, cleaning and lullabies are turned away
  with "in deep meditation", while a pat and medicine still work. The status
  line counts down to the return, and no wants open (`7c94426`)
- **The Sage**, with a white beard. Its body is gentler (decay ×1.0, not the
  elder's 1.2, and a 65% health line, 60% for FRAIL), but it is still mortal
  (`7c94426`, `7cabeed`)
- **An ascension payout of 300 coins** to every caretaker who cared for the
  elder in the 14 days before meditation began, paid once (`7c94426`,
  `d65bdf4`)
- **The wisdom bonus:** care coins are ×1.5 while the pet is a Sage, and a
  granted want pays 15 (`7c94426`)
- **The Sage's blessing:** the egg laid after a Sage dies is blessed, and its
  adult form thresholds are 10 points lower, so a thriving adult is easier to
  raise (`7c94426`)
- **The beard tucks behind props:** the cup and its steam, the controller,
  the table, the quilt, and the paws that hold them all sit in front of it
  (`cd2247d`, `9c33573`)
- **Sages on the family wall** wear their beard. The stage a pet died in is
  kept in its memorial; generations sealed before this hang as they did
  (`15e2bb5`, `9c33573`)

### Changed

- CI runs on Ubuntu 22.04, whose kernel MongoDB 8 starts on, and the test
  Mongo is pinned to the version production runs, 8.3.13 (`1436fe7`,
  `1228bdf`)
- The image build can be started by hand (`95ee68a`)

### Fixed

- A Mongo or Redis outage while a stream is open is logged rather than left
  as an unhandled rejection that could take down the server (`fe46d9b`)
- A test Mongo that fails to start says why (`39cdc13`)
- The elder's brows sit over the eye on the dust-bath frames (`7cabeed`)
- The spec says what the game does: any drink, not only the Energy Drink, is
  taken during a daytime nap or lullaby and wakes the pet

## [0.7.0] — 2026-10-16

A well-cared-for Makoto can be kept alive. Under ruleset 2 ordinary good care
lost an elder around elder day 16–21, and one eight-hour waking gap starved an
elder in a room of twenty. Ruleset 3 (`RULES{3}`, appended once on deploy)
changes two numbers; every log written before it folds byte-identically.

### Changed

- **The community multiplier stops at 2×**, not 4×, for decay, the caretaker
  allowance and the care-quest bar alike, so supply and demand stay matched.
  The night exemption stays (`0321229`)
- **The elder line stops at 75%** (70% for FRAIL), reached on ramp day 6
  (day 4 for FRAIL); it still rises 2.5 points a day from 60% (`0321229`)
- Simulated over 45 elder days, good care (and even lazy care) keeps the
  elder alive at 5, 10 and 20 caretakers, with or without a weekly 8-hour
  gap; the thinnest case, five people with a weekly gap, dips to about 24%
  health and recovers. Abandonment still kills within about a day

### Fixed

- The weekly head count is recorded whenever it changes, not only when it
  moves the multiplier, so "N named caretakers" and the many-hands quest
  stay current above the ceiling (`29a67e5`)

## [0.6.0] — 2026-10-16

Health you can read, and kinder rules around it. Every event log written
before this folds byte-identically: the new rules start only at a `RULES`
event (ruleset 2), and a log without one keeps ruleset 1. Rule changes from
here on bump the ruleset version instead of adding an event type.

### Added

- **The status line says where health is going and why.** "Health is
  falling: hunger is below 20%.", "Health is stuck: sickness stops it coming
  back.", "Health is coming back." — with "dangerously low" whenever it is
  and the headline has not said so, and no cause repeated that the headline
  already names. An elder adds a muted `needs 72% · at 81%` (today's line,
  then the average; one decimal only when the two would otherwise read the
  same), with a full sentence for screen readers (`89fa2ad`, `6b57298`,
  `9dbfa27`, `dd37d2b`, `22730b2`)
- **A quiet tick at 20% on each need bar**, the line below which health
  drains (`9749f53`)
- `healthTerms` (`src/sim/health.ts`) — the per-tick health arithmetic as one
  pure function the projection and the derived `HealthView` both read; the
  `RULES` event and `rulesVersion` (`1f66bfa`, `e121a3e`, `61d769e`)

### Changed

- **Nights no longer scale with the crowd.** From midnight to 6am needs
  decay at the two-person baseline whatever the community size; the day
  keeps §23's scaling. Ordinary nights and lifespans in big rooms improve;
  an eight-hour waking gap at 4× still kills an elder (`87fcd08`)
- **FRAIL elders' line stops at 80%**, not 85% (`87fcd08`)
- **An elder worn down by age is remembered as dying of old age**, even if
  it was sick at the end. A critical need still names its own cause. A
  sick-but-fed pet only stalls, so "died of illness" now belongs to a sick
  elder at its line. The screen orders reasons by what a caretaker can fix —
  need, sickness, age — so it points at the cure (`87fcd08`, `7623f12`)
- The §16.2 difficulty dial runs under both rulesets (`92b09e2`)

### Fixed

- **Holding down in a minigame on a phone no longer loses the run.** A long
  press started the browser's text selection (and Android's context menu),
  which cancelled the touch the game was reading as a hold. Nothing in the
  game window is selectable and the menu never opens (`8f05155`)

## [0.5.3] — 2026-10-16

### Changed

- The game components carry their current titles: `SneakyBrew`,
  `WheelRhythm`, `TeaParty` (rules in `teaPartyRules.ts`) and `NatsumiSays`.
  The roster ids stay as they are — event logs, wishes, quirks and records
  store them, and quirks pick by their order — and `MINIGAME_IDS` now says
  so, naming the title beside each renamed id. No player-visible change
  (`4e1783f`)

## [0.5.2] — 2026-10-16

### Changed

- **Don't Get Sausaged is now Natsumi Says** 🗣️. The old name described the
  fail state, not the game, which is doing what Natsumi says before she
  finishes saying it. The id is unchanged, so history and records carry over
  (`f5617ed`)

## [0.5.1] — 2026-10-16

### Changed

- **Three minigames are named for what they are.** Coffee Run is now Sneaky
  Brew (nobody runs; you brew before Natsumi walks in), Wheel Sprint is now
  Wheel Rhythm (a timing game), and Sausage Party, where no sausage ever
  appears, is now Tea Party 🫖. Titles are display-only: the ids that event
  logs, wishes, quirks and records store are unchanged, so history and
  records carry over (`8aae599`)

### Fixed

- The Bubble Pop containment property asserts once per flight instead of
  twice per sample, so it no longer times out on CI (`3c12638`)

## [0.5.0] — 2026-10-16

Old age becomes a real stake again. Every event log written before this
folds byte-identically: the new rule starts only at an `ELDER_RAMP` event,
and a log without one keeps the flat rule it was written under.

### Changed

- **An elder's hold line rises every day.** To keep its health, an elder's
  four needs must average above a line that starts at 60% and rises 2.5
  points a day to 85% (reached on elder day 10). Below the line, the age
  drain reaches full strength within 10 points instead of across the whole
  20–60% span. Skilled, near-continuous care keeps an elder alive
  indefinitely; ordinary care loses it around elder day 16–21 (`3cdd0eb`)
- **The ramp starts at an event, not at birth.** The leader appends one
  `ELDER_RAMP` per generation. A pet already elderly at release starts the
  ramp at 60% on release day; a new generation ramps from its first elder
  day. The pre-ramp line is frozen as `LEGACY_ELDER_HOLD_MEAN` so retuning
  the ramp can never re-fold old logs (`3cdd0eb`, `a0247b7`)
- The §16.2 old-age property uses a net-gain bot (PET unless PLAY gains more
  than its energy cost); the greedy bot overplays and no longer survives
  the ramp (`f031ddb`)

### Fixed

- **The About page states the health rules as they are.** Untreated
  sickness is not fatal within a day: it drains exactly what a healthy pet
  regenerates, so on its own it only stalls recovery — except for an elder,
  which it wears down in a day or so. The page now also covers the 20%
  line, regeneration, medicine and the elder's rising line (`7cd61a4`,
  `1cbbc93`)
- SPEC §2.3, §2.10 and §16.2 describe the current rules; cause of death
  remains the largest drain at the death tick, so an elder worn down by age
  usually reads as dying of illness (`7c3d153`, `1cbbc93`)

## [0.4.0] — 2026-10-15

Two player reports on Bubble Bath Pop. Every event log written before this
folds byte-identically: the bath's hygiene bonus keys on a new optional
`minigame` field that older events do not carry.

### Added

- **A Bubble Bath Pop run cleans Makoto a little.** The run's score scales a
  10% hygiene base exactly as it scales joy, then the ordinary curve and the
  caretaker's hygiene allowance apply — about 5% for a par run on a
  half-clean Makoto. It shares CLEAN's allowance but is not a CLEAN: no
  cooldown, no wish, no extra coins. The result line shows it (`a47d5d7`,
  `63b7121`)
- `MinigameDef.bonus`, `minigameBonus`, `ReduceResult.bonus` and the optional
  `minigame` field on `CARE` events, written by the play route from the
  server-side session (`a47d5d7`)

### Fixed

- **Bubble Bath Pop uses the whole board.** Bubbles spawned in the left
  quarter and only drifted right, so the game was played in a corner. They
  now rise from the whole width, drift either way and never leave the
  board, and a tap pops the nearest bubble within a target about 42 CSS px
  across at phone width (was about 24) (`711fd19`, `d5686fd`)
- An unknown game id on a stored event folds with no bonus instead of
  throwing (`a63671c`)

## [0.3.3] — 2026-10-15

### Fixed

- **An elder's brow tufts sit over the eyes, not above the head.** They hung
  from the dip between the ears — the top of the skull — so their fur stood
  above the head outline and read as a second, paler pair of ears. Each frame
  now places them from its own eyes, and they never rise past the outline
- **A worn hat no longer lands on the nightcap.** The sleeping art wears its
  own nightcap, and the crown, cap or bow was drawn straight over it all
  night. Asleep, Makoto wears only the nightcap

## [0.3.2] — 2026-09-27

### Fixed

- **Don't Get Sausaged no longer lights the answer.** The ordered pad lit up
  as the order came, so the game was "tap the bright one". The shouted word
  is now the only cue — larger, and in no pad's colour — and a pad lights
  only after it is pressed

## [0.3.1] — 2026-09-27

### Fixed

- **The Feed menu lists the whole catalog, not only the pack.** A new
  caretaker saw two rows — rice and a link to the shop — because the menu
  only offered what was already owned. Every food and drink now appears with
  its price; owned ones feed in one tap, unowned ones buy and feed in one
  tap, and one the balance cannot cover says how far short it is. The shop
  link, and the shop's open-on-a-tab plumbing, are gone with it
- `feedEntry` replaces `packEntry` and carries the price; `needsMoreCoins`
  is the one shortfall line the shop rows and the menu share

## [0.3.0] — 2026-09-27

A pass on the one minigame that read as random, on what feeding can mean,
and on what a shared link says. Every event log written before this folds
byte-identically: the one new field on a generation is optional and reads as
the old catalog when absent.

### Added

- **A food menu with costs.** Sausage (×1.35, +2% joy), Nile River Pizza
  (×1.75, +1% joy, −3% hygiene), Candy (×0.40, +4% joy, −1% health) and
  Soda (+16% energy, +2% joy, −1% health). A meal is a decision now; a treat
  can never be what kills (health floors at 1). Peppers stay off the menu —
  they are people here (`d84aacf`)
- **The Feed tile is split.** One tap still serves the free meal; the chevron
  opens the pack as a menu — each item with its perk line and its own
  availability — and leads into the shop when the pack is empty (`07e01c2`)
- **The link card is live.** `og:description` and the card image carry the
  pet's name, stage, meters and today's goal, phrased as what is left ("7
  more meals to Feast day"); the goal banner gains a share button that copies
  a cache-keyed link (`7acc203`)
- `questLine` — the day's goal as one sentence; `shareView` — the one view
  the description and the card draw from (`7acc203`)
- The head count under the meters links to device linking, with the reason (`ee89a18`)
- `Perks` on food and drink items; `foodCatalogOf` and
  `Generation.foodCatalogSize` (`d84aacf`, `af7f190`)

### Changed

- **A generation's taste is pinned to the menu it was born with.** Quirks
  and cravings draw over the catalog prefix recorded at laying, so a longer
  menu never reshuffles a living pet's favourite; older eggs read as the
  two-meal catalog (`af7f190`)
- Slogan: "The internet's chinchilla." — under every
  link, in the manifest, and on the card (`7acc203`)
- Shop item glyphs and detail lines come from one copy module; the pack tab
  says what each item does instead of "An extra-tasty meal" (`d84aacf`)
- `quirks()`, `quirkFoodPercent()` and `wantAt()` take a generation, not a
  bare seed; `toGeneration()` is the one place a stored generation becomes
  the sim's (`af7f190`)

### Fixed

- **Sausage Party dealt dishes nobody wanted.** Two runs in five opened on a
  dish with no taker and a fifth of later trays did too, with no way to
  discard one. The kitchen now only plates what a seated guest is holding
  up, re-plates a dish orphaned by a walkout, answers a tap during plating
  with a wobble instead of silence, and shows walkouts (angry pose, ✗, a
  `lost` counter) and the patience a wrong plate cost. The tray is the
  biggest thing on the board, centre-front; the rules are a pure module with
  a property test (`37f09d0`)
- The drink detail line no longer genders the pet (`d84aacf`)

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
