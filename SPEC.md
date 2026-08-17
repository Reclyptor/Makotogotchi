# Makotogotchi — Specification

> **Version:** 1.1 (approved; revised after adversarial plan review)
> **Last Updated:** 2026-08-15
> **Status:** Source of truth for the entire project. No code lands that
> contradicts this document. When reality and this document disagree, one of
> the two is a bug — decide which, then fix it.

---

## Table of Contents

1. [Product](#1-product)
2. [Game Design](#2-game-design)
3. [Architecture](#3-architecture)
4. [Simulation Core](#4-simulation-core)
5. [Tuning](#5-tuning)
6. [Persistence](#6-persistence)
7. [Realtime Protocol](#7-realtime-protocol)
8. [Identity, Rate Limiting, and Abuse](#8-identity-rate-limiting-and-abuse)
9. [HTTP API](#9-http-api)
10. [Render Engine](#10-render-engine)
11. [User Interface](#11-user-interface)
12. [Web Push](#12-web-push)
13. [Economy and Minigame](#13-economy-and-minigame)
14. [Repository Layout](#14-repository-layout)
15. [Configuration](#15-configuration)
16. [Testing Strategy](#16-testing-strategy)
17. [Build and CI](#17-build-and-ci)
18. [Deployment](#18-deployment)
19. [Cloudflare](#19-cloudflare)
20. [Build Phases](#20-build-phases)
21. [Appendix: What the Original Got Wrong](#21-appendix-what-the-original-got-wrong)

---

## 1. Product

### 1.1 The Pitch

Makotogotchi is **one chinchilla, on the internet, that everybody shares.**

There is exactly one pet. It is always alive and always simulating, whether or
not anyone is watching. Anyone who opens the URL becomes a caretaker
immediately — no account, no login, no friction. They can feed it, clean it,
play with it, treat it when it's sick, and sing it to sleep. Everyone
connected sees every action as it happens, attributed by name.

If the community stops caring for it, it dies. Permanently. Its grave joins a
memorial wall recording its name, its lifespan, how it died, and who kept it
alive the longest. Then a new egg begins to hatch, and the community names it.

### 1.2 Design Goals

| Goal | Why it matters |
| --- | --- |
| **Presence must be felt** | The single thing that makes this different from a solo tamagotchi is seeing other people. Presence and attribution are not decoration; they are the product. |
| **Stakes must be real** | Permanent death is what makes the daily check-in matter. A pet that cannot die is a screensaver. |
| **A lone caretaker can rescue it** | At 3am with one person online, that person must be able to pull the pet back from the brink through sustained effort. Otherwise the game punishes people for being loyal. |
| **A lone caretaker cannot sustain it** | Over weeks, keeping the pet thriving must require the group. Otherwise there is no reason for the group. |
| **Griefing must be structurally impossible** | Not "hard", not "rate-limited enough" — impossible. See §2.4. |
| **The simulation must be honest** | The pet's state is a pure function of its event history and elapsed time. No fudging, no client authority, no drift. |

### 1.3 Non-Goals

- Multiple pets, private pets, or per-user pets.
- User accounts, passwords, or SSO. (The caretaker cookie is designed so that
  linking an Authentik identity later is additive, not a rewrite.)
- Real-money purchases of any kind.
- Free-text chat. Emoji reactions only — moderating text chat is a project of
  its own and this is a toy for friends.

---

## 2. Game Design

### 2.1 The Core Loop

```
        ┌─────────────────────────────────────────────┐
        │                                             │
   needs decay in real time                           │
        │                                             │
        ▼                                             │
   pet visibly suffers ──► push alert fires ──► caretakers arrive
        │                                             │
        ▼                                             │
   caretakers act (attributed, live, cooperative) ────┘
        │
        ▼
   needs recover ──► pet thrives ──► ages ──► evolves
        │
        └──► or doesn't ──► health drains ──► death ──► memorial ──► new egg
```

### 2.2 Needs

Five needs, each an integer in `[0, 100000]` (rendered as a percentage with
three decimal places of internal precision; see §4.2 for why integers).

| Need | Decays because | Restored by | Notes |
| --- | --- | --- | --- |
| **Hunger** | Always (slower asleep) | `FEED` | The pacesetter — the fastest-decaying need, so it is what drives most check-ins. |
| **Energy** | Awake hours | Sleeping; `LULLABY` helps it fall asleep | *Recovers* while asleep. Effectively self-solving unless the pet is kept awake. |
| **Hygiene** | Always | `CLEAN` (a dust bath — chinchillas bathe in volcanic dust, not water) | Slowest decay. |
| **Joy** | Always | `PLAY`, `PET` | Second-fastest. Drives the social actions. |
| **Health** | **Never on its own** | `MEDICATE` (only while `SICK`); regenerates slowly when no need is critical | The death clock. See §2.3. |

**Health is the only need that kills.** The other four are warning lights.
This is deliberate: it produces a long, legible, two-stage failure — first the
pet is visibly unhappy for many hours (recoverable, alarming, motivating),
then it starts actually dying.

### 2.3 Health and Death

Health does not tick down on a timer. It drains **in proportion to how badly
the other needs are neglected**.

Health is stored in raw units, `healthRaw ∈ [0, HEALTH_MAX]` with
`HEALTH_MAX = 10¹²` — a scale decoupled from the need scale so the drain
formula is pure integer arithmetic with no division anywhere:

```
drainPerTick = HEALTH_DRAIN_PER_NEED × Σ max(0, CRITICAL_THRESHOLD − value)   over hunger, energy, hygiene, joy
             + HEALTH_DRAIN_SICK        if the SICK ailment is untreated
             + HEALTH_DRAIN_AGE         if stage is ELDER (unconditional)
regenPerTick = HEALTH_REGEN             if no need is below CRITICAL_THRESHOLD
                                        (never for ELDER)
```

`causeOfDeath` is the largest drain source at the moment of death — the need
with the deepest deficit, sickness, or age — with a deterministic tie order
(needs, then sickness, then age). Instantaneous attribution at the death tick
keeps the rule a pure function of state; a rolling "final hour" account would
require per-tick history the state deliberately does not carry.

Consequences that fall out of this for free, rather than being special-cased:

- A pet with one need slightly below critical loses health *slowly*. There is
  a long, forgiving ramp.
- A pet with every need at zero dies fast. Total abandonment is fatal.
- Restoring **any** need immediately slows the bleeding. Partial help helps,
  which means a single caretaker who can only manage a few actions still
  meaningfully extends the pet's life. This is the "a lone caretaker can
  rescue it" goal, satisfied by the shape of the rule rather than by a
  special case.
- Untreated illness is dangerous on its own, independent of needs.

When `health` reaches `0`, the pet dies. `causeOfDeath` records whichever
need contributed the largest share of the health drained over the final hour —
so the memorial can read "starved", "died of illness", "died of loneliness".

**Old age.** An `ELDER` pet's needs decay faster, its health regeneration is
disabled, and `HEALTH_DRAIN_AGE` drains its health unconditionally every tick
— so its death is arithmetically certain, not merely likely: roughly 9–10
elder days from full health under perfect care. (Disabling regeneration alone
would *not* accomplish this — a well-tended elder would take zero drain and
live forever; the unconditional term is what makes mortality a theorem.)
`causeOfDeath` reads as old age when the age term dominates the final hour's
drain. A pet that dies of old age under devoted care is a *win*, and the
memorial records it as such.

### 2.4 Why Griefing Is Impossible

There is no action in the game that reduces a need or damages the pet. The
worst thing a malicious visitor can do is help.

This is a structural guarantee, not a mitigation. Rate limits (§8) exist to
protect the *server* and to pace the *game*, not to protect the pet from
players. A determined attacker with a thousand IPs achieves: a well-fed pet.

The consequence to accept: the classic tamagotchi overfeeding-makes-you-sick
mechanic is gone. It is replaced by **diminishing returns** (§2.6), which
provides the same "you cannot just spam the button" pressure without handing
anyone a weapon.

### 2.5 Actions

| Action | Restores | Global cooldown | Per-caretaker cooldown | Available when |
| --- | --- | --- | --- | --- |
| `FEED` | Hunger | 50s | 3 min | Awake |
| `PLAY` | Joy | 60s | 3 min | Awake, energy > 10% |
| `CLEAN` | Hygiene | 90s | 5 min | Awake |
| `MEDICATE` | Clears `SICK`, small health | 5 min | 10 min | `SICK` present |
| `LULLABY` | Energy; induces sleep | 2 min | 5 min | Night, or energy < 25% |
| `PET` | Small Joy | 10s | 30s | Always (even asleep) |

(Cooldowns are whole ticks — 10-second quanta — which is why `FEED` is 50s
rather than a rounder 45s.)

**Global cooldown** is a property of *the pet*, not of the player: the pet is
busy eating; wait for it to finish. The UI says so in those words. This
reframes throttling as game logic instead of punishment, and it is what makes
a crowd of fifty people no more effective than a crowd of five — which is
exactly the pressure that makes sustained, spread-out care the winning
strategy.

**Per-caretaker cooldown** is what prevents one person from soloing the pet
indefinitely.

`PET` exists as the always-available, low-value action so that a caretaker who
arrives during a global cooldown still has something to do, and so that a
sleeping pet is still interactive.

`PLAY` costs the pet `PLAY_ENERGY_COST` energy (the minigame pro-rates this by
duration). This is what makes energy a live mechanic: without it, the nightly
recovery outpaces awake decay so thoroughly that `EXHAUSTED`, involuntary
naps, `LULLABY`'s daytime gate, and `PLAY`'s own energy gate would all be
unreachable states. With it, a heavy play day genuinely tires the pet and
`PLAY` acquires a real tradeoff.

**Caretaker budget.** For each `(caretaker, need)`, the total *applied*
restoration over any rolling window of 7 pet-days may not exceed
`CARETAKER_WEEKLY_BUDGET_DAYS × dailyDecay(need)`. Actions beyond the budget
still validate but apply 0, and the UI explains why ("Makoto wants someone
else's attention"). `MEDICATE` is exempt — an emergency responder is never
turned away.

This is the structural encoding of §1.2's "a lone caretaker cannot sustain
it", and it exists because cooldowns alone *cannot* encode it: a burst rescue
needs more than a day's decay applied within 30 minutes, while solo
sustainment needs less than a day's decay per day — no per-action cooldown
satisfies both. The budget does: one person can supply ~4 days of decay per
week (rescues cost about one day's worth, so bursts fit), but sustaining the
pet requires 7 — arithmetically impossible alone, barely possible for two,
comfortable for three. The constant *is* the minimum viable community size,
in the same spirit as §2.4's structurally-impossible griefing.

The budget is folded from the event log like all other state: a 7-slot ring
of per-pet-day applied totals per active `(caretaker, need)`, pruned when
stale.

### 2.6 Diminishing Returns

```
applied = floor((base × (NEED_MAX − current) + NEED_MAX / 2) / NEED_MAX)
```

(Integer round-half-up — never floating-point division; §4.2.)

Feeding a starving pet gives the full amount. Feeding a full pet gives
nothing. The curve makes topping off the last 20% cost as many actions as the
first 60%, which naturally spreads care over time and over people.

Worked example with `FEED_BASE = 25000` (25%), from empty:

| Feed | Applied | Hunger after |
| --- | --- | --- |
| 1 | 25.0% | 25.0% |
| 2 | 18.8% | 43.8% |
| 3 | 14.1% | 57.8% |
| 4 | 10.6% | 68.4% |
| 5 | 7.9% | 76.3% |
| 6 | 5.9% | 82.2% |
| 7 | 4.4% | 86.7% |

Seven feeds to get comfortably fed. At a 3-minute per-caretaker cooldown a
lone caretaker needs ~21 minutes of attention to rescue a starving pet — hard
but achievable, which is the intended feel. With four people it takes about
five minutes, bounded by the 45s global cooldown.

### 2.7 Day and Night

The pet keeps a home timezone (`America/Chicago`). Between `SLEEP_HOUR` and
`WAKE_HOUR` it sleeps:

- Energy recovers; hunger and joy decay at a reduced rate; hygiene is
  unchanged.
- `FEED`, `PLAY`, `CLEAN` are unavailable — the pet is asleep. `PET` and
  `MEDICATE` still work.
- A pet with critically low energy during the day will also nap, and
  `LULLABY` will put it down early.

This gives the game a daily rhythm and — importantly — means the overnight
window is the *least* dangerous time, not the most. Nobody is punished for
sleeping.

### 2.8 Life Stages

| Stage | Begins at | Behaviour |
| --- | --- | --- |
| `EGG` | Generation start | Incubating. Cannot be interacted with beyond watching. 30 minutes minimum — ends at the `HATCHED` event, whose timing depends on the naming vote (§2.10), which is why every later boundary counts from hatch. The spritesheet's eight-frame incubator sequence plays through. |
| `HATCHLING` | Hatch | Needs decay at 60% rate. A grace period for a newborn. |
| `PUP` | Hatch +1 day | Full decay rate begins. |
| `JUVENILE` | Hatch +3 days | Care quality is sampled here — this window determines the adult form. |
| `ADULT` | Hatch +7 days | Branches on care quality (below). |
| `ELDER` | Hatch +21 days | Faster decay, no health regeneration, and an unconditional per-tick health drain (§2.3). Mortality is now arithmetically certain; only the date is open. |

A newly hatched pet starts with every need at `NEED_MAX` and full health.

**Adult branching.** `careScore` is the time-weighted mean of the needs mean
across the `JUVENILE` window, accumulated as an exact integer
`(numerator, tickCount)` pair per projection segment via the same arithmetic
series as everything else in §4.5, and evaluated once at the `ADULT`
transition. (Not an EMA — a per-tick EMA has no exact integer closed form and
would force tick-by-tick iteration through the entire four-day window.)
At the transition:

| `careScore` | Form | Visual |
| --- | --- | --- |
| ≥ 75% | `THRIVING` | Bright, sparkles on idle, fastest animations |
| 40–75% | `STEADY` | The default look |
| < 40% | `FRAIL` | Duller palette, slower idle, tires visibly sooner |

The form is cosmetic *plus* a small modifier to decay rates, so a well-raised
pet is genuinely easier to keep alive. It is decided once and never revisited —
so the juvenile window is a real, high-stakes, community-wide test.

### 2.9 Ailments

Transient conditions layered on top of needs.

| Ailment | Onset | Effect |
| --- | --- | --- |
| `SICK` | Random chance per tick, weighted by low hygiene and low health; cleared only by `MEDICATE` | Drains health directly. The strongest push-alert trigger. |
| `FILTHY` | Hygiene < 25% | Raises `SICK` onset chance (continuously, via the onset formula). |
| `STARVING` | Hunger < 15% | Cosmetic + alert trigger. |
| `EXHAUSTED` | Energy < 15% | Pet naps involuntarily until energy ≥ 40%. |
| `SAD` | Joy < 20% | Cosmetic + alert trigger. |

Only `SICK` is stochastic. Every other ailment is a pure threshold function
of instantaneous state, derived rather than stored (§4.3) — deliberately
*without* display hysteresis, which would require stored history for a purely
cosmetic flag. The two places on/off asymmetry genuinely matters carry their
own state already: the nap machine (sleep state persists until the 40% wake
threshold) and push-alert re-arming (server-side, §12).

### 2.10 Death, Memorial, Rebirth

On death:

1. The generation is sealed with `diedAt`, `causeOfDeath`, final age, and the
   ranked list of that generation's caretakers by contribution.
2. A `DIED` milestone broadcasts to every connected client. The scene shows
   the gravestone sprite. This state persists for `MOURNING_DURATION`
   (2 hours) — long enough that people who were asleep still see it happened.
3. The memorial wall (`/memorial`) gains a permanent entry.
4. When mourning ends, a new egg appears and begins its 30-minute
   incubation; a naming vote opens with it. Any caretaker may propose a name
   (validated per §8.5) or vote for one. The winner at the end of incubation
   becomes the new pet's name. Ties break toward the earliest proposal; if
   nothing is proposed, the egg waits — incubation extends until the first
   proposal arrives, and that lone proposal wins.
5. Caretakers who were active in the previous generation get
   `generationsSurvived` incremented — a persistent badge of tenure that
   carries across deaths.

Death is a **feature**, and it is the single best re-engagement event the
game has. It should feel like an occasion.

### 2.11 Social Systems

- **Presence.** A live count of who is watching, and their nicknames.
- **Action feed.** Every action produces an attributed, animated toast in the
  scene: `+18.8% 🍖 — fed by Emilio`. This is the heartbeat of the shared
  experience.
- **Reactions.** Emoji reactions broadcast to everyone. Zero moderation
  surface, high expressiveness.
- **Leaderboards.** Today / this week / all time / this generation, ranked by
  a weighted contribution score (not raw action count, so `PET` spam does not
  top the board). The score for an action is its *applied* magnitude times a
  per-action weight defined in `tuning.ts` (`MEDICATE` and `LULLABY` carry
  flat scores since they are not magnitude-shaped). The current leader wears
  a crown in the presence list.
- **Streaks.** Consecutive days with at least one action, measured in the
  pet's timezone. The pet greets returning caretakers by name.

---

## 3. Architecture

### 3.1 The One Idea

**The pet's state is a pure, deterministic function of its event log and the
current time.** Everything else in this document follows from that.

```
state(t) = project( fold(reduce, snapshot, eventsSince(snapshot)), t )
```

`reduce` and `project` are pure functions in `src/sim/`. They perform no I/O,
call no clock, and consume no global randomness. They are the only place game
rules exist, and they are shared verbatim by the server and the browser.

This yields, without further effort:

| Property | Why it holds |
| --- | --- |
| **Restart-safe** | A pod down for three hours restarts and projects forward to now. Exactly correct, no catch-up code. |
| **Testable** | The entire game is unit-testable with no database, no network, and no fake timers. |
| **Replayable** | Any event log replays to a bit-identical state on any machine. |
| **Client prediction** | The browser runs the same `project()` between server pushes, so meters drain smoothly at 60fps while the server pushes rarely. |
| **Auditable** | "Why did it die?" is answerable by replaying the log. |

### 3.2 Layers

```
┌──────────────────────────────────────────────────────────────┐
│  src/app       Next.js App Router — routes, RSC, handlers    │
├──────────────────────────────────────────────────────────────┤
│  src/game      Canvas render engine + scene (browser only)   │
├──────────────────────────────────────────────────────────────┤
│  src/server    Mongo repos · Redis · tick engine · identity  │
│                · rate limiting · push       (server only)    │
├──────────────────────────────────────────────────────────────┤
│  src/sim       PURE. No I/O, no clock, no RNG, no React.     │
│                Imported by every layer above. Imports none.  │
└──────────────────────────────────────────────────────────────┘
```

**Dependency rule, enforced by lint:** `src/sim` imports nothing from the
other three. `src/game` imports only `src/sim`. `src/server` imports only
`src/sim`. Violations fail CI.

### 3.3 The Tick Authority

Exactly one process may advance simulated time and emit system events
(`EVOLVED`, `FELL_ASLEEP`, `BECAME_SICK`, `DIED`).

Leadership is a Redis lease: `SET mgc:tick-leader <podId> NX PX 15000`,
renewed each tick by the holder. The leader runs the tick loop on a
`TICK_INTERVAL` timer. On loss of leadership the loop stops immediately.

Production runs **one replica** — a single global pet needs no horizontal
scale, and one replica removes an entire class of problems. The lease exists
anyway because it makes rolling deploys and any future replica bump correct
*by construction*: because projection is deterministic and keyed to absolute
tick index, a gap in leadership of any duration causes zero drift. The new
leader simply projects forward and emits whatever system events the interval
implies.

### 3.4 Write Path

```
POST /api/care
  → verify caretaker cookie (HMAC)
  → Redis token bucket: per caretaker, per IP        → 429 if exhausted
  → acquire mgc:write (Redis lock, ~ms hold) ────────┐
  → load current state (Redis-cached, Mongo fallback)│
  → project() to now                                 │  serialized
  → sim validates the action                         │  critical
      (awake? cooldowns? budget? ailment?) → 409     │  section
  → append CareEvent to Mongo, assigning seq         │
  → reduce() into Redis snapshot                     │
  → PUBLISH to Redis channel ────────────────────────┘
  → every pod fans out over SSE to its connected clients
```

The Mongo append is the durability point. Everything after it is derived and
can be rebuilt.

The `mgc:write` lock serializes the read→validate→append→reduce→publish
section; the tick leader emits its system events under the same lock. Without
it, two concurrent care requests (Next handlers run concurrently even in one
pod, and two pods coexist during a rolling deploy) would both project from the
same base state, double-apply past the diminishing-returns curve, and race
each other writing `mgc:state`. An in-process queue is not sufficient
precisely because of the rolling-deploy overlap.

Each event carries a per-generation monotonic `seq`, assigned inside the
lock. `seq` — not `tick` — is the canonical fold order: multiple events can
share a tick, and replay determinism requires a total order.

---

## 4. Simulation Core

`src/sim/` — the heart of the project. Held to the highest standard in the
codebase.

### 4.1 Modules

| File | Contents |
| --- | --- |
| `model.ts` | `PetState`, `Needs`, `LifeStage`, `AdultForm`, `Phase`, `Ailment`, `Generation`. Types only. |
| `tuning.ts` | Every constant in the game. One file. No magic number lives anywhere else. |
| `events.ts` | The discriminated union of all events, `CareEvent | SystemEvent`, plus zod schemas for wire validation. |
| `reduce.ts` | `reduce(state, event): PetState` — pure, total, exhaustive over the union. |
| `project.ts` | `project(state, toTick): PetState` — advances simulated time. |
| `validate.ts` | `canPerform(state, action, ctx): Result` — the single authority on whether an action is legal. Used by the server to reject and by the client to grey out buttons. |
| `derive.ts` | `derive(state): DerivedState` — ailments, mood, animation key, alert level. Everything presentational. |
| `rng.ts` | Seeded `mulberry32`, keyed by `(generationSeed, tickIndex, purpose)`. |
| `score.ts` | Contribution scoring, the `careScore` accumulator, and the caretaker budget rings. |

### 4.2 Integers, Not Floats

All need values are integers in `[0, NEED_MAX]` with `NEED_MAX = 1,000,000`
(display divides by 10,000 for a percentage). Health is an integer in
`[0, HEALTH_MAX]` with `HEALTH_MAX = 10¹²` (raw units, §2.3 — scaled so its
drain formula never divides). All rates are integers: the need scale is
chosen so per-tick rates land at ~60–90, where the stage/phase/form
multipliers round to integers with negligible error. The multiplied-out
rates live in a precomputed integer table in `tuning.ts` — the table is the
single source of truth the simulation reads; the multipliers are its
documentation. Nothing in `src/sim` performs floating-point arithmetic on
state, and every quantity stays far inside 2⁵³.

Floating point would make replay determinism depend on JS engine rounding,
make test assertions approximate, and let values drift by epsilon over
millions of ticks. Integers make every test an exact equality and make
"the client and server agree" a provable property rather than a hope.

Display divides by 1000 for a percentage.

### 4.3 Stored vs. Derived

**Stored** (the minimum that cannot be recomputed): needs, `healthRaw`,
phase, stage, adult form, `bornAtTick`, `lastEventTick`, `sleepState`,
`sick`, the `careScore` accumulator pair (§2.8), the caretaker budget rings
(§2.5), generation identity and seed.

**Derived** (never stored, computed by `derive.ts`): every ailment except
`SICK`, mood, animation key, alert level, "is the pet busy", cooldown
remainders.

The original project stored animation frames as game state
(`Status.CLONE1..4`). That class of bug is structurally impossible here: the
renderer receives an animation key from `derive.ts` and the state type has no
field capable of holding one.

### 4.4 Determinism Rules

Enforced by lint rules and by review:

1. No `Date.now()`, no `new Date()`, no `performance.now()` in `src/sim`.
   Time enters only as an explicit `tick` parameter.
2. No `Math.random()`. Randomness comes from `rng(seed, tick, purpose)`,
   which is a pure function of its arguments.
3. No mutation of inputs. `reduce` and `project` return new objects.
4. Exhaustive switches with a `never` check on the default branch, so adding
   an event variant is a compile error until it is handled.

### 4.5 Projection

Time is quantised into ticks of `TICK_SECONDS` (10s):

```
tickIndex = floor((unixMs − GENESIS_EPOCH_MS) / (TICK_SECONDS × 1000))
```

`GENESIS_EPOCH_MS` is a fixed constant recorded on the generation document —
it anchors the RNG keys, the day/night boundaries, and cross-restart
consistency. Nothing else in the system defines time.

`project(state, toTick, ctx)` advances from `state.lastEventTick` to
`toTick`. `ctx` carries the **phase schedule** — the precomputed list of
sleep/wake boundary ticks. The only timezone-aware code in the project lives
in one `src/server` module that generates this schedule; it ships to clients
in `hello` and `snapshot`. `src/sim` contains no timezone logic, no `Intl`,
and no locale data — a DST transition is just two odd boundary ticks a year,
handled for free.

**The reference semantics is an exact per-tick integer fold** with a pinned
step order (stage evolution → schedule sleep/wake sync → decay/recovery →
nap transitions → CRITICAL crossings → careScore accumulation → sickness
draw → health drain and death check). Each tick is a pure function of the
previous tick's state and the absolute tick index, so path independence
holds by construction and every replay is bit-identical. No per-tick
rounding exists anywhere — all rates are integers (§4.2).

The reference is also the implementation. The cost is O(elapsed ticks) at
~20 integer operations per tick, and every real workload is far below the
threshold of caring: the client projects a few ticks per frame; the server
projects seconds of gap; a cold restart after three hours is ~1,080 ticks;
replaying an entire 30-day generation is ~260k ticks — milliseconds. The
worst possible live gap is bounded by death itself (an untended pet's state
freezes within ~2 days). Because need decay is piecewise-linear between
state-change boundaries, closed-form per-segment arithmetic series exist as
an optimization path — but any such optimization must property-test equal to
the per-tick reference, and none is warranted at these scales.

The SICK onset draw is keyed by absolute tick index (§4.4), so the stream is
path-independent by construction — projection granularity cannot change
which tick gets sick.

The property test in §16 asserts all of this at once:

```
project(project(s, a, ctx), b, ctx) === project(s, b, ctx)      for all a ≤ b
```

If that ever fails, the segmentation is wrong. It is the single most important
test in the codebase.

---

## 5. Tuning

All values live in `src/sim/tuning.ts`, which is the authority; this block
is its summary. §16 describes the tests that hold the *design intent*
invariant while these are tuned.

```
TICK_SECONDS            = 10          ; 8640 ticks per day
NEED_MAX                = 1_000_000   ; display /10_000 → percent
CRITICAL_THRESHOLD      = 200_000     ; 20%

decay per tick, awake, PUP..ADULT (need units):
  hunger                = 90          ; 100% → 20% in ~24.7h nominal ← the pacesetter
  joy                   = 80          ; ~27.8h
  energy                = 70          ; ~31.7h
  hygiene               = 60          ; ~37.0h

multipliers (inputs to the precomputed integer rate table, §4.2):
  asleep: hunger, joy   = ×0.4 ; hygiene ×1.0 ; energy decays 0
  energy asleep         = +300/tick recovery (0 → ~97% over a 9h night)
  stage: HATCHLING ×0.6 ; PUP/JUVENILE/ADULT ×1.0 ; ELDER ×1.4
  form:  THRIVING ×0.9  ; STEADY ×1.0 ; FRAIL ×1.15

health (raw units; HEALTH_MAX = 10¹²):
  HEALTH_DRAIN_PER_NEED = 550         ; × Σ max(0, CRITICAL_THRESHOLD − need), per tick
                                      ; worst case 4.4×10⁸/tick → ~6.3h from full
                                      ; under total deprivation
  HEALTH_DRAIN_SICK     = 120_000_000 ; per tick untreated (~23h to kill from full —
                                      ; an overnight onset leaves the day shift a
                                      ; real chance to answer the push alert)
  HEALTH_DRAIN_AGE      = 12_000_000  ; per tick, ELDER only, unconditional
                                      ; (~9.6 elder days from full under perfect care)
  HEALTH_REGEN          = 120_000_000 ; per tick, only when nothing is critical
                                      ; (~23h from zero to full); disabled for ELDER

action base magnitudes (need units):
  FEED                  = 250_000     ; 25%
  PLAY                  = 220_000     ; joy
  PLAY_ENERGY_COST      =  60_000     ; energy cost paid by the pet (§2.5)
  CLEAN                 = 300_000
  LULLABY               = 150_000     ; energy
  PET                   =  40_000
  MEDICATE              = clears SICK, +5% healthRaw flat
                          (not subject to diminishing returns)

caretaker budget (§2.5):
  CARETAKER_WEEKLY_BUDGET_DAYS = 4    ; applied restoration per (caretaker, need)
                                      ; per rolling 7 pet-days ≤ 4 × dailyDecay(need)

contribution weights (§2.11): per-action multipliers on applied magnitude;
  MEDICATE and LULLABY score flat amounts. Values live in tuning.ts.

SICK onset per tick (exact integer threshold vs a uint32 draw):
  base                  = 1 / 30000   ; ≈ once per 3.5 days at full hygiene
  × (1 + 4 × filthiness) where filthiness = (1 − hygiene/NEED_MAX)
  × 3 if healthRaw < 40% of HEALTH_MAX

sleep/nap thresholds:
  EXHAUSTED (nap onset) = 150_000 ; nap/lullaby sleep ends at 400_000
  LULLABY daytime gate  = 250_000 ; PLAY energy gate 100_000

SLEEP_HOUR = 22, WAKE_HOUR = 7, TZ = America/Chicago
MOURNING_DURATION = 2h
INCUBATION_TICKS = 180 (30 min minimum; extends until the first name proposal)
```

**The health constants were tuned against the §16.2 dial tests, not derived
by hand** — measured on the committed seeds: pure-neglect death at 45.6h,
sickness-accelerated death at 41.1h. Encoding the difficulty dial as an
executable assertion means retuning can never silently violate the design
intent.

Note that the headline "~24h to critical" is the *nominal always-awake*
number. With the sleep multipliers in effect, the lived window depends on
the start phase: a full PUP untouched from `WAKE_HOUR` goes hunger-critical
at ~30h. The §16.2 tests pin the start phase for exactly this reason.

---

## 6. Persistence

MongoDB is the durable source of truth. Redis is the realtime layer and cache.
Neither is optional; each has a distinct job and neither substitutes for the
other.

### 6.1 MongoDB — database `makotogotchi`

| Collection | Purpose | Key indexes |
| --- | --- | --- |
| `generations` | One document per pet lifetime. Identity, seed, birth, death, cause, final stats, ranked caretakers. | `{ ordinal: -1 }`, `{ diedAt: 1 }` |
| `events` | **Append-only.** Every care and system event, with `generationId`, `seq`, `tick`, `caretakerId`, `action`. `seq` is per-generation monotonic (assigned under the write lock, §3.4) and is the canonical fold order. `applied` and `needsAfter` are stored too, but as **denormalized display fields** for feeds and audit only — `reduce()` recomputes the authoritative applied value from in-order state. Never updated, never deleted. | `{ generationId: 1, seq: 1 }` **unique**, `{ caretakerId: 1, at: -1 }`, `{ at: -1 }` |
| `snapshots` | Periodic materialised `PetState` per generation, written every `SNAPSHOT_INTERVAL` (5 min) and on every system event. Bounds replay cost. | `{ generationId: 1, tick: -1 }` |
| `caretakers` | Identity, nickname, totals, per-action counts, streak, `generationsSurvived`, coins. | `{ _id }`, `{ nickname: 1 }` unique sparse, `{ score: -1 }` |
| `contributions` | Pre-aggregated per `(caretakerId, generationId, day)` rollups backing the leaderboards. | `{ generationId: 1, score: -1 }`, `{ day: 1, score: -1 }` |
| `pushSubscriptions` | Web Push endpoints and keys, per caretaker. | `{ caretakerId: 1 }`, `{ endpoint: 1 }` unique |
| `nameVotes` | Proposals and votes for the incubating generation. | `{ generationId: 1, nameLower: 1 }` unique |
| `roomState` | One communal document: owned cosmetics, the worn one, and installed decor (SPEC §13.2). | singleton `_id: "room"` |

Recovery is `latest snapshot → fold events after it → project to now`. With a
5-minute snapshot interval, the global cooldowns bound worst-case replay at
roughly 50–60 events.

### 6.2 Redis

Shared cluster instance. **Every key and every pub/sub channel is prefixed
`mgc:`.** The app also uses a dedicated logical DB index, but note that DB
indexes do *not* partition pub/sub — channels are global to the instance —
so the prefix is what actually prevents collision and must never be relaxed.

| Key | Type | Purpose |
| --- | --- | --- |
| `mgc:state` | string (JSON) | Hot snapshot of current `PetState`. Read path for SSE connects. |
| `mgc:events` | pub/sub channel | Cross-pod fanout. |
| `mgc:tick-leader` | string w/ PX | Leader lease (§3.3). |
| `mgc:presence` | sorted set | `caretakerId → lastSeen`. Pruned by score on read. |
| `mgc:rl:{scope}:{id}` | string w/ TTL | Token buckets. |
| `mgc:cd:{action}` | string w/ TTL | Global action cooldowns. |
| `mgc:cd:{caretaker}:{action}` | string w/ TTL | Per-caretaker cooldowns. |
| `mgc:lb:{window}` | sorted set, TTL | Cached leaderboards. |

Redis holding no unique durable state is a deliberate invariant: **flushing
Redis must cost nothing but a cold cache.** Anything that would be lost
permanently belongs in Mongo.

---

## 7. Realtime Protocol

### 7.1 Transport

Server-sent events, one endpoint, `GET /api/stream`. Actions travel up as
ordinary `POST` requests. This keeps the app a pure Next.js App Router
deployment with `output: "standalone"` and no custom server, and gives
automatic reconnection with backoff for free.

Server → client only needs to be a stream; client → server only needs to be
discrete commands. SSE fits the shape exactly, and WebSockets would buy
nothing for the cost of a custom server.

### 7.2 Events

| Event | Payload | When |
| --- | --- | --- |
| `hello` | `{ caretakerId, nickname, serverTick, tickSeconds, genesisEpochMs, phaseSchedule }` | On connect. Lets the client align its clock and project locally (§4.5). |
| `snapshot` | Full `PetState` + generation metadata + `phaseSchedule` refresh | On connect, and every 30s as reconciliation. |
| `care` | `{ action, caretaker, applied, needsAfter, tick }` | Every care action, by anyone. Drives the attributed toast. |
| `milestone` | `{ kind, detail }` — `HATCHED` (detail carries the voted name), `EVOLVED`, `BECAME_SICK`, `RECOVERED`, `CRITICAL`, `SLEPT`, `WOKE`, `DIED` | System events. |
| `minigame` | `{ phase: start\|score\|finish, caretakerName, score?, applied? }` | The live Dust Dash spectacle (SPEC §13.3). |
| `presence` | `{ count, caretakers[] }` | Throttled to at most once per 2s. |
| `react` | `{ emoji, caretaker }` | Emoji reactions. |
| `:ping` | comment frame | Every 15s. Keeps intermediaries from reaping an idle stream. |

### 7.3 Cloudflare Considerations

The stream sets `Content-Type: text/event-stream`, `Cache-Control: no-cache,
no-transform`, `Connection: keep-alive`, and `X-Accel-Buffering: no`. A
Cloudflare cache rule bypasses `/api/*` entirely (§19). The 15s heartbeat
keeps the connection under Cloudflare's idle timeout. Compression is disabled
on this route — a buffering compressor would defeat streaming.

### 7.4 Client Reconciliation

The client keeps the last authoritative state and its tick, and runs
`project()` locally each frame to animate needs draining.

Every state-bearing message carries its tick, and ordering is enforced by the
client: a `snapshot` or `care` event older than the client's current
authoritative tick is discarded (SSE delivery and the 30s snapshot cadence
can interleave — a stale snapshot must never rewind the meters). Remote
`care` events — everyone's, not just the local actor's — are applied through
the same `reduce()`, so other people's actions move the meters immediately
rather than at the next snapshot. The local actor's own actions apply
optimistically and are corrected by the next non-stale snapshot if the server
disagreed. Hard resets happen only on non-stale snapshots.

Clock skew is handled by tracking the offset between the local clock and the
`serverTick` in `hello`, refreshed on every snapshot. The client never trusts
its own wall clock in absolute terms.

---

## 8. Identity, Rate Limiting, and Abuse

### 8.1 The Caretaker Cookie

First request without a valid cookie mints a caretaker:

```
mgc_ct = <caretakerId>.<HMAC-SHA256(caretakerId, CARETAKER_SECRET)>
HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=1 year
```

No login, no email, no PII. The HMAC makes the ID unforgeable, so contribution
totals, cooldowns, and streaks cannot be spoofed by editing a cookie.

The `caretakers` document is designed so an Authentik `sub` can be attached
later as an optional field, with a verified badge — additive, not a rewrite.

### 8.2 Rate Limiting

Redis token buckets, checked in order, cheapest first:

| Scope | Limit | Catches |
| --- | --- | --- |
| Per IP (`CF-Connecting-IP`) | 60 requests / min | Cookie-clearing loops, crude floods |
| Per caretaker | 30 actions / min | Ordinary abuse |
| Per caretaker per action | The cooldowns in §2.5 | Game pacing |
| Global per action | The cooldowns in §2.5 | Crowd pacing |

Exceeding a limit returns `429` with `Retry-After`. Exceeding a *cooldown*
returns `409` with the remaining time — a different thing, and the UI says so
differently ("Makoto is still eating", not "slow down").

### 8.3 Connection Limits

Max concurrent SSE streams per IP (default 5), so one client cannot pin
resources by opening hundreds of streams. Exceeding it returns `429`.

### 8.4 Trusting Client Input

Nothing from the client is trusted beyond the action name. Magnitudes,
timestamps, and resulting state are computed server-side by `src/sim` and
never read from the request. Every request body is parsed by a zod schema at
the boundary; a parse failure is a `400`, never a coercion.

### 8.5 Nicknames

Optional, 2–16 characters, `[\p{L}\p{N} _-]` only, NFKC-normalised, uniqueness
enforced case-insensitively, screened against a blocklist. Rendered as text
nodes — never as HTML, never via `dangerouslySetInnerHTML`. Changeable once
per 24h.

---

## 9. HTTP API

All handlers are Next.js App Router route handlers under `src/app/api/`.
All request bodies are zod-validated. All responses are typed.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/stream` | SSE. §7. |
| `GET` | `/api/state` | One-shot current state. For first paint and for clients without `EventSource`. |
| `POST` | `/api/care` | `{ action }` → performs a care action. `200` / `409` (illegal or cooling down) / `429` (rate limited). |
| `POST` | `/api/react` | `{ emoji }` → broadcasts a reaction. |
| `GET` | `/api/leaderboard` | `?window=today|week|all|generation` |
| `GET` | `/api/memorial` | Paginated past generations. |
| `POST` | `/api/nickname` | `{ nickname }` → sets or changes it. |
| `POST` | `/api/name-vote` | `{ propose? , voteFor? }` → naming vote during incubation. |
| `GET` | `/api/push` | VAPID public key + this caretaker's subscription status. |
| `POST` | `/api/push` | Stores a Web Push subscription. |
| `DELETE` | `/api/push` | Removes one by endpoint. |
| `GET`/`POST` | `/api/shop` | Catalog + balance; buy an item or switch the worn cosmetic. |
| `POST` | `/api/play` | Minigame protocol: `start` / `score` / `finish` (SPEC §13.3). |
| `GET` | `/health` | `{ status: "ok" }` — liveness/readiness. Never touches the database. |
| `GET` | `/ready` | Verifies Mongo and Redis reachability. Readiness probe. |

`/health` deliberately does not check dependencies: a liveness probe that
fails on a transient database blip causes a restart loop that makes the outage
worse. `/ready` is where dependency checks belong.

---

## 10. Render Engine

`src/game/` — a small, dependency-free Canvas2D engine. No Pixi, no Phaser.
The scene is one room with one pet, some particles, and floating toasts; a
purpose-built ~500-line engine is less code than the glue a framework would
need, and it is fully unit-testable.

### 10.1 Modules

| File | Purpose |
| --- | --- |
| `engine/loop.ts` | Fixed-timestep accumulator driving `update(dt)` at a constant rate, decoupled from `render(alpha)` on `requestAnimationFrame`. Pauses on `visibilitychange`. |
| `engine/atlas.ts` | Sprite atlas: loads the sheet with retry, exposes named frames, blits them with integer-snapped bottom-center anchoring. |
| `engine/particles.ts` | Pooled particle system — dust puffs, sparkles, hearts, Zs, crumbs. |
| `anim/machine.ts` | Declarative animation state machine: `animKey → clip`, with transition rules, one-shot clips that return to idle, and interruption priorities. Pure and unit-tested. |
| `anim/clips.ts` | Clip definitions: frame list, frame duration, loop mode. |
| `scene/room.ts` | Composes the scene from state. |
| `scene/toasts.ts` | Floating attributed action toasts. |

### 10.2 The Atlas

The original `configuration.ts` contains hand-typed sprite rectangles that do
not match the actual sheet layout — a maintenance trap and a source of visual
bugs. A single hand-laid sheet has the same problem in art form: adding a
sprite means editing one big PNG without disturbing its neighbours.

Instead, every frame is its own file under `art/<category>/<name>.png`, and
`scripts/atlas.ts` **packs** them: frames are shelf-packed in deterministic
`(category, name)` order into the served sheet, and a typed
`atlas.generated.ts` (frame name → rectangle) is emitted alongside a
contact-sheet PNG for visual verification. Adding a sprite is dropping a file
into `art/` and re-running `npm run atlas`. The generated module is committed
(so the build needs no image processing), and a duplicate frame name across
categories is a build error.

The served sheet is **content-hashed**: the packer writes
`public/sprites.<hash>.png`, prunes stale sheets, and emits
`SPRITE_SHEET_URL` in `atlas.generated.ts` — the only way client code may
reference the sheet. Frame rectangles and the pixels they index therefore
ship inside the same bundle and can never go stale against each other; a
repack that shifts coordinates changes the URL too. `next.config.ts` serves
the hashed name with `public, max-age=31536000, immutable`. (This contract
exists because its absence bit in production: a repacked unhashed
`/sprites.png` sat in browser caches for four hours while the new bundle's
coordinates read garbage out of it.)

Two source formats coexist, told apart by filename. `name.png` is native
resolution, packed as-is — the original sheet's frames, extracted losslessly.
`name@1x.png` is on the logical pixel grid (one image pixel per art pixel)
and is upscaled ×5.5 at pack time with cell boundaries at `round(i × 5.5)`,
reproducing the hand-drawn sheet's alternating 5/6-device-pixel cadence. New
art is authored `@1x`: the files are tiny, git-diffable, and editable in any
image editor.

### 10.3 Pixel Fidelity

`imageSmoothingEnabled = false`, integer scale factors only (the canvas picks
the largest integer scale that fits the viewport), and all draw positions
snapped to whole device pixels. Backing store sized to
`devicePixelRatio` so the art is crisp on phones.

### 10.4 Motion and Accessibility

`prefers-reduced-motion` disables particles, reduces the animation to a static
pose per state, and removes toast motion. The canvas carries
`aria-hidden="true"` — it is decorative, and every piece of information it
conveys is also present as semantic HTML (§11.3).

---

## 11. User Interface

### 11.1 Routes

| Route | Contents |
| --- | --- |
| `/` | The pet. The whole game. |
| `/memorial` | The wall of past generations. |
| `/leaderboard` | Full rankings. |
| `/about` | What this is, how it works, how to help. |

### 11.2 The Main Screen

```
┌───────────────────────────────────────────────┐
│  Makoto · 4d 6h · JUVENILE      👥 7 watching │
├───────────────────────────────────────────────┤
│                                               │
│              [ the room, canvas ]             │
│                                               │
│              +18.8% 🍖 fed by Emilio  ↑fading │
├───────────────────────────────────────────────┤
│  🍖 Hunger  ████████░░  82%                   │
│  ⚡ Energy  ██████████  97%                   │
│  ✨ Hygiene ████░░░░░░  41%                   │
│  💛 Joy     ███████░░░  68%                   │
│  ❤️ Health  ██████████ 100%                   │
├───────────────────────────────────────────────┤
│  [Feed] [Play] [Clean] [Medicate] [Pet]  😊💛 │
│   45s      ✓      ✓      n/a       ✓          │
└───────────────────────────────────────────────┘
```

- Action buttons show live cooldowns and disable with a *reason* on hover and
  in an accessible label: "Makoto is still eating (23s)", "Makoto is asleep",
  "Makoto isn't sick".
- Meters animate continuously via client-side projection, not in server-push
  jumps.
- The action feed is both a visual toast in the canvas and an entry in an
  `aria-live="polite"` log.

### 11.3 Accessibility

The canvas is decorative. Everything it shows exists in the DOM:

- Meters as `role="meter"` with `aria-valuenow` / `aria-valuetext`.
- The pet's current state as text (`Makoto is asleep`, `Makoto is sick`).
- The action feed as an `aria-live` region.
- All controls keyboard-operable with visible focus rings.
- Colour is never the only carrier of meaning — critical needs get an icon and
  text, not just red.

### 11.4 Mobile

This will mostly be opened on phones. The layout is designed mobile-first:
single column, canvas sized to the viewport at an integer scale, action
buttons in a thumb-reachable row, no hover-only affordances.

### 11.5 Audio

Short chiptune SFX per action, an ambient room loop, and a distinct alert
sound for `CRITICAL` and `DIED`. Muted by default with a persistent toggle —
autoplay is hostile and browsers block it anyway. Implemented on the Web Audio
API directly; no audio library.

### 11.6 Styling

Tailwind CSS v4 with a small token layer in `globals.css`. A pixel-art
typeface for headings, a legible system stack for body text. Dark by default,
with a light theme honouring `prefers-color-scheme`.

---

## 12. Web Push

The highest-leverage retention mechanic: the pet gets sick at 2pm on a
Tuesday and the people who care get told.

- Standard Web Push with VAPID keys. No third-party service.
- Opt-in only, behind an explicit button — never an on-load permission prompt.
- Service worker at `public/sw.js`, registered lazily after first interaction.
- Subscriptions stored per caretaker; a `410 Gone` from the push service
  prunes the subscription.
- **Triggers:** `BECAME_SICK`, any need crossing `CRITICAL_THRESHOLD`
  downward, `health < 25%`, `DIED`, `HATCHED`, `EVOLVED`.
- **Throttling:** at most one push per caretaker per 30 minutes, and each
  trigger uses hysteresis: after firing, it re-arms only once the underlying
  value has recovered past `CRITICAL_THRESHOLD + 5000` and stayed there for
  30 minutes. A genuine relapse re-notifies; oscillation around the boundary
  cannot. Notification fatigue kills opt-in rates faster than anything else.

---

## 13. Economy and Minigame

In scope for v1, built last (Phase 8) once the core loop is proven.

### 13.1 Coins

Caretakers earn coins for care actions, weighted by how *needed* the action
was — feeding a starving pet pays more than feeding a full one. This is the
same diminishing-returns curve as §2.6, so the incentive points at the pet's
actual need rather than at button-mashing.

Bonuses: daily streak, being present at a hatch or an evolution, and being a
top-3 caretaker at a generation's end.

### 13.2 Shop

| Category | Items |
| --- | --- |
| Food | Better food restores more hunger and adds a small joy bonus. Consumed on use. |
| Medicine | Cures `SICK` instantly with no cooldown. Consumed. |
| Toys | Raise the `PLAY` base magnitude. Permanent for the generation. |
| Cosmetics | Hats and accessories for the pet. Permanent, cross-generation. |
| Room decor | Community-funded upgrades to the room, visible to everyone. Permanent. |

Cosmetics and decor are the interesting sink: they are **visible to everybody**,
which turns spending into a form of contribution rather than a private
inventory.

### 13.3 Minigames

`PLAY` launches a short skill game from a five-game roster, picked at random
per run (a `?game=` query pins the choice — for sharing a favourite and for
deterministic e2e runs). The player's score determines the joy restored and
the coins earned. While a run is live, every other connected client sees the
pet playing and the live score — spectating is the point, and it is the
reason this is a realtime feature rather than a solo one. One run exists at a
time, world-wide, by design.

| Game | Play | Beats |
| --- | --- | --- |
| Dust Dash | 20s runner: hop the dust bunnies | one point per cleared bunny; collision ends the run |
| Snack Catch | 25s: steer under falling food, dodge junk | +1 per snack, −3 for junk |
| Bubble Bath Pop | 25s: pop the bath bubbles before they escape | +1 per pop |
| Simon Squeaks | memory: repeat Makoto's pose sequence on four pads | +1 per completed round; a miss ends the run |
| Wheel Sprint | 30s rhythm: tap as the spark crosses the wheel's top | +1 per on-beat hit |

Each game is scored client-side but validated server-side against a
**per-game plausibility envelope** (`src/sim/minigames.ts`: max duration, max
score, max score per second, minimum inputs per point), because a fully
authoritative implementation is disproportionate for a friends' toy while an
unbounded client score is not acceptable either. The chosen game is fixed at
`start` and stored in the server's session, so a client cannot start a cheap
envelope and finish an expensive one; per-game curves translate the score
into the `PLAY` performance multiplier (50–150) and the coin payout.

---

## 14. Repository Layout

```
Makotogotchi/
├── SPEC.md                     # this document — source of truth
├── README.md
├── Dockerfile
├── .dockerignore
├── next.config.ts              # output: "standalone"
├── tsconfig.json               # strict, "@/*" → "src/*"
├── eslint.config.mjs           # flat config + layer-boundary rules
├── vitest.config.ts
├── playwright.config.ts
├── postcss.config.mjs
├── package.json
├── instrumentation.ts          # boots the engine + tick loop at server start
├── .github/workflows/
│   ├── ci.yml                  # typecheck · lint · unit · build · e2e
│   └── docker-publish.yml      # ghcr.io/reclyptor/makotogotchi
├── art/                        # one PNG per frame (SPEC §10.2)
│   ├── pet/                    # pet poses and expressions
│   ├── food/                   # meal and snack items
│   └── games/                  # minigame props
├── scripts/
│   ├── atlas.ts                # packs art/ into the sheet + typed atlas
│   └── cloudflare-setup.sh     # idempotent edge config (SPEC §19.3)
├── e2e/                        # Playwright suite + dockerized-store stack
├── public/
│   ├── sprites.<hash>.png      # packed atlas, content-hashed, generated
│   └── sw.js                   # push service worker
└── src/
    ├── sim/                    # PURE simulation core (SPEC §4) + economy.ts
    ├── server/
    │   ├── db/                 # mongo client, collections, repository
    │   ├── redis/              # client, write lock, leader lease
    │   ├── engine/             # engine (serialized write path), lifecycle, messages
    │   ├── push/               # subscriptions store, dispatcher, sender
    │   ├── stream/             # SSE fanout hub (one Redis sub per pod)
    │   ├── env.ts identity.ts ratelimit.ts presence.ts http.ts
    │   ├── social.ts votes.ts shop.ts snapshot.ts schedule.ts
    │   └── runtime.ts testsetup.ts
    ├── game/                   # canvas engine, anim machine, room scene, audio
    └── app/                    # Next.js App Router
        ├── layout.tsx page.tsx globals.css
        ├── memorial/ leaderboard/ about/
        ├── health/ ready/
        ├── api/                # care state stream react nickname leaderboard
        │                       # memorial name-vote push shop play
        ├── hooks/              # usePetStream (client reconciliation, SPEC §7.4)
        └── components/         # GameView PetCanvas Meters ActionBar FeedLog
                                # VotePanel NicknameEditor PushToggle ShopPanel
                                # DustDash
```

---

## 15. Configuration

Every value is read once at startup through a zod-validated config module that
**fails fast** — a missing or malformed variable crashes the process on boot
rather than producing an undefined at 3am.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | yes | Includes credentials and `authSource`. |
| `MONGODB_DB` | no (`makotogotchi`) | Database name. |
| `REDIS_URL` | yes | Includes password. |
| `REDIS_DB` | no (`0`) | Logical DB index. |
| `REDIS_PREFIX` | no (`mgc:`) | Key namespace. |
| `CARETAKER_SECRET` | yes | HMAC key for the caretaker cookie. |
| `VAPID_PUBLIC_KEY` | for push | Web Push. |
| `VAPID_PRIVATE_KEY` | for push | Web Push. |
| `VAPID_SUBJECT` | for push | `mailto:` contact. |
| `PET_TIMEZONE` | no (`America/Chicago`) | Day/night boundary. |
| `PORT` | no (`3000`) | |
| `NODE_ENV` | yes | |

No secret is ever read directly from `process.env` outside that module, and no
secret is ever exposed to the client. Only `NEXT_PUBLIC_`-prefixed values
reach the browser bundle, and there are none that are sensitive.

---

## 16. Testing Strategy

### 16.1 Unit — `src/sim` (the bulk of the coverage)

No database, no network, no fake timers, no mocks. Pure functions in, exact
values out.

- Every event variant through `reduce`.
- Every action through `validate` in every legal and illegal state.
- Bounds: no need ever leaves `[0, NEED_MAX]`, under any sequence.
- Exhaustiveness: adding an event variant fails to compile until handled.

### 16.2 Property — the invariants that protect the design

```
projection is path-independent:
    project(project(s, a, ctx), b, ctx) === project(s, b, ctx)  ∀ a ≤ b
replay is deterministic:
    fold(reduce, genesis, log in seq order) is identical across processes
needs are bounded:
    ∀ state reachable by any event sequence: 0 ≤ need ≤ NEED_MAX
diminishing returns are monotone:
    higher current value ⇒ smaller applied magnitude
the difficulty dial holds (both paths, on pinned seeds):
    pure neglect — a full PUP untouched from WAKE_HOUR on a sickness-quiet
    seed reaches CRITICAL hunger in 28–32h and starves in 42–52h
    with illness — on a seed that onsets sickness mid-abandonment, death
    accelerates into the 36–44h band, never faster
a lone caretaker can rescue:
    a greedy-optimal bot (acts the moment cooldowns and budget permit,
    choosing the action with max marginal health benefit) brings a starving
    pet to "all needs ≥ CRITICAL and health rising" in under 30 min
a lone caretaker cannot sustain:
    the same bot, alone, cannot keep the mean of needs ≥ 50% across
    pet-days 2–8 of a generation
```

The last three encode §1.2's design goals as executable assertions — with the
caretaker strategy pinned to a defined optimal bot, so the properties are
decidable rather than aspirational. They are the reason the tuning constants
can be changed safely. Measured values on the committed seeds: critical at
30.1h, pure-neglect death at 45.6h, sickness-path death at 41.1h.

### 16.3 Golden Files

A fixed event log with a fixed seed replays to a byte-identical serialised
state, checked against a committed fixture. Any unintended change to game
rules breaks this test loudly.

### 16.4 Integration — `src/server`

`mongodb-memory-server` and a real Redis (testcontainers, or the cluster's
Redis against a scratch DB index in local dev):

- Snapshot + event-log recovery reproduces exact state after a simulated
  crash.
- Leader lease: two engines, one leader, clean handover on expiry, zero drift
  across the gap.
- Rate limiter behaviour at the boundaries.

### 16.5 End-to-End — Playwright

- Cold load → pet renders → feed → meter moves.
- Two browser contexts: A feeds, B sees the attributed toast without
  reloading.
- Cooldown UI reflects server state.
- Reconnect after a dropped stream.
- Keyboard-only traversal of every control.

### 16.6 The Bar

CI runs typecheck (strict), lint, unit, integration, and E2E. **A task is not
complete until all of them pass**, and nothing is committed in a broken state.

---

## 17. Build and CI

- **Next.js 16** App Router, **React 19**, **TypeScript strict**,
  **Tailwind CSS v4**, **vitest**, **Playwright**, flat ESLint config.
- `output: "standalone"` for a self-contained Docker server.
- Multi-stage `Dockerfile` on `node:24-alpine` (the project requires Node
  ≥24; SERAUI's *structure* is the convention being mirrored, not its Node
  version): deps → builder → production, non-root user, `HEALTHCHECK`
  against `/health`.
- `ci.yml`: typecheck · lint · unit · integration · E2E, on PR and on push to
  `master`.
- `docker-publish.yml`: builds and pushes `ghcr.io/reclyptor/makotogotchi`
  tagged `latest` and by SHA, multi-arch (`linux/amd64,linux/arm64`), with
  GitHub Actions layer caching and build-provenance attestation. Mirrors the
  SERAUI workflow, which is the established convention for this cluster.

---

## 18. Deployment

Target: the k3s cluster at `~/Projects/kubernetes`, reconciled by Flux from
`master` (`core → infra → apps`).

### 18.1 New Manifests — `apps/makotogotchi/`

| File | Contents |
| --- | --- |
| `namespace.yaml` | Namespace `makotogotchi`, Pod Security `baseline`. |
| `deployment.yaml` | 1 replica, pinned to `fluxeon` (matching `seraui`), `ghcr-secret` image pull, non-root, `envFrom` the SOPS secret, liveness on `/health`, readiness on `/ready`. |
| `service.yaml` | `ClusterIP` on port 3000. |
| `secrets/` | SOPS-encrypted `makotogotchi-secret.yaml` + the `ghcr-secret` patch, following the `seraui` pattern exactly. |
| `ciliumnetworkpolicy.yaml` | Ingress only from the `cloudflare` namespace on 3000. Egress to `mongodb`:27017, `redis`:6379, DNS, and the Web Push endpoints by FQDN — the push endpoints need `matchPattern` wildcards: `fcm.googleapis.com`, `*.push.services.mozilla.com`, `web.push.apple.com`, `*.notify.windows.com`. |
| `kustomization.yaml` | Ties them together. |

Plus one line added to `apps/kustomization.yaml`, **and amendments to
`infra/mongodb/ciliumnetworkpolicy.yaml` and
`infra/redis/ciliumnetworkpolicy.yaml`**: both whitelist ingress by explicit
`fromEndpoints` (plus `world`/`remote-node` entities, which in-cluster pod
traffic does *not* match — pods carry their own security identity), so
without adding `app: makotogotchi` from namespace `makotogotchi` on
27017/6379 respectively, every connection from the app is silently dropped.

### 18.2 Datastore Provisioning

- **Mongo:** create the `makotogotchi` database and a dedicated user with
  `readWrite` on it only — not a shared root credential.
- **Redis:** shared instance, dedicated logical DB index, all keys prefixed
  `mgc:` (§6.2).

Both credentials land in the SOPS-encrypted secret.

### 18.3 Rollout

Single replica means a brief gap during a rolling deploy. That is acceptable
and, importantly, *harmless*: the simulation is time-derived, so the pet
resumes exactly where it should be. Connected clients reconnect automatically
via `EventSource` backoff.

---

## 19. Cloudflare

Both `makotogotchi.com` and `makotogotchi.reclyptor.com` serve the same app through
the existing `cloudflared` tunnel (`414c90a2-c38a-46b2-9d6b-53670c4dfc3f`).

### 19.1 Prerequisite — API Token

Tunnel routes are currently managed by hand in the Cloudflare dashboard. To
automate this and keep it reproducible, a scoped API token is provisioned into
the existing SOPS/nix secret pipeline exactly like `github-token`:

1. **You** create the token at
   *Cloudflare → My Profile → API Tokens → Create Custom Token* with:
   - `Account → Cloudflare Tunnel → Edit`
   - `Zone → DNS → Edit` on both zones
   - `Zone → Zone Settings → Edit` on both zones
   - `Zone → Cache Rules → Edit` on both zones
   - `Zone → Zone WAF → Edit` on both zones (for the rate-limit rule)
2. **I** add it to `~/Projects/nixos`:
   - `secrets/secrets.yaml` → `bash.cloudflare-api-token` (via `sops`)
   - `modules/home/secrets.nix` → add `"bash/cloudflare-api-token"`
   - `modules/home/bash/00-init.nix` → export `CLOUDFLARE_API_TOKEN`
   - rebuild, verify the export appears in a fresh shell

This is the only step in the whole project that requires your browser.

### 19.2 Configuration to Apply

| Item | Value |
| --- | --- |
| Tunnel public hostnames | `makotogotchi.com`, `www.makotogotchi.com`, `makotogotchi.reclyptor.com` → `http://makotogotchi.makotogotchi.svc.cluster.local:3000` |
| DNS | Proxied `CNAME`s to the tunnel for each hostname |
| Cache rule | **Bypass cache** for `/api/*` — non-negotiable; a cached SSE stream is a broken SSE stream |
| Compression | Disabled on `/api/stream` (`no-transform` is set, and the rule enforces it) |
| Rate limiting | `/api/care` — 10 requests per 10s per IP (the free plan only permits 10s periods; same average rate as the server-side 60/min bucket) |
| Bot Fight Mode | **Off** for these zones (verified via the `bot_management` API — readable and settable with the token, contrary to earlier belief). Every visitor is anonymous by design; a bot challenge on the action endpoint would break the product. |
| Always Use HTTPS | On |
| Browser Integrity Check | Off on `/api/*` |

### 19.3 Automation

Once the token exists, the configuration is applied by a checked-in script
that is idempotent and re-runnable, so the Cloudflare state is reviewable in
git rather than living only in a dashboard.

---

## 20. Build Phases

Each phase ends with a green typecheck, lint, and test run, and a commit.
Nothing broken is ever committed. Phases 0–5 are the shippable core; 6–9
complete v1.

| # | Phase | Deliverable | Done when |
| --- | --- | --- | --- |
| **0** | Foundation | Repo scaffold, Next 16 / React 19 / TS strict / Tailwind 4 / vitest / Playwright / ESLint with layer rules, Dockerfile, both workflows, `/health`, `/ready`, SPEC.md | `typecheck`, `lint`, `test`, and `docker build` all pass |
| **0b** | Cloudflare token | Token minted by you, wired into `~/Projects/nixos` | `CLOUDFLARE_API_TOKEN` present in a fresh shell |
| **1** | Simulation core | All of `src/sim`, fully tested, zero I/O | §16.1–16.3 pass, including the difficulty-dial and caretaker-bot tests |
| **2** | Persistence + engine | Mongo repos, Redis, leader lease, write lock, `seq`, tick loop, snapshots, recovery | §16.4 passes; a killed and restarted engine reproduces exact state; parallel care writes produce a totally ordered, replay-identical log |
| **3** | API surface | Identity, rate limiting, `/api/care`, `/api/stream`, presence | Two `curl` clients see each other's actions live |
| **3b** | Thin-slice deploy | Image from Phase 0's Dockerfile, minimal manifests + infra CNP amendments, one tunnel hostname, SSE soak test through Cloudflare | A `curl` SSE stream through the real edge stays alive ≥ 30 min with heartbeats intact |
| **4** | Render engine | Atlas generation script, canvas engine, animation machine, room scene | The pet visibly lives on screen; animation machine unit-tested |
| **5** | Game UI | Meters, actions with cooldowns, live feed, presence, mobile, a11y, audio | Playwright E2E green; QA pass on a real phone |
| **6** | Social | Leaderboards, streaks, nicknames, memorial wall, naming vote | E2E covers each |
| **7** | Web push | VAPID, service worker, subscriptions, triggers, throttling | A real notification arrives on a real phone |
| **8** | Economy + minigame | Coins, shop, cosmetics, room decor, spectated minigame | E2E covers earn → spend → visible-to-others |
| **9** | Productionize | Full manifests, Mongo/Redis provisioning, SOPS secrets, Cloudflare automation, both domains | Live on both domains, verified end to end |

Phase 0b runs in parallel with Phase 1 since it is gated on you, not on code.

Phase 3b exists because the riskiest external integration — SSE behaviour
through cloudflared and the Cloudflare edge (buffering, idle timeouts, the
cache rule) — must be validated *before* the entire client pacing model is
built on top of it, not at the end when changing course is expensive.

---

## 21. Liveliness and Community Program

Nine features that deepen the two feelings this app exists for: *it is
alive*, and *it is ours*. They are specified together because they share
machinery — deterministic seeding, the seq event log, the SSE fan-out, the
sprite pipeline — but they land in five independent phases (§21.10), each
individually shippable. Nothing here changes the core simulation contract
(§4): every sim-visible addition folds through the event log exactly like
care actions do, and every presentation-only addition is derived
deterministically from data every client already has.

### 21.1 Greeting of the Day (presentation only)

The `greeting` one-shot clip (pekori bow) exists and is never triggered.
On GameView mount, when the pet is awake, born, and alive, and
`localStorage["mgc:last-greet"]` differs from the current date in the pet's
timezone (the server already exposes the timezone via the schedule context),
the client triggers the `greeting` one-shot after the atlas is ready (delay
~1s so it lands on the settled room) and writes today's date back. Reduced
motion suppresses nothing here — the machine already pins one-shots to their
first frame.

No server involvement, no message types. The bow is the pet greeting *this
caretaker*; it is deliberately not broadcast.

### 21.2 Crowd Moments (presentation only)

Presence messages already carry `count`. When a client observes `count`
rise to ≥ 3 from below (rising edge, not level), the room celebrates: the
`celebrating` one-shot plus heart particles, and a toast "a crowd gathers!".
Throttle: at most once per 10 minutes per client (module-scope ref;
localStorage unnecessary). Reduced motion skips particles as usual.

### 21.3 Per-Game Records (server + UI)

A new Mongo collection `records` stores the best plausible finish per game
and scope: `{ gameId, scope: "alltime" | "weekly", weekKey, score,
caretakerId, at }` with a unique index on `(gameId, scope, weekKey)` —
`weekKey` is `""` for all-time and the ISO week (`YYYY-Www`, computed in
the pet's timezone) for weekly. On a plausible `/api/play` finish, after
`creditCoins`, the route compares-and-swaps the two records (`findOneAndUpdate`
with a `$lt` guard on score — atomic, no lock needed). A newly set record
publishes a new `record` engine message `{ type: "record", game, scope,
score, caretakerId, caretakerName }`, which clients surface in the feed
("🏅 X set the Dust Dash record — 17!") and celebrate via the existing
minigame-finish path.

`GET /api/records` returns both scopes for all five games with holder
nicknames resolved (same `nicknameMap` pattern the leaderboard uses). UI: a
"Records" section inside the existing leaderboard panel — five rows, each
`game title · weekly best (holder) · all-time best (holder)`, using the
Shop panel's aligned-row layout conventions.

Weekly reset needs no job: a new week produces a new `weekKey`, and the
query for "this week" simply finds nothing yet.

### 21.4 Generational Quirks (sim)

Each generation has a personality derived deterministically from its seed —
never stored, never voted, discovered through play:

```
quirks(seed) = {
  favoriteFood:  rng(seed, 0, "quirk-fav-food")  over FOOD_ITEM_IDS,
  dislikedFood:  rng(seed, 0, "quirk-bad-food")  over FOOD_ITEM_IDS \ favorite,
  favoriteGame:  rng(seed, 0, "quirk-fav-game")  over MINIGAME_IDS,
}
```

implemented in `src/sim/quirks.ts` (pure, unit-tested: same seed → same
quirks; favorite ≠ disliked). `FOOD_ITEM_IDS` are the shop's food item ids.

Effects, all folded in the sim so every client and the server agree:
- **FEED with the favorite food**: `applied` gains ×1.25 before the
  diminishing-returns curve; clients that see the care message for a
  favorite-food feed play `eating` followed by heart particles (the
  favorite is recomputable client-side from the generation seed, which the
  state stream already carries).
- **FEED with the disliked food**: ×0.75, and the client plays the
  `unhappyEat` frames instead of `eating`.
- **Favorite minigame**: the coin payout for a plausible finish gains +25%
  (rounded); the server computes this in `/api/play` from the same pure
  function.

The item id must therefore reach the reducer: the FEED care event context
gains an optional `itemId` (already plumbed for toy bonuses — follow that
pattern; if FEED currently has no item identity, extend the care POST body
and CareEvent the same way `toyBonus` traveled). Quirk multipliers live in
`src/sim/economy.ts` beside the existing curves.

The memorial records each generation's quirks when it ends ("loved pizza,
hated peppers, was best at Wheel Sprint") — the memorial write path gains
the three fields, computed at death from the seed.

### 21.5 Shared Rare Events (sim tick + presentation)

Roughly once an hour, something small and delightful happens — for
everyone at the same moment, which is the entire point. In the leader's
tick loop: `rng(seed, tickIndex, "ambient") < 1/360` (ticks are 10s → one
event per hour on average) selects an event from a weighted table filtered
by context:

| Event | Context | Weight |
| --- | --- | --- |
| `shooting-star` | pet asleep (night) | 3 |
| `butterfly` | awake, daytime | 3 |
| `coin-dig` | awake | 2 |
| `mystery-noise` | any | 1 |

The event is a **milestone-class event** appended to the log
(`MILESTONE` kind `AMBIENT` with `detail` = event name) so it replays, then
fans out over the existing milestone message path. No economy effect —
`coin-dig` is Makoto finding *its own* shiny thing (the feed says so); the
moment is the reward, and keeping it material-free keeps the log fold
trivial.

Clients render a ~6s overlay in the room: shooting star = a two-pixel
streak tweened across the night sky (procedural, particles system);
butterfly = a new 2-frame `@1x` sprite fluttering a sine path; coin-dig =
Makoto plays `dustbath` frames with gold sparkle particles and a feed entry
"✨ Makoto dug up something shiny!"; mystery-noise = the room dims 10% for a
beat, pet plays `earTwitch`, "…did you hear that?" in the feed. Reduced
motion: feed entry only.

### 21.6 Spectator Cheering (wiring only)

During a live spectacle, reactions become crowd noise inside the player's
game. The Shell (which owns the dialog) subscribes to `onReact` while phase
is `playing` and floats incoming emoji up over the game canvas — a DOM
overlay (absolutely positioned spans with the existing `rise` animation),
never touching the game components. The existing reaction bar and its rate
limit are unchanged; spectators simply see the pill and use the bar they
already have. Cap the overlay at 6 concurrent floaters; excess drops
silently.

### 21.7 Daily Communal Quest (server + sim-adjacent)

One shared goal per pet-day, derived deterministically:
`quest(seed, dayIndex)` — `dayIndex` = days since genesis in the pet's
timezone — picks from a table in `src/sim/quests.ts` (pure, tested):

| Quest | Target | Measured by |
| --- | --- | --- |
| Full bellies | every meter ≥ 70% at the evening check (1h before sleep) | projection at the check tick |
| Game night | combined minigame score ≥ 40 today | sum of plausible finishes |
| Many hands | ≥ 4 distinct caretakers perform care today | distinct caretakerIds in today's care events |
| Feast day | ≥ 10 FEEDs today | count of FEED events |

Progress is **computed, not stored**: `GET /api/quest` derives progress by
scanning today's slice of the event log (bounded — one pet-day of events)
plus, for Full bellies, a projection. The leader's tick loop performs the
completion check (on every tick for count-quests once the threshold could
be met; at the check tick for Full bellies) and, on completion, appends a
`MILESTONE` kind `QUEST_DONE`, credits every caretaker who contributed
today +15 coins (`creditCoins` over the day's distinct contributors), and
the milestone message triggers feed + `celebrating` on every client.
Completion must be idempotent: the `QUEST_DONE` milestone for a given
`dayIndex` is appended at most once (guard: scan-back or a `questDone`
marker keyed by day in Mongo — prefer the marker, unique index on dayIndex).

UI: a slim glass banner between the meters and the action bar — quest text
and a progress fraction ("Game night — 26/40"), sourced from `/api/quest`
on load and nudged by relevant SSE messages (recompute lazily; exactness
between refreshes is not required). Completed state: gold check + "done!
+15 🪙 to today's caretakers".

### 21.8 Co-op Purchases (server + UI)

Grand decor items too expensive for one caretaker, funded communally. New
shop category `grand` with three items (window seat 500, aquarium 650,
kotatsu 800 — rendered procedurally in `renderDecor` like existing decor,
each with one small ambient touch: aquarium bubbles, kotatsu glow).

New collection `funding`: `{ itemId, pooled, contributors: { [caretakerId]:
amount } }`. `POST /api/shop/contribute { itemId, amount }` — amount ∈
{10, 50, all-remaining}; deducts the caretaker's coins and `$inc`s the pool
atomically; over-contribution beyond the price is clamped with the excess
refunded. When `pooled ≥ price`, the item becomes communal decor through
the existing decor-placement path, a `MILESTONE` kind `FUNDED` (detail =
itemId) fans out, the feed lists the top three contributors, and everyone's
room celebrates. A funded item's pool row is retained for the memorial
(generations remember who built the room).

UI: a "Together" section in the Shop panel — item row + progress bar
(`pooled/price`) + two press buttons (+10, +50). Contributions are
non-refundable; the section says so in one quiet line.

### 21.9 Visible Growth (presentation + art)

Life stages already exist in the sim (`stage` in the derived state); the
pet just never looks different. Presentation-layer only:

- **HATCHLING**: drawn at 80% scale (the room's draw call gains a
  stage-driven scale factor; bottom-center anchor unchanged).
- **JUVENILE**: 90%.
- **ADULT**: 100% (today's look).
- **ELDER**: 100% plus a new `@1x` accessory sprite — gray brow tufts —
  drawn at the head anchor like cosmetics are (stacking under any worn
  cosmetic).

The stage scale applies everywhere the room draws the pet (idle, wander,
one-shots). Minigames keep drawing the adult frames — the game canvas is a
caricature, and a 36px runner does not need life stages. New sprites go
through the §10.2 pipeline (`art/pet/elderBrows@1x.png`).

### 21.10 Delivery Phases

Same rules as §20: each phase ends with green typecheck/lint/tests (and
e2e where it touches flows), one commit per seam, nothing broken ever
committed.

| # | Phase | Features | Done when |
| --- | --- | --- | --- |
| **L1** | Free wins | §21.1 greeting, §21.2 crowd moments, §21.3 records | records survive an e2e minigame run; greeting fires once per day in a fresh context |
| **L2** | Personality | §21.4 quirks, §21.5 rare events | quirks unit-tested pure; an AMBIENT milestone replays identically after engine restart |
| **L3** | Spectacle + growth | §21.6 cheering, §21.9 stages | cheer emoji visibly float over a live game in e2e; stage scale asserted in a render test |
| **L4** | Communal quest | §21.7 | quest completes idempotently under a restarted leader; contributors credited exactly once |
| **L5** | Co-op purchases | §21.8 | e2e: two caretakers fund an item, it appears in both rooms, coins deducted correctly |


---

## 22. The Living Room

The room is the second character in this app. Until now it was three flat
rectangles and a rug; this section specifies it as a real place — one that
tells you the hour, the weather, the season, and how Makoto is doing,
before you read a single meter.

Two constraints govern everything here. **It is shared**: every viewer,
anywhere on earth, sees the same room in the same state at the same
instant, so every input is either the pet's own clock or a seeded draw —
never the viewer's local time or private randomness. **It is
presentation**: none of this touches `PetState` or the event log. The
backdrop is derived, exactly like the animation key is (§4.3).

### 22.1 Atmosphere Inputs (pure)

`src/sim/atmosphere.ts` is pure and unit-tested, and derives four values:

| Input | Source | Notes |
| --- | --- | --- |
| **Day progress** | the pet's local wall clock (`PET_TIMEZONE`, already streamed to clients) | continuous `0..1` over the pet-day; drives the sky and the sun's arc |
| **Segment** | day progress | `night · dawn · morning · midday · afternoon · dusk`, each with a transition window into the next |
| **Weather** | `draw32(seed, dayIndex, RNG_PURPOSE.weather)`, season-weighted | one forecast per pet-day: `clear · cloudy · rain · snow` |
| **Season** | the pet's local month | `spring · summer · autumn · winter` |

Weather weights are season-dependent: snow only in winter, rain heaviest
in spring and autumn, clear dominant in summer. A day's forecast is fixed
the moment its `dayIndex` turns over, so two caretakers a continent apart
discuss the same rain.

### 22.2 The Sky

The window is the room's light source and its clock. The sky is drawn as
horizontal bands from a per-segment ramp of three hue-shifted colors
(zenith, middle, horizon), and **transitions dither**: during the window
between two segments, the outgoing and incoming ramps are mixed with an
ordered Bayer threshold whose cutoff follows the transition's progress, so
dawn arrives as a dissolve rather than a cross-fade. This is the one place
in the codebase where dithering is correct — a large-area gradient, low
contrast, adjacent ramp values only (§22.6).

Above the bands sit, in order: stars (night only, positions seeded per
generation, twinkle on a slow phase), the celestial body (sun by day, moon
by night, both riding an arc across the pane whose position is day
progress), clouds (drifting on wall-clock time; count and colour from the
weather), and the weather overlay itself (§22.4).

The sky is expensive to compose and changes slowly, so it renders to an
offscreen canvas keyed by `(segment, transition step, weather, season,
theme)` and is blitted per frame. Only the moving elements — clouds,
twinkle, rain, snow — redraw each frame.

### 22.3 Architecture of the Room

Drawn back to front, all in the theme's palette (§22.5):

1. **Wall** — a two-value hue-shifted ramp with a subtle vertical
   wallpaper stripe, brightest near the window and falling off with
   distance (the window is the light source; the wall is never flat).
2. **Picture rail** and **wainscot panelling** below it, each a 1px
   highlight over a darker body — the horizon line of the room.
3. **Window** — frame, mullions, sill, and the sky behind it (§22.2). It
   sits off-centre on the back wall so the light is directional.
4. **Floorboards** — seams converging slightly toward the back wall for
   depth, board widths varied so the pattern never reads as a grid.
5. **Light pool** — a trapezoid of warmer floor cast from the window,
   its length and intensity following the sun's height; at night the pool
   is cool and faint, or warm if the room owns a lamp.
6. **Rug** — a woven pattern with fringe, not a rectangle, centred under
   the pet's wander band.
7. Existing communal decor and grand items draw over the architecture as
   they do today. `window_seat` no longer draws its own window: it
   **upgrades** the room's window with a cushioned bench and a wider
   frame.

### 22.4 Weather and Season

Weather renders inside the window and, sparingly, in the room:

- **clear** — one or two small clouds; the light pool is at full strength.
- **cloudy** — an overcast band across the upper pane, sky desaturated one
  step, light pool dimmed.
- **rain** — diagonal 1px streaks over the pane at a consistent angle,
  overcast sky, and slow droplets tracking down the glass; the room takes
  a cool tint.
- **snow** — flakes drifting on sine paths, brightest sky of the four, and
  a thin band of settled snow on the outside sill.

Season sets what is visible beyond the glass: blossom pink in spring, deep
green summer, ochre autumn with drifting leaves, bare branches and a
lowered sun in winter. It also nudges the sky ramps — a summer midday sits
higher and warmer than a winter one.

### 22.5 Themes

The room's palette and outside view come from a **theme**. The default
theme (`cozy`) ships to everyone. Further themes are communal grand items
in the shop (§21.8), funded together and switched by the room:

| Theme | Price | Outside |
| --- | --- | --- |
| `cozy` | — | a town rooftop skyline |
| `cabin` | 900 | pine forest and mountains |
| `seaside` | 1100 | a beach and a horizon of water |

A theme defines the wall, wainscot, floor, rug, and frame ramps plus the
silhouette drawn beyond the glass. Sky ramps, weather, and the celestial
arc are theme-independent — the hour of the day looks the same wherever
Makoto lives. Once funded, a theme is owned forever; `roomState.activeTheme`
selects among the owned ones and any caretaker may switch it, which is
broadcast so every room changes together.

### 22.6 Craft Rules

The backdrop obeys the same pixel-art discipline as the sprites, and these
are testable claims, not taste:

- Every colour comes from a named theme ramp; nothing is a literal in the
  renderer.
- Ramps are hue-shifted — shadows cooler, lights warmer — never a value
  slide of one hue.
- Dithering appears only in the sky's large gradients and only between
  adjacent ramp values.
- No banding: the wall falloff, floorboards, and light pool vary their
  band widths rather than running parallel edges.
- The pet must stay readable against every state of the room; the sky's
  darkest and lightest extremes are checked against the pet's outline
  value.
- Reduced motion freezes clouds, weather, twinkle, and transitions,
  holding the room at its current segment.

### 22.7 Delivery Phases

| # | Phase | Deliverable | Done when |
| --- | --- | --- | --- |
| **B1** | Atmosphere core | `src/sim/atmosphere.ts` + tests | segment, weather, and season are pure, deterministic, and season-weighted |
| **B2** | Room and sky | Full architecture rebuild + dithered dynamic sky, sun/moon/stars/clouds | the room reads as a place at every hour; sky cache invalidates correctly |
| **B3** | Weather and season | Rain, snow, overcast, seasonal views | each forecast renders distinctly and the room tints with it |
| **B4** | Condition | Room warmth and dimming from derived state | a critical pet is visibly rough on the room before the meters are read |
| **B5** | Themes | Theme registry, `cabin` and `seaside` as grand items, switching | two caretakers fund a theme, switch to it, and both rooms change |


---

## 23. Dynamic Difficulty

The pet is balanced for a small group. Each caretaker may restore at most
`CARETAKER_WEEKLY_BUDGET_DAYS` (4) days of decay per need per rolling week
(§2.5), while the pet spends 7 days of decay in that week — so two committed
caretakers sit just above water and the game has tension. A crowd breaks
that: ten caretakers can supply forty days against a demand of seven, and
Makoto simply sits at 100% forever. Nothing is at stake, so nothing means
anything.

Difficulty therefore follows the size of the community that is actually
caring for the pet.

### 23.1 The Rule

Let **P** be the number of distinct caretakers who performed at least one
care action within the last `BUDGET_WINDOW_DAYS` (7) pet-days — the same
window the caretaker budget uses, because the people who supply care are
exactly the people who should set the demand. Need decay is then multiplied
by:

```
careMultiplier(P) = clamp( (max(P, 2) / 2) ^ 0.75 , 1 , 3 )
```

These are the measured consequences, taken from the §16.2 abandonment
scenario rather than estimated:

| Caretakers | Decay | Full → first critical need | Abandoned → dead |
| --- | --- | --- | --- |
| ≤ 2 | 1.00× | ~30h | ~46h |
| 3 | 1.36× | ~23h | ~37h |
| 4 | 1.68× | ~15h | ~30h |
| 6 | 2.28× | ~11h | ~23h |
| 8 | 2.83× | ~9h | ~20h |
| ≥ 9 | 3.00× | ~8h | ~19h |

Death compresses less than decay does, and deliberately so: once the needs
bottom out, health drains at a rate set by the size of the deficit, not by
how fast the pet got there. A crowded pet therefore reaches its first
critical need almost four times sooner but still leaves the better part of a
day to answer the alarm. A missed night is survivable at every community
size; a missed day is not.

Three properties are deliberate:

- **A floor of 1×.** A shrinking community never gets an *easier* pet than
  the baseline. §2.5's premise — that one person cannot carry a week alone —
  survives at every population.
- **A ceiling of 3×.** Past nine active caretakers the pet stops getting
  harder. Without a cap, a popular week would demand literal round-the-clock
  cover and punish the very success that produced it.
- **A sub-linear curve.** Holding the two-caretaker tension exactly would
  mean scaling decay linearly with P; the 0.75 exponent keeps real pressure
  while leaving a margin that a distributed group can actually cover.

The multiplier scales **need decay only**. Energy recovery during sleep,
health regeneration, and each caretaker's weekly budget are untouched — the
budget must stay fixed per person, because a larger community supplying more
total care is the entire point.

### 23.2 Determinism

`state(t) = project(fold(reduce, snapshot, events), t)` (§4). A live
population read at projection time would break that outright: replaying the
same log tomorrow would find a different number of caretakers and produce a
different pet. So the population enters the simulation the only way anything
does — **as an event**.

- `PetState.population` holds the figure the simulation is currently using.
  It is absent in histories recorded before this section and reads as the
  baseline (2), so every existing generation replays byte-identically.
- The leader re-evaluates the active-caretaker count **hourly** and appends a
  `POPULATION` event only when the resulting multiplier moves by at least
  `DIFFICULTY_STEP` (0.1×). The log records *changes in difficulty*, not a
  heartbeat.
- `careMultiplier` is a **hardcoded integer table** in per-mille, not a call
  to `Math.pow` at runtime: ECMA-262 leaves `Math.pow` implementation
  approximated, and a one-ULP difference between engines is exactly the kind
  of drift §4.4 exists to forbid. Decay scales by integer arithmetic
  (`round(rate × permille / 1000)`).

### 23.3 Visibility

Rising difficulty must never feel like a silent nerf. The derived state
exposes both the population and the multiplier, and the UI states them
plainly beneath the meters — *"9 caretakers this week · Makoto needs 3.0× the
care"* — so a needier pet reads as a bigger community rather than a bug.
When the multiplier is 1.00× the line simply names the community size.


---

## 24. Appendix: What the Original Got Wrong

Recorded so the rebuild is measured against real defects rather than vague
dissatisfaction. Source: `~/Projects/makotogotchi_old` at `master`.

### 24.1 Architectural

1. **No server.** State lived in `localStorage`. Every visitor had a private
   pet. The premise of a shared global pet was unimplementable on that
   foundation. The git history shows MongoDB and SSE were built and then
   removed in favour of SPA/S3 hosting — the project moved *away* from the
   goal.
2. **Wall-clock coupling.** A 1s `setInterval` was the only clock. Close the
   tab and time stopped; reopen and the pet resumed frozen. No catch-up, no
   drift correction, no notion of absolute time.
3. **Non-deterministic and untestable.** `Math.random()` inside the tick made
   the simulation unreproducible. There were no tests, and none could have
   been written without heavy mocking.

### 24.2 Simulation Bugs

4. **`status()` read pre-tick state**, so every derived status lagged one tick
   behind the values it was derived from.
5. **`EATING` and `BATHING` were unreachable** — nothing in the reducer ever
   set them, despite both having animation sequences.
6. **`PLAY` toggled into `PLAYING`**, but `status()` returned `PLAYING`
   unconditionally once there, so the only exit was another `PLAY`.
7. **`Effect.ANGRY` was never applied** by any code path, though `PET` cleared
   it and the renderer had an animation for it.
8. **`neglect` only accumulated when happiness *and* energy were both zero**,
   so a pet at 1 energy and 0 happiness was immortal.
9. **`age` was overloaded** as both seconds-alive and hatching progress,
   making `isBorn` a magic comparison against `240`.
10. **Effects were rebuilt from scratch each tick** by re-testing probability,
    and the reconstruction silently dropped `ANGRY` from the array — so any
    angry state that had been set would vanish on the next tick.

### 24.3 Structural

11. **Presentation stored as game state.** `Status.CLONE1..4` were animation
    frames living in the state enum.
12. **Versioning by UUID.** `_version` was a hardcoded UUID and a mismatch
    silently discarded the save with no migration path.
13. **`_index.tsx` was a wall of inline Tailwind**, including six near-
    identical 300-character button class strings differing only by an angle.
14. **Sprite coordinates were hand-typed** in `configuration.ts` and do not
    match the actual sheet layout.
15. **A 6.5MB PNG** shipped to every visitor.
16. **CI deployed to S3 and ECS** — infrastructure unrelated to the target
    cluster.

Every one of these is addressed by a specific decision above: §3.1 (1, 2, 3),
§4.4 (3), §4.3 (4, 11), §4.1 `validate.ts` (5, 6, 7), §2.3 (8), §4.3 (9),
§4.1 `reduce.ts` (10), §6.1 (12), §11 (13), §10.2 (14, 15), §17 (16).
