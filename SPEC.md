# Makotogotchi — Specification

> **Version:** 1.3 (approved; §22.9 and four more venues added — the rotation
> grew, the night came home, and a funded place became something to back)
> **Last Updated:** 2026-08-28
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
21. [Liveliness and Community Program](#21-liveliness-and-community-program)
22. [The Living Room](#22-the-living-room)
23. [Dynamic Difficulty](#23-dynamic-difficulty)
24. [Caretaker Titles](#24-caretaker-titles)
25. [Pet Wants](#25-pet-wants)
26. [The Ancient Code](#26-the-ancient-code)
27. [Appendix: What the Original Got Wrong](#27-appendix-what-the-original-got-wrong)

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

Five needs, each an integer in `[0, 1_000_000]` (display divides by 10,000
for a percentage with two decimal places; see §4.2 for why integers — this
matches `NEED_MAX` in §5, which is authoritative).

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
| `LULLABY` | Energy; induces sleep | 2 min | 5 min | Awake, energy < 25% |
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
- `FEED`, `PLAY`, `CLEAN`, `LULLABY` are unavailable — the pet is asleep.
  `PET` and `MEDICATE` still work.
- A pet with critically low energy during the day will also nap, and
  `LULLABY` will put it down early.

`LULLABY` is unavailable while the pet sleeps for the same reason as the rest:
you cannot put down a pet that is already down. It is worth stating because
its gate reads as an energy threshold, and a sleeping pet's energy is
*climbing* — a nap crosses the daytime gate on its way to `NAP_WAKE_THRESHOLD`.
Gating on energy alone told a caretaker their napping pet was wide awake.

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
   the gravestone sprite: the one still `dead1` frame, never mirrored, so its
   letters read whichever way the pet was last strolling. This state persists
   for `MOURNING_DURATION` (2 hours) — long enough that people who were
   asleep still see it happened.
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

**Nothing avoidable happens between acquiring the lock and releasing it.**
This is the one section the entire fleet queues behind, so a round trip spent
here is a round trip every caretaker waits for. Three used to be spent
needlessly, and are not any more:

- the advance's events are appended with a single ordered `insertMany` rather
  than one insert per event, so a tick that crosses three milestones pays one
  round trip instead of three;
- the new hot state and every broadcast go out as one Redis pipeline. A
  pipeline executes in order, so the state is still committed before the
  messages announcing it — the property the sequential awaits were there for,
  kept without the round trips;
- whether to write a snapshot is decided from `mgc:snapshot-tick` (§6.2)
  rather than by asking Mongo for the newest snapshot every time.

The hold is milliseconds, and it should stay that way: anything that can be
computed before the lock, or written after it, belongs outside it.

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
| `derive.ts` | `derive(state): DerivedState` — ailments, mood, animation key, alert level, vitality (whether low health is climbing back or not). Everything presentational. |
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
| `mgc:snapshot-tick` | string | Tick of the newest snapshot on disk. Bookkeeping for one decision — whether the write path owes another snapshot — which was previously a sorted Mongo query on *every* advance, inside the fleet-wide write lock. Written only after a snapshot actually lands, so a pointer can never suppress a snapshot that was never taken. Losing it costs one read, which then refills it. |
| `mgc:events` | pub/sub channel | Cross-pod fanout. |
| `mgc:tick-leader` | string w/ PX | Leader lease (§3.3). |
| `mgc:presence` | sorted set | `caretakerId\|connectionId → lastSeen`. Pruned by score on read, then counted unique by caretaker. Keyed per open stream, not per caretaker: one caretaker holds several at once (a refresh overlaps two, a second tab is ordinary), and a caretaker-keyed set lets the first stream to close evict someone who is still watching. |
| `mgc:rl:{scope}:{id}` | string w/ TTL | Token buckets. |
| `mgc:cd:{action}` | string w/ TTL | Global action cooldowns. |
| `mgc:cd:{caretaker}:{action}` | string w/ TTL | Per-caretaker cooldowns. |
| `mgc:lb:{window}` | sorted set, TTL | Cached leaderboards. |

Redis holding no unique durable state is a deliberate invariant: **flushing
Redis must cost nothing but a cold cache.** Anything that would be lost
permanently belongs in Mongo.

**Every connection registers an `error` listener at construction.** ioredis
reconnects on its own and every caller here already tolerates a failed round
trip — the tick loop retries next interval, the write lock throws and the
request 500s, the room cache falls back to its TTL. None of that survives the
`error` event itself: EventEmitter rethrows an unhandled `error` as an
uncaught exception, so a blip the client was about to recover from instead
takes the pod down. The recovery exists; listening is what lets it run.

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
| `hello` | `{ caretakerId, nickname, serverNowMs, tickSeconds, genesisEpochMs, phaseSchedule, presence, purse }` | On connect. Lets the client align its clock and project locally (§4.5), and hands it the presence count its own connect produced (§7.4) and its own opening balance (§13.1). |
| `snapshot` | Full `PetState` + generation metadata + `phaseSchedule` refresh | On connect, and every 30s as reconciliation. |
| `care` | `{ action, caretaker, applied, needsAfter, tick }` | Every care action, by anyone. Drives the attributed toast. |
| `milestone` | `{ kind, detail }` — `HATCHED` (detail carries the voted name), `EVOLVED`, `BECAME_SICK`, `RECOVERED`, `CRITICAL`, `SLEPT`, `WOKE`, `DIED` | System events. |
| `minigame` | `{ phase: start\|score\|finish, caretakerName, score?, applied? }` | The live Dust Dash spectacle (SPEC §13.3). |
| `presence` | `{ count, caretakers[] }` | Throttled to at most once per 2s, leading **and** trailing (§7.4). |
| `react` | `{ emoji, caretaker }` | Emoji reactions. |
| `purse` | `{ caretakerId, coins, inventory }` | Whenever a caretaker's coins or pack change, from any cause. **Delivered only to that caretaker** — see below. |
| `secret` | `{ mood: party \| stars }` | Someone entered the ancient code (§26). Unattributed by construction, and never logged. |
| `:ping` | comment frame | Every 15s. Keeps intermediaries from reaping an idle stream. |

**`purse` is the one message that is not for the room.** Everything else on
this channel is public by nature — the pet, the room, who acted, who is
watching — and the hub is built to match: one Redis subscription per process,
fanned out to every local client (§7.1). A balance is per caretaker, so rather
than give each caretaker a channel of their own — which would cost one
subscription per connected caretaker, the exact thing the hub exists to avoid
— the purse rides the shared channel and `/api/stream` drops the ones that are
not its own connection's before they reach the wire. The predicate is pure and
lives beside the message types (`deliverableTo` in `engine/messages.ts`) so the
boundary can be tested without a socket. Anything added later that is
per-caretaker obeys the same rule.

**Caches are kept coherent by the same channel.** The room rides a short
TTL in front of Mongo, and a writer can only ever drop its *own* copy — so
before this, every other replica went on serving the old room until its TTL
ran out, while the `room` message announcing the change was already reaching
those replicas' clients. The cache was contradicting a broadcast the browser
had in hand.

Each process therefore subscribes at **boot**, not on its first SSE client:
the hub attaches lazily, so a replica serving only `/api/state` would never
have heard the message at all. And it takes the room *off the message* rather
than dropping its copy and re-reading — the payload is what `roomState`
produced on the writer, so a drop-and-reread would turn every room change
into one Mongo read per replica. That was tolerable when the room changed on
a funding; it is not now that every vote on the day's ballot changes it
(§22.9).

Two replicas announcing at the same instant can deliver out of order, so one
may briefly hold the older of two rooms. That is accepted: the next
announcement corrects it and the TTL bounds it — the same staleness the
cache already tolerated, minus the read.

The purse is published by the **mutation**, never by its callers. Coins and
pack contents are written in exactly five places — `recordContribution`,
`creditCoins`, `spendCoins`, `consumeItem`, `refundItem` — and each publishes
the resulting purse itself. Publishing from the nine or so call sites instead
would mean a balance that quietly stopped being live wherever one was missed,
and a stale balance looks exactly like a working one.

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

**The 30s cadence is the pod's, not each client's.** Nothing in a snapshot
belongs to its recipient — state, derived view, clock alignment, phase
schedule and room are all generation-scoped — so one ticker per process builds
the payload, serializes it once, and hands the same bytes to every stream it
holds (`src/server/stream/snapshots.ts`). On a per-client timer the cost of
reconciliation scaled with the audience: a thousand watchers meant a thousand
Redis reads, a thousand projections, a thousand phase schedules and a thousand
JSON encodes per cycle, all computing the identical answer. Reconciliation
should cost what the pet costs, and there is one pet.

This is the hub's argument (§7.2 — one Redis subscription serves a thousand
clients) applied to the half of the stream the hub never covered, because
these messages are produced locally rather than received. The ticker runs only
while a stream is attached, so an idle replica behind the balancer costs
nothing.

Clock skew is handled by tracking the offset between the local clock and the
`serverNowMs` in `hello`, refreshed on every snapshot. The client never trusts
its own wall clock in absolute terms.

Alignment is against the server's *wall clock*, never against `serverTick`. A
tick index is floored, so the instant a tick begins and the instant a snapshot
is cut are up to a whole tick apart; treating the two as the same moment puts
the corrected clock up to ten seconds behind the server, which is enough to
hold a button locked after its cooldown bar has visibly emptied.

Every time-driven part of the UI reads that one corrected clock, in fractional
ticks: the local projection floors it, cooldown bars use it whole. A component
must not re-derive the current tick from `Date.now()` and `genesisEpochMs` on
its own — a second clock is a second answer.

Presence follows the same rule as state: a client's opening view arrives with
its own connect, in `hello`, computed after that stream has joined the
presence set. It must never be learned from a broadcast instead — a connect
that waited for one would show zero whenever it lost the throttle window,
which is exactly what a refresh does, since the reload and the old stream's
teardown race inside the same window.

The `presence` broadcast is throttled to one message per 2s across all pods,
**leading and trailing**. The first change in a window publishes at once; the
rest fold into a single publish when the window closes. Leading-only
throttling drops the losers outright, and since a burst always *ends* on a
loser, the final count — the true one — is the one guaranteed not to be sent,
leaving every other screen stale until some later change or 15s heartbeat
happens to win. The payload is read fresh from Redis at publish time, so
nothing is queued but the fact that something changed, and a coalesced burst
loses no information. The trailing timer runs a full window rather than the
guard's remaining TTL, which bounds staleness at two windows.

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

**Every route is metered, and the meter lives in one place.** The buckets are
taken by `rateLimit` in `src/server/http.ts`, never re-typed in a handler: a
limit copied into fifteen files is a limit that is eventually missing from
one, which is exactly what had happened — four routes enforced this section
and thirteen did not, among them the write-locking `/api/play`, the
coin-spending `/api/shop/contribute`, and the `$group`-aggregating
`/api/leaderboard`.

A route declares what it costs rather than which buckets to take:

- **`read`** answers from the stores and takes the per-address bucket alone.
  Several fire on one page load; they are shared work, not an allowance.
- **`write`** changes something — appends to the log, moves coins, publishes
  to every open stream — and takes the per-caretaker bucket on top. The scope
  carries the caretaker to charge, so a write cannot be metered without one.

Two deliberate exceptions, both about metering what a request actually costs:

- `/api/play`'s `score` phase is a 2s progress heartbeat that mostly no-ops
  behind the room-wide broadcast guard. It pays the address bucket only —
  charging a caretaker's action allowance would let the longest game spend its
  whole budget on progress reports. `start` and `finish` pay in full.
- `/api/stream` takes the bucket *as well as* the §8.3 cap. The cap bounds how
  many streams an address holds; it says nothing about how fast it may open
  them, so an open/close loop stays under the cap forever while paying the
  stores a full connect each time round. The bucket bounds rate, the cap
  bounds concurrency.

Both budgets are read from `env()` (`RATE_LIMIT_PER_IP`,
`RATE_LIMIT_PER_CARETAKER`) for the reason `MAX_STREAMS_PER_IP` is: the e2e
suite drives the entire application from 127.0.0.1, where production sees a
crowd. The defaults are the numbers in the table above, and a budget is
expressed per minute — the bucket holds a minute's worth and refills at
exactly that rate, so burst and sustained rate cannot drift apart.

### 8.3 Connection Limits

Max concurrent SSE streams per IP (default 5), so one client cannot pin
resources by opening hundreds of streams. Exceeding it returns `429`.

**The count is held in Redis, across the whole fleet.** A per-process count
is not a smaller version of this rule, it is a different and worse one: with
N replicas behind a load balancer each pod starts counting that address from
zero, so the real ceiling is N × the limit and the guard *relaxes as the game
scales*. `src/server/streamcap.ts`, keyed `streams:<ip>`.

The shape is presence's (§2.11): a sorted set of open connection → last
heartbeat, pruned by age on read, refreshed by the same 15s ping that
refreshes presence. A plain INCR/DECR counter cannot survive a pod dying
mid-stream — its decrements never run, and the address stays locked out
until somebody clears the key by hand. Here an abandoned stream merely stops
being refreshed and ages out. Prune, count and claim happen in one Lua call,
because two streams opening at once would otherwise both read a count below
the limit and both be let in.

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
| `POST` | `/api/konami` | Empty body → broadcasts the §26 spectacle to the whole room, every time. `200 { mood }`; only the shared rate limiter can refuse it. |
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
| `engine/loop.ts` | Fixed-timestep accumulator driving `update(dt)` at 10Hz, decoupled from `render(now)` on a 15fps cadence of its own. Parks itself while the document is hidden **or** the window is unfocused. |
| `engine/atlas.ts` | Sprite atlas: loads the sheet with retry, exposes named frames, blits them with integer-snapped bottom-center anchoring. |
| `engine/particles.ts` | Pooled particle system — dust puffs, sparkles, hearts, Zs, crumbs. |
| `engine/layer.ts` | `layer(ctx, draw)` — the only sanctioned way to stack canvas state. `save()`, then `draw()` in a `try`, then `restore()` in the `finally`. |
| `engine/digest.ts` | `SceneContext`, the slice of the 2D API the scene uses, and `DigestContext`, a recording stand-in that hashes a frame instead of drawing it. What lets `Room.render` skip a frame identical to the one on the canvas. |
| `anim/machine.ts` | Declarative animation state machine: `animKey → clip`, with transition rules, one-shot clips that return to idle, and interruption priorities. Pure and unit-tested. |
| `anim/clips.ts` | Clip definitions: frame list, frame duration, loop mode. |
| `scene/room.ts` | Composes the scene from state. |
| `scene/toasts.ts` | Floating attributed action toasts. |

Three rules the scene lives by, all learned the hard way:

**Nothing paints faster than the art needs, and nothing paints unwatched.**
`update()` is a 10Hz fixed step, the fastest clip in the game is the butterfly
at `frameMs: 130`, and the pet's own clips run 800–2000ms a frame. Painting
that sixty or a hundred and forty times a second buys nothing visible, and it
is not free: the canvas sits under a page of `backdrop-filter` panels, and
every panel re-blurs on any frame where what is beneath it changes. Measured
on the production build, the shipped loop plus two perpetual CSS animations
held the GPU process at **35% busy indefinitely**; with both idle it sits at
**0.2%**. The scene loop and a looping CSS animation are each *independently*
sufficient to hold the compositor at full refresh rate, so fixing one alone
measured no better than 1.1×. Hence two hard rules: `render()` runs on its own
cadence (`RENDER_STEP_MS`, 15fps) rather than the display's, and the loop
parks itself when the document is hidden *or* the window loses focus — a
hidden tab already stops `requestAnimationFrame`, but a merely unfocused
window does not. It always paints one frame before parking, so a page opened
behind another window still has a room in it. In CSS the same rule reads: no
animation loops forever (`globals.css`).

Even at 15fps most frames are wasted: measured on the live build, only ~4
frames a second put down different pixels under normal motion and ~0.1 under
reduced motion — the pet's clips advance about once a second and two clouds
cross the sky at a pixel a second. So `Room.render` replays the frame into
`DigestContext` (`engine/digest.ts`) and hands it to the canvas only when the
hash moves. The test is a *recording* rather than a prediction from scene
state on purpose: there is no second implementation to drift out of step, and
a false skip — the one failure that matters, a scene frozen on screen — would
need the recorder to miss something the drawing does. Everything that can
reach a pixel is folded in at the point of the call, including the effective
transform: the pet is mirrored by `translate(x, 0); scale(-1, 1)` and then
drawn at zero, so its draw call is byte-identical wherever it stands.

This is why `paint()` may not mutate. Whatever the frame changes about the
room — the stroll, a rare moment running out — belongs in `advance()`, which
runs once; `paint()` runs twice and must draw the same thing both times.

**A clip may start after the frame that draws it.** Care arrives over the
stream and is stamped with `performance.now()` in the event handler; the scene
renders with the `requestAnimationFrame` timestamp, which is sampled when the
frame begins — before that handler ran. So an action taken during a frame
lands a few milliseconds in that frame's future, and elapsed time goes
negative. Anything measuring "how long has this been running" clamps at zero.
Unclamped, a frame index reaches -1 and the clip names no frame at all.

**A frame never leaves anything on the context.** The loop deliberately
swallows a throwing frame so one bad frame cannot freeze the scene
(`engine/loop.ts`). That makes a bare `save()` … `restore()` pair a trap: the
throw escapes between the two, and what stays behind is not one frame's
mistake but the context's state for the life of the canvas — its transform,
its clip, its `globalAlpha`, and the depth of its save stack. So **every push
of canvas state goes through `layer(ctx, draw)`** (`engine/layer.ts`), which
pairs the two calls in a `finally`, and `render()` is itself one `layer` — the
frame's own state comes back off the context whether it finishes or dies.

Resetting the transform at the top of `render()` is *not* that guarantee, and
was tried first: `setTransform` moves the matrix and nothing else. It does not
unwind the save stack, and there is no reset for a clip — only a `restore()`
takes one off. A leaked sky clip therefore masks every later frame, including
the architecture blit, which is the scene's **only** full-canvas paint. Once
that blit stops covering the canvas, the surviving pixels of older frames stay
welded into the room: two rugs, two windows, a wall lit from the wrong side.
That is what "the broken backdrop" was. For the same reason the blit has no
path that silently paints nothing — when no offscreen canvas is available to
cache into, the composed pixels go straight onto the target instead.

A fake context in a test is held to the real one's semantics on exactly these
points, because a fake that clears the save stack on `setTransform` or treats
`clip()` as a no-op will certify a fix that does not work.

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

A corollary that is easy to violate: **retries do not mint cache keys.**
`Atlas.load` retries a failed sheet fetch with backoff, and every attempt
requests the *same* URL. A cache-busting query would pin a separate
year-long browser and edge entry per attempt, to sidestep a poisoned cache
entry that content-hashing already makes impossible — under `immutable`,
the only way a hashed URL's bytes can be wrong is a transfer that failed
outright, and a plain re-request is the direct expression of that.

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
│  Makoto · 4d 6h · JUVENILE  🪙 330  👥 7 watch│
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
- An action carries two cooldowns at once (§2.5) — the pet's and the
  caretaker's — but it gets **one** bar, spanning the single window from the
  tick that armed it to the tick it frees up. That window is whichever of the
  two ends *last*; reporting the shorter one drains the bar to empty and then
  refills it when the longer one takes over. `cooldownWindow()` in
  `validate.ts` is the one place that decides it, and `canPerform()` gates on
  the same value, so the bar reaches empty on exactly the tick the button
  starts accepting clicks.
- The top bar carries a live 🪙 balance beside the watching count (§13.1), so
  what caring earns you is visible while you are earning it rather than only
  once you open the shop. It updates from the stream, never from a poll, and
  it is labelled as a balance — a bare number read out on its own says
  nothing.
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
- **A control that cannot be used says so, and stops inviting the click.** One
  rule, everywhere: it stays in the tab order via `aria-disabled` (never the
  native `disabled` attribute, which removes it), carries its reason as
  *visible text* as well as in the accessible name — a `title` tooltip is not
  a carrier, since it does not exist on touch — and loses its press affordance
  entirely rather than merely dimming. Where the control is too narrow for a
  sentence, the visible text is the **short** form of the reason and the
  accessible name keeps the full one: a care tile is a sixth of a phone's
  width, and "Makoto is asleep" truncated there to `Makoto is asl…`, so every
  tile opened with the same three words and cut off before the one word that
  differed. Abbreviating is allowed; truncating is not. The last part is
  enforced in
  `globals.css` on `.press[aria-disabled="true"]`, not per component: a
  hover-brightened, sweep-animated button reads as live no matter how faint it
  is drawn.

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

### 11.7 The Status Line

The one sentence under the canvas ("Makoto is doing fine.") is built from the
whole of the pet's state, not from the ailments list alone — a pet nursed
back from the brink has every need met and a 1% health meter, and "doing
fine" over that meter is a lie. `statusLine()` in
`components/GameView/status.ts` is a pure function of `PetState` and
`DerivedState`, unit-tested line by line, and the first rule that matches
wins:

| Priority | State | Line |
| --- | --- | --- |
| 1 | dead | "Makoto starved. A new egg will appear soon." — the cause worded exactly as the memorial wall words it (`app/copy/death.ts`, one table for both) |
| 2 | egg | "The egg is incubating…" |
| 3 | asleep | by `sleepReason`: "is asleep for the night." / "is napping until the energy comes back." / "was sung to sleep." |
| 4 | any ailment | "is starving, filthy and sad" — worst first, in §2.9's order — with sickness dated last: "just fell sick" (under an hour), "has been sick for 5 hours", "since yesterday", "for 3 days" |
| 5 | health below 25% (§2.3) | "is recovering." while health is climbing back; "is dangerously weak." while it is not — an elder, a sick pet, or a critical need |
| 6 | a need under 50% | the lowest one: "is getting hungry." / "is getting sleepy." / "could use a bath." / "is getting bored." |
| 7 | well | by stage: "is small and curious." / "is full of beans." / "is growing fast." / "is doing fine." / "is taking it slow." |

Rules 3 and 4 carry the health verdict as a second sentence when there is
one: "Makoto is asleep for the night. Health is coming back." The verdict is
`derive()`'s `vitality`, which mirrors exactly the conditions under which
`project()` regenerates health, so the line never promises a recovery the
simulation is not making. One fixed line per state, warm in tone, no
rotation: every caretaker reads the same words, and the tests are exact.
The venue clause ("Out at the shrine path today.", §22.8) follows on its own.

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

Coins are **per caretaker**, not communal — the balance lives on the caretaker
document and is spent through a filter that *is* the affordability check. What
is communal is what the coins buy (§13.2): toys for the generation, cosmetics
and decor for the room. A private wallet, a public purchase.

The balance is **live**. It moves the moment anything moves it — a care
action, a minigame payout, a quest, a purchase, a chip-in, a refund — and it
moves wherever the caretaker is looking, because it rides the stream as the
`purse` message (§7.2) rather than being fetched. The pack travels with it, so
what you own is as current as what you can spend. Both are shown in the game's
top bar as well as in the shop, since a number nobody can see is not worth
keeping live.

### 13.2 Shop

| Category | Items |
| --- | --- |
| Food | Better food restores more hunger and adds a small joy bonus. Consumed on use. Peppers are characters in this world, not ingredients, so they never appear here — the Pepper Treat was legacy and is now Onigiri. |
| Medicine | Cures `SICK` instantly with no cooldown. Consumed. |
| Toys | Raise the `PLAY` base magnitude. Permanent for the generation. |
| Cosmetics | Hats and accessories for the pet. Permanent, cross-generation. |
| Room decor | Community-funded upgrades to the room, visible to everyone. Permanent. |

Cosmetics and decor are the interesting sink: they are **visible to everybody**,
which turns spending into a form of contribution rather than a private
inventory.

**Presentation.** The shop is a modal overlay over the game screen, not an
inline panel — it is a place you go, and while you are there the game screen
should not be scrolling away underneath you. A bottom sheet on phones, a
centred card from `sm:` up.

```
┌──────────────────────────────────┐
│ 🛒 Shop            🪙 1,240    ✕ │  sticky
│ [Pack] Food  Toys  Style  Room   │  sticky, role="tablist"
├──────────────────────────────────┤
│ 🍖 Fish Feast                    │
│    Feeds ×1.45 · +3.5% joy       │
│                        [ 🪙 150 ]│
│ 💊 Super Medicine       ~🪙 250~ │  ← locked
│    Needs 90 more 🪙              │
├──────────────────────────────────┤
│ Bought Fish Feast!               │  sticky, aria-live
└──────────────────────────────────┘
```

- **Five tabs, one visible at a time**, filed by what an item *does* rather
  than by how it is paid for: **Pack** (consumables you own, used from here),
  **Food** (food + medicine), **Toys** (this generation), **Style**
  (cosmetics Makoto wears), **Room** (everything everyone sees — decor, wall
  styles §22.5, and places §22.8 with their ballots §22.9). Pack keeps its
slot when empty, carrying an
  empty state, so tab positions never move under the thumb.
- **The balance never scrolls away.** It lives in the sticky header beside the
  title; the result notice lives in a sticky `aria-live` footer. Both are
  visible from any row. Balance and pack come from the stream's `purse`
  (§7.2), not from the shop's own fetch — the shop holds no copy of anything
  the stream already knows, which is why the number moves while you care for
  Makoto with the shop open. What it does still fetch is the catalog and the
  co-op pools, which have no live channel.
- **One row anatomy** for every item in every tab: icon · name over a muted
  detail line · a fixed-width action slot. This is what keeps prices, badges
  and buttons aligned down the whole list.
- **Availability is decided before the click, not after it.** Every action
  resolves to available or unavailable-with-a-reason *before* it renders, and
  an unavailable one follows the §11.3 locked-control rule — the reason
  replaces the row's detail line. Actions on the pet (using pack food or
  medicine) gate on `canPerform()`, the same authority the server enforces
  with (§4.1); purchases gate on the balance. A reason is always player-facing
  copy — never a raw `RejectionReason` enum, which is what
  `Makoto can't right now (ASLEEP)` was.
- Dialog chrome: `role="dialog"`, `aria-modal`, Escape and backdrop close,
  focus enters on open and returns to the shop button on close, and the item
  list — not the page — is what scrolls.

### 13.3 Minigames

`PLAY` launches a short skill game from a ten-game roster, picked at random
per run (a `?game=` query pins the choice — for sharing a favourite and for
deterministic e2e runs). The player's score determines the joy restored and
the coins earned. While a run is live, every other connected client sees the
pet playing and the live score — spectating is the point, and it is the
reason this is a realtime feature rather than a solo one. One run exists at a
time, world-wide, by design.

| Game | Play | Beats |
| --- | --- | --- |
| Dust Dash | 20s runner: hop the dust bunnies | one point per cleared bunny; collision ends the run |
| Snack Catch | 25s: steer under falling meals, dodge the one thing that is not one | +1 per snack, −3 for the sock |
| Bubble Bath Pop | 25s: pop the bath bubbles before they escape | +1 per pop |
| Simon Squeaks | memory: repeat Makoto's pose sequence on four pads | +1 per completed round; a miss ends the run |
| Wheel Sprint | 30s rhythm: tap as the spark crosses the wheel's top | +1 per on-beat hit |
| Makoto Shuffle | shell game: keep your eye on Makoto under three shuffling bowls | +1 per correct bowl; a wrong pick ends the run |
| Natsumi's Watch | 30s sneak: scurry for the treat only while Natsumi looks away | +1 per treat reached; caught moving means back to the start |
| Coffee Run | 30s: brew a pot, and hide the machine before Natsumi reaches it | +1 per cup poured; a smashed machine costs the pot in progress |
| Sausage Party | 35s: serve each guest the plate they are holding up | +1 per plate matched; a wrong plate costs that guest's patience |
| Don't Get Sausaged | reaction: do what Natsumi says, before she finishes saying it | +1 per command obeyed; one miss and he is a sausage |

### 13.3.1 The three-second pre-roll

Every run opens with a **three-second countdown** (`MINIGAME_COUNTDOWN_MS` in
`src/sim/minigames.ts`). The game component mounts and paints its opening
frame immediately — the real board, with its real props in their starting
positions — but its clock is held at zero and its inputs are ignored until the
count expires, so a player who has just been handed a random game gets to read
it before it moves. The numerals are the Shell's, drawn over the canvas; the
freeze belongs to the shared game loop, so no game implements its own.

The constant lives in the shared roster module because both ends need it: the
client paints the countdown, and the server subtracts it from the elapsed wall
time before judging a run, so the pre-roll can never be spent as play time and
the envelopes below keep meaning exactly what they meant before.

### 13.3.2 Natsumi

**Natsumi is Makoto's owner, and she torments him.** Natsumi's Watch is her
debut, and she is the sheet's first character besides the pet. Her frames are
authored as letter grids in `scripts/art/natsumi.mjs` — one head per state
stamped onto a shared body — and `npm run art:natsumi` writes them into
`art/natsumi/` for the same `npm run atlas` run that packs everything else.

She is a witch: lavender hair that runs through pink to blonde at the very
tips, a spiky fringe over two side locks, yellow skin, and eyes that are two
pixels curving upward so she reads as pleased with herself. Her dress opens in
a V that shows the cream underneath, with a ribbon tied at the point of it and
shoes dyed to match; from behind there is no V and no ribbon, because a bow at
her throat cannot be seen from the back.

Four states, each drawn twice — bare-headed, and under the witch hat:

| Frame | She is | Makoto may |
| --- | --- | --- |
| `natsumiAway` | turned around: all hair, plain dress | run |
| `natsumiTurn` | mid-swing, one eye clear of the hair | run, briefly |
| `natsumiWatch` | facing him | not move |
| `natsumiGrin` | eyes bulging, teeth bared, having caught him | nothing — he is back at the start |

`natsumiHatAway`, `natsumiHatTurn`, `natsumiHatWatch` and `natsumiHatGrin` are
the same four under the hat, which the generator stamps over the top rows of
her crown; the hatted frames are correspondingly taller, and a game that wants
them only has to name them.

The frames carry the whole rule, so their readability is load-bearing rather
than decorative: a player who cannot tell `natsumiAway` from `natsumiWatch` at
a glance cannot play at all. Two details exist purely to serve that — the
`turn` frame's face is half-covered rather than merely different, and the
grin's eyes are white with an iris so the state reads even at a glance.

Three more things are true about her, and each one is a game below. **When a
Makoto displeases her, she turns it into a sausage.** **She destroys the drip
coffee machine every single time they try to make coffee.** And **Makotos hold
sausage parties** — tea parties, but with sausages, which are the Makotos who
misbehaved, a fact the guests are entirely oblivious to. The games play the
joke straight and never explain it; the sausage on the plate in Natsumi's
Watch is the same sausage the party is eating.

### 13.3.3 How the newer games play

**Makoto Shuffle.** Three bowls sit overturned on the floor. Makoto ducks
under one in plain sight, the bowls drop, and then they swap in pairs — more
swaps and faster ones every round — until the player picks the bowl he is
under. A correct pick is a point and the next round starts harder; a wrong
pick ends the run, so the tension is cumulative rather than per-round. The run
also ends at twelve rounds or eighty seconds, whichever comes first. It is the
only game in the roster that asks the player to *track* rather than react,
remember a sequence, or keep a beat.

**Natsumi's Watch.** A treat sits at the far end of the desk and Natsumi looms
over it. Hold the pointer (or space) and Makoto scurries; release and he
freezes. While her back is turned he can run freely; a moment before she turns
she telegraphs it, and if she catches him moving she flicks him back to the
start and he sits dizzy for a beat. Reaching the treat is a point, after which
she resets him herself and dangles the next one. Thirty seconds, no score
penalty for being caught — the punishment is the lost ground, which is
punishment enough. It is the roster's only hold-and-release game.

**Coffee Run.** The pot fills while the player holds, up to five cups, and
letting go pours it — banking those cups as points. Natsumi walks in from the
right on her own schedule, and a pot still brewing when she arrives is a
machine on the floor and a pot worth nothing. One button, and the only
question it ever asks is when to stop: the roster's only press-your-luck game.

**Sausage Party.** Guests around the table hold up what they want; serve the
guest who wants the dish currently on the tray. A right guest is a point, a
wrong one costs that guest's patience, and an empty patience bar ends their
visit unserved. The tray takes a beat to plate the next dish, and that reload
is what paces the game — without it the only limit on scoring would be how
fast a player can tap, which is not a skill this roster tests. Pure
order-matching, and the only game that asks the player to read several things
at once rather than time one thing.

**Don't Get Sausaged.** Natsumi gives a command — sit, spin, sleep, cheer —
and Makoto has a shrinking window to obey it on the four pads. Obeying is a
point and the window tightens; one wrong move or one hesitation and she turns
him into a sausage on a plate, which ends the run. It is Simon Squeaks' pads
with the memory replaced by pure reaction, and the roster's best fail state.

Each game is scored client-side but validated server-side against a
**per-game plausibility envelope** (`src/sim/minigames.ts`: max duration, max
score, max score per second, minimum inputs per point), because a fully
authoritative implementation is disproportionate for a friends' toy while an
unbounded client score is not acceptable either. The envelope judges *play*
time: the server measures wall time from `start` and deducts the pre-roll
(§13.3.1) before applying the duration and rate ceilings. The chosen game is
fixed at `start` and stored in the server's session, so a client cannot start
a cheap envelope and finish an expensive one; per-game curves translate the
score into the `PLAY` performance multiplier (50–150) and the coin payout.

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
│   ├── games/                  # minigame props
│   └── natsumi/                # Makoto's owner, four frames (SPEC §13.3.2)
├── scripts/
│   ├── atlas.ts                # packs art/ into the sheet + typed atlas
│   ├── art/                    # letter-grid sources for the drawn frames:
│   │                           # natsumi.mjs, props.mjs → art/, then re-pack
│   └── cloudflare-setup.sh     # idempotent edge config (SPEC §19.3)
├── e2e/                        # Playwright suite + dockerized-store stack
├── public/
│   ├── sprites.<hash>.png      # packed atlas, content-hashed, generated
│   └── sw.js                   # push service worker
└── src/
    ├── sim/                    # PURE simulation core (SPEC §4) + economy.ts
    │                           # secret.ts — spectacle mood (SPEC §26.3)
    ├── server/
    │   ├── db/                 # mongo client, collections, repository
    │   ├── redis/              # client, write lock, leader lease
    │   ├── engine/             # engine (serialized write path), lifecycle, messages
    │   ├── push/               # subscriptions store, dispatcher, sender
    │   ├── stream/             # hub (one Redis sub per pod) + snapshots
    │   │                       # (one reconciliation cycle per pod, §7.4)
    │   ├── env.ts identity.ts ratelimit.ts presence.ts http.ts
    │   ├── social.ts votes.ts shop.ts snapshot.ts schedule.ts
    │   └── runtime.ts once.ts testsetup.ts
    ├── game/                   # canvas engine, anim machine, room scene, audio
    │                           # scene/party (SPEC §26.4)
    │                           # scene/backdrop/outdoors/ — one file per venue
    │                           # over a shared sky/buffer module (SPEC §22.8)
    └── app/                    # Next.js App Router
        ├── layout.tsx page.tsx globals.css
        ├── memorial/ leaderboard/ about/
        ├── health/ ready/
        ├── api/                # care state stream react nickname leaderboard
        │                       # memorial name-vote push shop play konami
        ├── hooks/              # usePetStream (client reconciliation, SPEC §7.4)
        │                       # konami (pure matcher) + useKonami (SPEC §26.1)
        └── components/         # GameView PetCanvas Meters FeedLog VotePanel
                                # RetroOverlay (SPEC §26.5)
                                # NicknameEditor PushToggle QuestBanner
                                # WantBanner (+copy) minigames/ (Shell +
                                # registry + ten games, §13.3)
                                # ActionBar/  index + copy + cooldown.test
                                # ShopPanel/  index (dialog shell) + useShop
                                #             + tabs (pure row model) + rows
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
| `MAX_STREAMS_PER_IP` | no (`5`) | SSE connections per client IP (§8.3). The e2e harness raises it: every Playwright worker shares 127.0.0.1. |
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

| Quest | Bar at the baseline community | Grows by | Measured by |
| --- | --- | --- | --- |
| Full bellies | every meter ≥ 70% at the evening check (1h before sleep) | nothing — a meter percentage has nothing to multiply | projection at the check tick |
| Game night | combined minigame score ≥ 40 today | §23's care multiplier | sum of plausible finishes |
| Many hands | ≥ `hands(P)` distinct caretakers perform care today | it *is* the hand count | distinct caretakerIds in today's care events |
| Feast day | ≥ 10 FEEDs today | §23's care multiplier | count of FEED events |

**The bar answers the size of the room, twice.** A flat target is a target a
crowd outgrows: at nine caretakers §23 makes the pet three times hungrier
while ten meals stays ten meals, and one person on a three-minute FEED
cooldown clears it in half an hour. So:

- **Counts scale with appetite.** A count quest's target is
  `round(base × careMultiplier(P) )` — the same per-mille integer arithmetic
  `decayRates` uses, for the reason §23.2 gives. Ten meals at two caretakers
  is thirty at nine. Full bellies is exempt: 70% of a meter cannot be
  multiplied, and the 3× decay underneath it is already the scaling.
- **Every goal wants hands.** Completion additionally requires
  `hands(P) = clamp(ceil(P / 2), 2, 5)` distinct caretakers to have performed
  care today — half the week's active community, floored so a quiet room still
  has a goal it can reach and capped where §23 caps the multiplier. Because
  completion is a conjunction and not a sum, **no amount of solo effort
  finishes a communal day**: a lone caretaker can serve fifty meals and the
  goal stays open. Nothing is discarded or capped — the room simply has to turn
  up. Many hands is the degenerate case where the bar and the requirement are
  the same number.

`P` is the population **frozen at pet-midnight**: the `count` of the newest
`POPULATION` event before the day's first tick (a point read on a partial
index over that rare event type), not the live figure. `PetState.population`
is set by nothing but those events (§23.2), so this is exact rather than an
approximation, and it means an afternoon newcomer raises *tomorrow's* goal
instead of moving a bar the room is already halfway up. A generation older
than its first `POPULATION` event reads as the baseline, so quiet rooms keep
the numbers that shipped before this rule.

A deliberate consequence: a day's goal can now be missed because too few
people showed up. That is what makes it communal, and it costs nothing but the
day's 15 coins.

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
and two fractions, the count and the hands ("Game night — 120 points today ·
60/120 · 3/5 🙋"), sourced from `/api/quest` on load and nudged by
relevant SSE messages (recompute lazily; exactness between refreshes is not
required). The quest text names the day's actual target, so it is generated
from the number rather than stored as prose. Many hands shows one fraction:
its two are the same. Completed state: gold check + "done! +15 🪙 to today's
caretakers".

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

UI: **being funded together is a state a row is in, not a section it lives
in.** A grand item sits in the tab of the thing it affects (§13.2) —
furniture under Room · Decorations, a wall style under Room · Wall Styles, a
venue under Room · Places — and while its pool is open the row carries the
progress bar (`pooled/price`) and two press buttons, +10 and +50. When the
pool needs less than a button offers, the pair collapses to a single **Finish
it** that posts `amount: "all"`, so the last stretch is one tap and no
overshoot. A funded row shows what it became. Contributions are
non-refundable; the tab holding them says so once, in one quiet line under
the rows — once per group would be the third copy of a sentence nobody needs
told three times.

Filing them this way is deliberate. A "Together" section groups items by
their *payment model*, which is the one thing a player does not shop by — it
put a wall colour, a piece of furniture and a day out at the beach in one
undifferentiated list, and made a funded wall style appear twice: once in the
section that funded it and again wherever it is switched on. A funded style
has exactly one row, and that row's action becomes its switcher. A funded
venue has exactly one row too, and that row's action becomes its ballot
(§22.9) — three lives on one id: a pool, then a place in the rotation, then
a place the room can back for tomorrow.

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
   the pet's wander band. The band is a range of *centres*, and the pet is
   more than half the room wide, so the band is the rug inset on both sides
   by how far the pet's feet reach from its centre line, and then clamped so
   the silhouette cannot cross the room's edge. Both insets scale with the
   life stage (§21.9): a hatchling roams further than an adult. Setting the
   band to the rug's own span instead puts the pet half off the rug — which
   reads as a rug torn in two — and its silhouette through the wall.
7. Existing communal decor and grand items draw over the architecture as
   they do today. `window_seat` no longer draws its own window: it
   **upgrades** the room's window with a cushioned bench and a wider
   frame.

**The `picture` decor is the one piece that is a picture.** Every other item
is a handful of rectangles in the theme's palette, which is all a plant or a
lamp needs to read; a portrait, whose whole point is that there is something
on the wall worth looking at, needs more than that. It is a real drawing —
Natsumi and her mouse, `scripts/art/portrait-source.png` — put through a
pixel filter down to 48×48 at 20 colours. It keeps the drawing's own palette
rather than the room's: a painting does not repaint when the walls do (§22.5).
Only its frame is furniture, and only the frame is drawn as rects. It hangs
level with the window, which is the only other thing on that wall.

The filter is a script, `npm run art:portrait`, not a one-off: it crops to the
drawing's own bounds, area-averages each cell **weighted toward ink**, and
median-cuts the result to a palette, writing `portrait.generated.ts` and a
contact print to look at. The weighting is the whole trick — the strokes are
one to three pixels wide on a 449×420 sheet surrounded by white paper, so a
plain mean at 48 across dissolves the drawing into off-white. Keeping the
filter in a script rather than its output in a hand-edited file is what makes
the result reviewable: nobody can tell by eye whether 48 rows of palette
letters are right, but they can tell whether the filter is.

The room paints twice a frame (§10.1) — once into the digest, and again onto
the canvas only if that hash moved — so the picture is cached on an offscreen
canvas and blitted, the way the architecture is (§22.2). Drawing it as the
several hundred rectangles it decomposes into would fold those rectangles
into the digest on every frame forever, which is the wrong price for art that
never changes.

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

In the shop, themes are the **Wall Styles** group of the Room tab (§13.2).
One row per theme, for its whole life: unfunded it carries the §21.8 pool,
funded it carries the switcher, and the one in use carries a badge instead of
a button.

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

**The drawing vocabulary.** Outdoor scenes compose from primitives in
`src/game/scene/backdrop/paint.ts` rather than each one deciding these
again: `ramp` (hue-shifted three-value form ramp), `solid` (a shaded box
lit from one direction), `castShadow` and `shadowStrip`, `bands` (flat
regions with dithered seams), `tuft`, `pebble`, `roots` and `scatter`.

The primitives exist because the first two passes at these scenes broke the
same rules eight different ways, and a rule that lives in a comment is a
rule that gets broken. Each one is the fix for a specific failure:

- **Shade by form, never by distance from the outline.** Objects were
  drawn as a fill with a one-pixel highlight along the top edge whatever
  their shape — pillow shading, the cardinal sin. `solid` gives a lit
  face, a body and a shadow face from one light direction.
- **Ground is flat regions with dithered seams, not one stippled
  gradient.** A surface dithered edge to edge is a field of noise with
  nothing for the eye to rest on, and detail drawn over it cannot read.
- **Texture is clusters, never single pixels.** A lone scattered pixel
  reads as a rendering fault. `tuft` carries four silhouettes on purpose:
  one shape repeated across a field reads as tiling, and the eye finds the
  repeat immediately.
- **Every object throws a shadow.** Without one it is pasted onto the
  ground rather than standing on it. `castShadow` is for compact objects;
  `shadowStrip` is for wide flat ones, because an ellipse scaled to
  something as wide as a garden bed becomes sixty rows tall.
- **Light arrives from the sky, not from a spotlight.** It lands hardest
  near the horizon and falls away toward the viewer. Two soft cones at
  fixed positions on every venue read as torch beams on carpet, and at any
  real strength they wash every ground to the same pale film.
- **Palette entries are declared and integral.** Ramps live in the venue's
  own palette rather than being derived mid-render, and their channels are
  rounded — a palette entry carrying 236.4 never byte-matches the 236 that
  lands in the buffer, which is what the readability check compares.

### 22.7 Delivery Phases

| # | Phase | Deliverable | Done when |
| --- | --- | --- | --- |
| **B1** | Atmosphere core | `src/sim/atmosphere.ts` + tests | segment, weather, and season are pure, deterministic, and season-weighted |
| **B2** | Room and sky | Full architecture rebuild + dithered dynamic sky, sun/moon/stars/clouds | the room reads as a place at every hour; sky cache invalidates correctly |
| **B3** | Weather and season | Rain, snow, overcast, seasonal views | each forecast renders distinctly and the room tints with it |
| **B4** | Condition | Room warmth and dimming from derived state | a critical pet is visibly rough on the room before the meters are read |
| **B5** | Themes | Theme registry, `cabin` and `seaside` as grand items, switching | two caretakers fund a theme, switch to it, and both rooms change |
| **B6** | Venue framework | `venueAt` rotation, `Venue` abstraction, room refactored into the `home` venue, `garden` and `meadow` | `home` renders pixel-identical to before the refactor; every client draws the same venue on the same pet-day |
| **B7** | Funded venues | `beach` and `forest` as grand items joining the rotation pool | funding a venue adds it to rotation for every client; an unfunded venue is never drawn |
| **B8** | Four more places | `blossom`, `pond`, `shrine`, `mountain`; the night spent at home | each new venue holds §22.6's promises at every hour, weather and season; Makoto is in the room every night whatever the day's venue was |
| **B9** | The ballot | `venueBallots`, home-unless-voted, the weighted race, `POST /api/shop/vote`, the funded row becoming a ballot (§22.9) | an unvoted room never leaves home; two caretakers back different places and both browsers show the same odds and the same venue at the day turn; a vote never moves today's scene; the cap holds under concurrent votes without overcharging |

### 22.8 Day-Trip Venues

The same room every day, however alive, eventually reads as wallpaper. So
Makoto goes places: the room can plan a day out at a **venue**, a full
outdoor scene drawn under the same sky. Where a day is spent obeys both of
§22's governing constraints: it is **shared** (one draw per pet-day, from
data every client holds) and it is **presentation** (no `PetState`, no event
log — a venue changes what is behind the pet, never what the pet is).

**Makoto stays home unless the room votes it somewhere else.** There is no
home-or-away roll. An outing is not something that happens to a room; it is
something a room decides, the day before, by spending coins on the ballot
(§22.9). A day nobody backed is a day at home.

This is the rule the rest of §22.8 hangs off, and it earns its place three
ways. It makes every trip something a person chose and paid for, which is a
better reason to keep playing than waiting on a dice roll. It removes the
tuning problem entirely — under a random rotation each new venue makes every
*other* venue rarer, so growing the catalog quietly makes the room worse at
the thing it was grown for. And it gives home its meaning back: the default
state of the world, carrying the community's funded themes and decor, rather
than a percentage competing with the novelty.

**The draw.** `venueAt(seed, dayIndex, ownedVenueIds, tickets)` in
`src/sim/atmosphere.ts`, beside the weather forecast it mirrors. The runners
are the venues that are **both owned and backed**; with none, the answer is
`home`. Otherwise a single `RNG_PURPOSE.venuePick` draw walks the ticket
table — the same weighted walk `weatherFor` takes. `dayIndex` is
**`petClock`'s day index** (epoch days in the pet's zone — the same
arithmetic the weather forecast already keys on), and the runners come from
the venue catalog **in declaration order**, so the pick cannot depend on
array-order accidents. Like the forecast, the day's venue is fixed the
moment its `dayIndex` turns over — two caretakers a continent apart discuss
the same meadow.

Filtering on the pool *as well as* the tickets is what stops a stale or
hostile ballot from sending Makoto somewhere nobody paid to unlock.

**It is a race, not a tally.** The most-backed venue is the favourite, never
the winner: one ticket on the meadow against thirty on the mountain still
takes the meadow one day in thirty-one. Backing an underdog is a long shot
rather than a wasted coin, and the room that pooled hard for tomorrow still
gets a morning it did not expect.

**The pool is state, and that is fine.** Which venues are owned is mutable
server state, not a seeded fact — so determinism comes from the inputs, not
the function alone. `roomState` already broadcasts to every client (theme
switching depends on it); the venue pool and the day's ballot ride the same
object, so every viewer computes the same venue from the same
`(seed, dayIndex, pool, tickets)`.

**The venues.**

Each venue sets **its own horizon**, and that is what makes it a place
rather than a tint. A shared eye line with a shared recipe — sky, a thin
silhouette strip, one flat plane of ground — produces scenes that differ
only in colour, and at this resolution colour is not a location. So the
forest is roofed and hemmed in at 66, the meadow is almost all sky at 126,
the pond is almost all water at 62. What separates them is composition:
where the eye line sits, what breaks it, and how much of the frame each
element is allowed to take.

| Venue | Availability | Scene |
| --- | --- | --- |
| `home` | always | the room of §22.3, themes and decor unchanged |
| `garden` | free | enclosed backyard: a board fence and a shed fill the upper third so there is barely any sky, with boarded raised beds, a watering can and a robin on the rail |
| `meadow` | free | horizon down at the pet's feet under an enormous sky; hazed ridges, a worn track, stems rising off the bottom edge, birds |
| `blossom` | grand item, 700 | a cherry avenue of nine trees, a bough thrown across the top of the frame, a cast-iron lamp post, two benches and planted beds; the season does the work — bare, pink, green, red-gold — and petals drift in spring |
| `beach` | grand item, 800 | a rocky cove: a sea stack with a black pine leaning off it, a wet rock shelf of tide pools, weed and barnacles, a boat hauled up out of the water |
| `pond` | grand item, 850 | water owning the frame, stepping stones crossing it, lily pads, reeds at the near edge, koi drifting below the surface |
| `forest` | grand item, 950 | roofed clearing: canopy hanging from the top edge, two trunks running the full height with the pet walking *behind* them, dappled light, a fallen log, mushrooms |
| `shrine` | grand item, 1100 | a torii big enough to stand under, a shimenawa with paper streamers, paving courses, stone lanterns and a water basin |
| `mountain` | grand item, 1400 | the snow-capped cone far above the horizon, layered ridges, a lake holding its reflection with a boat on it, a shingle shore |

**Architecture.** A `Venue` supplies its named ramps and its back-to-front
draw layers; the current room becomes the `home` venue rather than a special
case, and must render pixel-identical through the refactor. Outdoor venues
draw the sky **directly** — no window, no pane. The sky machinery (§22.2)
is already theme-independent, so sun, moon, stars, clouds, weather, and
season reuse wholesale; weather renders full-bleed, and the window's light
pool generalizes to direct sun patches. The wander band is venue-defined:
the rug-inset rule of §22.3 generalizes to each venue's ground span, with
the same stage-scaled insets and the same clamp against the scene's edges.

Communal decor and grand furniture draw on `home` only — a kotatsu in a
meadow is a joke, not a place. Condition dimming (§22.7 B4) applies
everywhere: a struggling pet roughens the meadow exactly as it roughens the
room.

**The night is spent at home.** Whatever the day's venue, Makoto comes back
to its own bed: while `sleepReason === "NIGHT"` the scene is `home`, and the
caption — which reads from the same resolver, so the two can never disagree
— says nothing. A pet asleep in a field is not a place, it is an
oversight. Naps and lullabies deliberately do **not** relocate the scene:
they are minutes long and can strike at any hour, and cutting the meadow
away mid-afternoon to show a dark room, then back, would read as a bug
rather than as bedtime. A nap that runs past bedtime is already promoted to
`NIGHT` by the projection, so the pet is home by the time it matters.

**Funding.** Every venue but `garden` and `meadow` is an ordinary §21.8
grand item — the `funding` collection, the contribute route, the `FUNDED`
milestone, the top-three-contributors feed line — with one distinct effect:
on funding they join the rotation pool via `roomState` instead of placing an
object in the room. No new economy mechanics. In the shop they are the
**Places to Visit** group of the Room tab (§13.2), where a funded one reads
as somewhere Makoto can now go rather than as something bought. Their ids
**are** the venue ids, and the catalog constrains them to `VenueId` so a
drifting spelling is a compile error rather than a pool that quietly takes
coins for a place that can never be drawn.

**Visibility.** A small caption beside the difficulty line names the day's
location — *"Makoto is at the meadow today"* — so an away day reads as an
outing, not a bug. The sky's offscreen cache key gains the venue; the §22.6
readability check runs against each venue's darkest and lightest extremes;
reduced motion holds each venue's moving elements exactly as it holds the
room's.

### 22.9 The Venue Ballot

Once a venue is funded its shop row has nothing left to do — it becomes a
static badge, and the coins that bought it stop meaning anything. So the row
gets a second life: **caretakers spend coins to weight tomorrow's draw.**
This is the same move §21.8 already makes for wall styles ("a funded style
keeps its row and trades its pool for a switcher"), taken one step further —
a funded venue keeps its row and trades its pool for a ballot.

**Tickets.** Ten coins buys a venue one ticket for a given day, up to
**thirty per venue per day**. A venue with no tickets is not in the race at
all, which is what makes an unvoted day a day at home.

One ticket is enough to win an uncontested day, and that is deliberate: ten
coins is a single fulfilled want, so any room with one active caretaker goes
wherever it likes whenever it likes. Unlocking a venue buys **eligibility**;
the ballot buys the trip. The shop says so plainly rather than letting
somebody discover it after paying 1400 for a mountain.

The cap is an anti-whale device, and its height is the point. Too low a
ceiling and two caretakers backing different places deadlock with no way to
express who wants it more; at thirty the disagreement stays live and the
room negotiates — ten coins against three hundred is one-in-four, not a coin
flip. Nobody is obliged to spend it: a few tickets already tilts a day, and
that is what most days will look like.

**Free venues are votable too.** The ballot is open to everything in the
rotation pool, so `garden` and `meadow` can be backed like anywhere else —
they are the budget trip, not second-class. A ballot that only accepted
funded venues would let the room outvote its two free places 30:0 with the
very places they are meant to compete with.

**Votes weight tomorrow.** A vote cast on pet-day D applies to **D+1**. The
day's venue is fixed the moment its `dayIndex` turns over (§22.8) and
nothing may move it afterwards — a scene that cut away mid-afternoon because
somebody paid would break the one promise the rotation makes. Tomorrow also
means every caretaker's coins are still in play when the draw happens,
rather than the last voter of the day winning by turning up last.

**Show the odds, never the outcome.** Tomorrow's winner is computable the
instant the last vote lands — it is a pure function of a seed, a day and a
ballot everyone holds. Surfacing it would turn the race into a bidding war
with perfect information, where the play is always to vote last. The row
shows a venue's *share* of tomorrow and nothing more.

**One row per day, and no rollover.** The `venueBallots` collection is keyed
by the pet-day the tickets weight: a vote on day D writes the row for D+1,
and once D+1 arrives its row is simply never written again. There is no job
that rolls a ballot over, no document that mutates as the day turns, and a
**missing row is meaningful** — nobody voted, so every venue holds its one
ticket. This is the idiom §21.7's quest records and the weekly budget rows
already use: a new day simply has no row yet.

**Determinism.** The ballot rides `roomState` beside the venue pool, so
every viewer computes the same venue from the same
`(seed, dayIndex, pool, tickets)`. The broadcast carries the rows for
**yesterday, today and tomorrow**, and each client selects by *matching* the
day rather than by position — which is what makes the midnight turn seamless
through the room cache, and a stale broadcast harmless rather than a
divergence. Ticket counts arrive over the wire, so the draw clamps them:
negative, fractional, oversized and non-finite entries all collapse to
something every client agrees on.

**Paying for it.** Tickets are claimed **before** coins are charged, and
only what lands is billed. Votes are non-refundable, so the failure that
must be impossible is taking coins for a ticket that did not fit; a ticket
counter briefly high harms nobody, since the ballot it belongs to is
tomorrow's. `POST /api/shop/vote` takes **tickets**, not coins — the cap is
denominated in tickets, so that is the unit the server clamps in — and is
rate-limited on both buckets like any route that spends.


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
care action within the last `BUDGET_WINDOW_DAYS` (7) pet-days, because the
people who supply care are exactly the people who should set the demand.

That window is **bucketed by pet-day rather than continuous**: it holds seven
day buckets and advances one at each pet-midnight, so the effective lookback
oscillates between six and seven days and a cohort ages out together. This is
not an approximation of a smoother rule — it is the same arithmetic
`budgetRemaining` (§2.5) applies to each caretaker's allowance
(`day - (BUDGET_WINDOW_DAYS - 1)`), so supply and demand share their
boundaries and step in phase instead of drifting apart. A consequence worth
naming: difficulty can fall at a pet-midnight when a cohort ages out, and
never mid-day. It only ever falls that way, so no one can be stranded by it. Need decay is then multiplied
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

## 24. Caretaker Titles

Among five friends, the leaderboard stops motivating the moment it
stabilizes: everyone knows who is #1, and that rarely changes. Titles give
every caretaker a niche orthogonal to raw score — earned by *how* you play,
not how much. They are **contested**: each title has exactly one current
holder, it can be taken, and losing it is itself an event. Standings are
**per-generation**: a new egg wipes every slate, so each death gives the
whole community a fresh shot at every title, and the memorial records who
held what when the pet died.

Titles are server-side derived data. Nothing here touches `PetState` or the
event log; the fold does not know titles exist.

### 24.1 The Roster

| Title | Chip | Held by whoever has the most… |
| --- | --- | --- |
| Night Nurse | 🌙 | accepted care actions between 0:00 and 6:59 pet-local |
| Chef | 🍳 | favorite-food FEEDs (the generation's quirk) |
| Groundskeeper | 🧹 | CLEANs |
| Sandman | 🎵 | LULLABYs that actually put the pet to sleep |
| Cuddler | 🤗 | PETs |
| Wish Granter | ⭐ | pet wants fulfilled (§25) |

Two definitions are deliberately narrower or wider than the obvious one:

- **Night Nurse counts any accepted care action**, not just MEDICATE. A
  MEDICATE-only rule would be a sickness lottery — the pet must happen to be
  sick between midnight and seven, which whole generations may never see.
  The point of the title is "was there at 3am", not "won a dice roll".
- **Sandman counts only lullabies that transitioned the pet to sleep.** A
  night lullaby sung to an already-sleeping pet validates but applies
  nothing; counting it would make the title farmable by cooldown-paced
  no-ops. The write path detects the transition from the care outcome's
  `SLEPT` milestone.

A title with no qualifying action yet has **no holder**, and every surface
renders that state plainly. The minimum to hold a title is a count of one.

### 24.2 The Contest

The holder is whoever *first* reached the current maximum count: a
challenger takes a title only by **strictly exceeding** the holder's value.
Ties keep the incumbent — being first is worth something, and the strict
rule is also what makes the claim a race-free compare-and-swap (§24.3). A
holder raising their own count keeps the title silently; a takeover is
announced everywhere: *"🌙 Emilio took Night Nurse from Ana"*.

At death, the final holders are frozen into the memorial exactly as quirks
are (§21.4): written once at seal time as an optional field, no backfill,
older generations simply lack it.

### 24.3 Counting and Claiming

Counting follows the incremental-counter idiom the leaderboard established
(§2.11): stats are `$inc`'d on the care write path, never scanned from the
event log. A shared helper — called from **both** `/api/care` and
`/api/play`, the two routes that already call `recordContribution` —
classifies each accepted action into the titles it advances (the night
window comes from a new `localHourAt` in `src/server/schedule.ts`, the only
timezone-aware module; the favorite-food check from `quirks(seed)` and the
event's `itemId`).

Two collections in a new `src/server/titles.ts` (house module conventions:
own accessors, `ensureIndexes` guard, test reset seam):

- `titleStats` — `{ generationId, caretakerId, counts: { [titleId]: n } }`,
  unique on `(generationId, caretakerId)`. The increment is a
  `findOneAndUpdate` returning the post-increment value — an `updateOne`
  cannot say what the new count is, and the claim needs it.
- `titles` — `{ generationId, titleId, caretakerId, value, takenAt }`,
  unique on `(generationId, titleId)`. The claim is a single atomic
  `findOneAndUpdate` guarded by `value $lt` the challenger's new count,
  returning the **prior** document. The prior holder must come from that
  same atomic operation: a separate read can name the wrong loser under two
  concurrent takeovers. The takeover message is published only when a prior
  holder existed and differs from the winner. First claim inserts via the
  duplicate-key retry `records` uses. Under concurrent care writes the two
  `$inc`s produce distinct values and the `$lt` guard resolves either
  arrival order to the same winner.

The takeover broadcast is a pure `title` message on the existing fan-out —
the `record` message's shape and lifecycle, carrying winner, loser, title,
and value, with nicknames resolved through `nicknameMap`.

### 24.4 Visibility

- **Presence.** `presenceView()` joins current holders beside the nickname
  lookup it already does, so every presence message carries each watcher's
  titles. The `👥 N watching` pill becomes an expandable list — names, title
  chips, and the current generation leader's crown, honoring §2.11's
  original promise now that a presence list finally exists.
- **Leaderboard.** A Titles block using the records section's row
  conventions: `title · holder · count`.
- **Feed.** Takeover messages render live; titles are not milestones, so
  they are live-only in the feed, like records — the durable record is the
  holder itself, visible in presence and leaderboard.
- **Memorial.** Each sealed generation lists its final holders.

### 24.5 Delivery Phases

Same rules as §20: green typecheck, lint, and tests per phase, one commit
per seam.

| # | Phase | Deliverable | Done when |
| --- | --- | --- | --- |
| **T1** | Titles server | `titles.ts` (stats, CAS claim, announce), `localHourAt`, `title` message | concurrent-write test yields one holder and the true prior holder; night and Sandman classification unit-tested |
| **T2** | Wiring | both routes through the shared helper, memorial freeze, `presenceView` join | a sealed generation records holders; Wish Granter counts once §25's helper lands |
| **T3** | UI | presence list with chips and crown, leaderboard block, memorial | e2e: a title changes hands and re-renders in presence, leaderboard, and feed |


---

## 25. Pet Wants

Everything the pet has ever said to its caretakers is a complaint: a meter
falls, an alert fires, someone fixes it. Wants give Makoto the other half
of an interior life — the pet occasionally *asks for something*: a food it
is craving, a game it feels like playing, a cuddle, a dust bath. Granting
the wish inside its window pays a joy bonus, coins, and a delighted
animation. Letting it lapse costs a small, real slice of joy: the user
chose genuine stakes over a cosmetic sulk, and the difference is what makes
a want a request rather than a decoration.

### 25.1 The Want

Pet-days divide into fixed windows of `WANT_WINDOW_TICKS` (540 ticks —
90 minutes), indexed globally: `windowIndex = floor(tick /
WANT_WINDOW_TICKS)`, genesis-anchored like `petDay` (partial windows at DST
shifts are accepted and documented, not special-cased). A pure
`wantAt(seed, windowIndex)` in `src/sim/wants.ts` decides each window with
two independent draws, exactly the `ambient.ts` shape: an odds draw against
`WANT_ODDS_P32` (≈1/3 of windows), then a weighted pick:

| Want | Fulfilled by | Weight |
| --- | --- | --- |
| `crave-food` — a specific food item | FEED with that `itemId` | 3 |
| `play-game` — a specific minigame | a plausible finish of that game | 2 |
| `cuddle` | PET | 2 |
| `dust-bath` | CLEAN | 2 |

`crave-food` picks over `FOOD_ITEM_IDS` excluding the generation's disliked
food — the pet does not crave what it hates — and may land on the favorite,
in which case fulfilling it stacks both bonuses: a rare, accepted jackpot.
The draws use one `RNG_PURPOSE` each, the ambient convention: `wantOdds`,
`wantPick` (the kind), and `wantItem` (the food or game within the kind) —
never a reused purpose, which would collapse "independent" draws into one.
`wantAt` is **schedule-free**: the sim never asks what hour it is. Whether
a window actually *opens* is the leader's decision (§25.2), because waking
hours are schedule knowledge the sim deliberately lacks (§4.5).

### 25.2 Lifecycle: Leader-Appended Fold Events

A want that can debit joy must live in the fold, and §23.2 already names
the only honest way in: **as an event**. Two new event types, appended by
the leader, folded by the reducer — the `POPULATION` precedent, not
milestones, because milestones are assertions and can never change state:

- `WANT_OPENED { windowIndex, want }` — appended at the first tick of a
  window whose `wantAt` drew a want *and* whose span the leader's schedule
  places in waking hours, *and* only while the pet is born and alive
  (`isAlive` — no cravings from an egg, no debits against a corpse mid-
  mourning; on death an open want simply dies with the generation, no
  `WANT_EXPIRED` appended). Sets `PetState.wantOpen`.
- `WANT_EXPIRED { windowIndex }` — the trigger is **state-shaped, not
  calendar-shaped**: whenever `wantOpen` is set and the clock stands at or
  past its window's end, the leader appends the expiry — late is legal, so
  a want left open across a leader outage is expired by whichever leader
  next observes it, *before* any newer window may open. Subtracts
  `WANT_EXPIRY_JOY_DEBIT` from joy through the standard `[0, NEED_MAX]`
  clamp and settles the window.

**The reducer's rules are exact, and they are the idempotence guard** —
spec text, not implementation detail, because two honest readings would
fold the same log differently. State carries two optional fields:
`wantOpen: { window, kind, itemId? } | null` and `wantSettledWindow:
number | null`, a monotonic high-water mark set by *both* ways a window
can settle:

- `WANT_OPENED { W, want }` folds only when `wantOpen == null` **and**
  `W > wantSettledWindow` (an absent mark reads as −∞). Otherwise a no-op.
- `WANT_EXPIRED { W }` folds only when `wantOpen != null` and
  `wantOpen.window === W`: applies the clamped debit, sets
  `wantSettledWindow = W`, clears `wantOpen`. Otherwise a no-op.
- Fulfillment (§25.3) likewise sets `wantSettledWindow` and clears
  `wantOpen`.

The high-water mark is what makes duplicate appends harmless *in the
fold*: an expired window cannot re-open, so no sequence of replayed or
re-appended events can debit the same window twice. There are **no Redis
once-keys at all**: the post-lock prepare re-check (below) makes a
duplicate append impossible in the first place — the first append changes
the exact state the second one's prepare inspects — and an earlier draft's
`SET NX` guards were worse than redundant, because a key set by a leader
that crashed before its append would suppress the retry until the key
expired. §6.2's invariant that Redis holds no unique durable state is
preserved trivially: the wants feature stores nothing in Redis.

**The logged payload is authoritative.** The reducer never calls
`wantAt`; it folds what `WANT_OPENED` says was wanted, exactly as the log
is trusted everywhere else — so retuning odds, weights, or catalogs never
re-folds an old log differently, and `wantAt` is consulted only by the
leader at append time (and by tests). A want kind the folding code does
not recognize (an older pod folding a newer leader's log mid-deploy) is
unmatchable, never a crash.

**Appends run under the write lock.** The leader decides from observed
state, but observation races care writes: a want can be granted between
"still open → expire" and the append. Both appends therefore go through
`advance()`'s prepare callback — the same post-lock validation every care
write gets — and skip when the locked state disagrees, so a granted want
can never acquire a durable "lapsed" record in the log.

**Serialization discipline.** Clearing `wantOpen` assigns **explicit
`null`** — the `sickSinceTick` idiom — never `undefined`, and never
deletion: the three serializers state rides through disagree about
`undefined` (`structuredClone` keeps the key, the Redis hot-state
`JSON.stringify` drops it, the Mongo driver stores BSON `null`), which is
exactly how a snapshot-recovered fold drifts from a fold-from-genesis.
Presence checks are `!= null`; the optional `itemId` inside the payload is
built by conditional spread, never `itemId: undefined`; the Mongo client
gains `ignoreUndefined: true` as defense in depth. A property test pins
it: a snapshot taken mid-window recovers to a state that stringifies
identically to the from-genesis fold at the same seq.

Both events render in the feed — `/api/feed`'s type filter widens from
`CARE`/`MILESTONE` to include them, or lapses would silently vanish from
history — so the feed and the state can never disagree about what lapsed.

**Replay identity.** Histories recorded before this section contain
neither event type, so they fold byte-identically through the new code —
no golden-fixture regeneration, no retroactive debits, no snapshot
divergence. Genesis leaves both new fields absent, the `population`
precedent. (An earlier draft derived expiry at projection-time window
boundaries; adversarial review showed that breaks §3.1 — a pre-feature log
would replay debits that were never lived — and that per-segment schedule
context makes "was the pet awake at that boundary" path-dependent. Events
delete both failure classes.)

**Accepted gaps**, stated rather than discovered: while no leader runs,
wants neither open nor expire — the same tradeoff quest settlement made.
And a debit that drops joy below `CRITICAL_THRESHOLD` is **milestone-
silent**: projection detects crossings only within its own decay step, so
an event-caused crossing never emits `CRITICAL` (the same latent behavior
`PLAY`'s energy cost has today). Push alerting is unaffected — the
dispatcher observes values, not milestones (§12).

### 25.3 Fulfillment

Fulfillment folds in the reducer, in the `CARE` case beside the quirk
multipliers. A care event fulfills iff **all** of:

- it matches `state.wantOpen`'s kind (and `itemId`, where the kind names
  one);
- `floor(event.tick / WANT_WINDOW_TICKS) === wantOpen.window` — the
  deadline is enforced *in the fold*, as pure log arithmetic, so a leader
  outage can never convert a lapsed want into an hours-late jackpot;
- its applied restoration is greater than zero — a budget-exhausted no-op
  does not grant a wish, the same rule that keeps Sandman honest (§24.1).

Then, in order:

1. The action's base magnitude is scaled `base = floor(base ×
   WANT_BONUS_PERCENT / 100)` — a multiplier, the `quirkFoodPercent`
   convention, **not** the toys' additive convention — applied last among
   the pre-curve modifiers, before the diminishing-returns curve.
2. `wantSettledWindow` is set to the window, `wantOpen` is cleared to
   `null`.
3. The reducer emits a `WANT_FULFILLED` milestone — the `RECOVERED`
   precedent — so every client receives it in the **same SSE burst** as the
   care message. The delight lands on the action, not ten seconds later.

No schedule check exists here: a want can only be open because the leader
opened it. A care event landing on exactly the boundary tick resolves
against the expiry event by `seq` order — the log's total order is the
tiebreak, either order replays identically. `play-game` wants match through
the PLAY event's optional `itemId`, which `/api/play` injects
**server-side** from its session's fixed game; `/api/care` never accepts a
gameId, and its `itemId` remains a consumable reference.

The pet's reaction reuses the favorite-food vocabulary: `celebrating`
one-shot, heart particles, a feed line. Expiry plays a brief sulk beat and
a feed line ("Makoto sighs… nobody brought pizza"); reduced motion gets the
feed line only.

### 25.4 Rewards

The fulfilling caretaker earns `WANT_REWARD_COINS`. Coins live outside the
fold (§13.1), so payment happens on the write path: `engine.care`'s outcome
gains the milestones the reduce step emitted, and the same shared helper
that counts titles (§24.3) — called from both `/api/care` and `/api/play` —
credits the coins when the outcome carries `WANT_FULFILLED`. The reducer's
once-per-window settlement makes the payment **at-most-once** with no
marker collection and no log scan — honestly named: a crash between the
event append and the credit loses that payment forever, since replay
discards re-emitted milestones. Ten coins on a crashed pod is an accepted
loss; a double payment would not be. The same signal increments Wish
Granter.

### 25.5 Expiry Is Not Griefable

§2.4's guarantee survives inspection: expiry is caused by *inaction*, and
there is still no action in the game that harms the pet — the worst a
malicious visitor can do about a want is fulfill it. The debit is a single
bounded subtraction from one warning-light need, once per window at most,
at most a handful of windows per day; joy cannot kill except through the
health-drain arithmetic of §2.3, hours away from any single want.

### 25.6 Push

A want push exists for exactly one situation: the room is empty and the pet
is asking for something. The dispatcher derives the open want from
`state.wantOpen` — no new inputs — and sends only when `listPresence`
returns nobody (the 45-second presence TTL means a just-departed viewer
suppresses it briefly; accepted). It is the first **playful-lane** push,
and the lanes are asymmetric by design:

- The playful lane has its own per-caretaker throttle
  (`WANT_PUSH_THROTTLE_MS`, 4 hours) and a per-`generationId:window` fired
  key so the 10-second observation loop sends once, not once per tick.
- Playful **consults** the urgent lane: no want push within 30 minutes
  after a critical, sickness, or death notification. Urgent never consults
  playful. "Makoto is dying" is never followed minutes later by "Makoto
  craves cheese", and a want push can never starve a health alert of its
  throttle window.

### 25.7 Visibility

The live want appears in a slim banner beside the quest banner (same
conventions: one `subscribe` prop, debounced refresh), with the want's icon
and a countdown to the window's end. The state stream already carries
`wantOpen`, so the banner needs no extra round trip. Feed lines cover all
three lifecycle edges: asked, granted (with the granter's name), lapsed.

### 25.8 Tuning

Feature constants live in `src/sim/wants.ts`, per the house convention
(quests, quirks, and ambient each carry their own):

| Constant | Value | Meaning |
| --- | --- | --- |
| `WANT_WINDOW_TICKS` | 540 | 90-minute windows |
| `WANT_ODDS_P32` | `floor(2³² / 3)` | ≈1/3 of windows draw a want — ~3 asked per waking day |
| `WANT_BONUS_PERCENT` | 150 | fulfillment multiplier (`floor(base × 150 / 100)`), pre-curve |
| `WANT_EXPIRY_JOY_DEBIT` | 50 000 | flat need-units (5% of `NEED_MAX` = 1 000 000), clamped subtraction |
| `WANT_REWARD_COINS` | 10 | paid to the fulfiller |
| `WANT_PUSH_THROTTLE_MS` | 14 400 000 | one playful push per caretaker per 4 h |

### 25.9 Delivery Phases

Same rules as §20. The A-track below is sequential; §24's T-track is
independent of it except Wish Granter (lands in T2, after A3–A4).

| # | Phase | Deliverable | Done when |
| --- | --- | --- | --- |
| **A1** | Sim vocabulary | `wants.ts`, rng purposes, `WANT_OPENED`/`WANT_EXPIRED` event types, `WANT_FULFILLED` kind, optional state fields (`wantOpen`, `wantSettledWindow` — absent at genesis, the `population` precedent) | determinism and rate tests green; every existing test untouched |
| **A2** | The fold | reducer open/expire/fulfill, bonus arithmetic | boundary-tick seq test; idempotence tests; existing golden fixtures pass unmodified |
| **A3** | Engine + leader | outcome milestone plumbing, leader open/expire with NX guards | each window opens and expires exactly once under leader restart and failover |
| **A4** | Routes | shared helper in `/api/care` and `/api/play`, server-side gameId | fulfillment pays exactly once from either route; gameId never client-supplied |
| **A5** | Push | playful lane, fired keys, empty-room gate | playful never consumes or blocks urgent; urgent recency suppresses playful; sends only to an empty room |
| **A6** | UI | want banner, feed lines for the new event types, fulfill and sulk beats | e2e: a want is asked, granted with bonus and celebration, and a lapse renders |


---

## 26. The Ancient Code

An easter egg, and the only feature in this document that exists purely
because it is delightful. Typing

```
↑ ↑ ↓ ↓ ← → ← → B A ⏎
```

opens the sky. It is specified in full anyway — the spec is the contract,
not the marketing, and an undocumented secret is just an unexplained
2,000-line diff to whoever reads this next.

Two things happen at once, and they are deliberately different in kind:

| Half | Reach | Lifetime |
| --- | --- | --- |
| **The spectacle** | every connected client, simultaneously | ~8 seconds, then gone without a trace |
| **Retro mode** | only the caretaker who typed it | permanent, on this browser |

The pairing is the design. The spectacle alone leaves the finder with
nothing to keep; retro mode alone is a secret nobody can witness, in an app
whose entire thesis is that we are all watching the same animal. Together,
finding it is a communal event *and* a personal souvenir.

### 26.1 The Sequence and the Listener

`src/app/hooks/konami.ts` holds the sequence and a pure matcher; the DOM
lives in `src/app/hooks/useKonami.ts`. Splitting them is what lets the
matcher be unit-tested without a browser, and the matcher is where all the
subtlety is.

```
KONAMI = [ArrowUp, ArrowUp, ArrowDown, ArrowDown,
          ArrowLeft, ArrowRight, ArrowLeft, ArrowRight, b, a, Enter]
```

Matched against a **rolling buffer of the last 11 keys**, not an
advance-or-reset index. An index that resets to zero on mismatch gets
overlapping prefixes wrong — the classic failure is `↑↑↑↓↓…`, where the
third `↑` should leave the matcher one key in rather than back at the
start. A rolling buffer has no such case to get wrong, and comparing eleven
values on keydown is free.

`b` and `a` compare case-insensitively (`event.key.toLowerCase()`), so caps
lock does not eat the secret.

The listener is inert unless every one of these holds:

- **No dialog owns the keyboard.** Five of the ten minigames bind arrow
  keys (`DustDash`, `SnackCatch`, `SausageParty`, `NatsumisWatch`,
  `MakotoShuffle`), and the shop
  is a modal. A live game must never half-arm the buffer, so the hook takes
  an `enabled` flag and `GameView` passes `!playing && !shopOpen`.
- **The event is not typing.** Keydowns whose `target` is an `input`,
  `textarea`, or `contenteditable` are ignored — the nickname editor is a
  text field and `a`/`b` are letters.
- **The event is not an auto-repeat.** `event.repeat` is skipped; holding a
  key down is not eleven presses.

Nothing is ever `preventDefault`ed **except the completing `Enter`**.
Swallowing arrow keys speculatively would break page scrolling for every
visitor in order to catch a secret almost none of them are typing, which is
a bad trade. The final `Enter` is different: at that instant the sequence is
known to be the code, so consuming it is justified and it stops the press
from also activating whichever action button happened to hold focus.

### 26.2 The Broadcast

A new engine message, alongside `react` in `src/server/engine/messages.ts`:

```ts
/** The ancient code (SPEC §26) — pure broadcast, no state, no attribution. */
export type SecretMessage = { type: "secret"; mood: SpectacleMood };
```

**There is no `caretakerId` in the payload, by construction.** Nothing to
attribute means nothing to farm, nothing to harass with, and nothing for
`deliverableTo` to gate — it stays a room message and that function is
untouched. It follows `react/route.ts`'s "zero moderation surface by
construction" exactly: the only field that reaches other clients is a
two-value enum.

`POST /api/konami` takes an empty body and, in order:

1. resolves the caretaker cookie (`resolveCaretaker`),
2. takes a per-IP token (`LIMITS.perIp`) — 60/min, as every route does,
3. takes a per-caretaker token (`LIMITS.perCaretaker`) — this is an action,
4. reads the authoritative state and derives the mood,
5. publishes to `key("events")`.

**Every entry broadcasts.** There is no room-wide throttle. There was one —
`SET mgc:konami:guard 1 NX EX 300`, a single spectacle per five minutes for
the whole room — and it was removed because it did not make the event rare,
it made the feature look broken.

Two things were wrong with it. The caretaker who lost the guard still ran the
full spectacle locally, so the person typing *always* saw the sky open and
nobody else ever did — which is indistinguishable, from either side, from a
dead broadcast, and is exactly how it was eventually reported. And it fired
almost every time, because the way an easter egg actually spreads is one
person trying it and immediately telling someone next to them to try it too:
both attempts inside the same five minutes, the second one silent.

The abuse case it was aimed at is real — the feed is the app's shared memory
(§2.11) and the client holds only the last 120 lines, so a chain of
spectacles evicts genuine care history. The token buckets in steps 2 and 3
are what bound that now: 30 per caretaker refilling at one every two seconds,
60 per IP. That stops a script without ever standing between two friends
passing the code back and forth, and the moment is material-free (§26.7), so
a flood is noise rather than an exploit. Of the two available mistakes,
costing a rare event some of its rarity is much the cheaper one.

| Response | Meaning | Client does |
| --- | --- | --- |
| `200 { mood }` | published to everyone | nothing; the SSE `secret` message drives it, including on this screen |
| `429` | rate limited (flood) | runs the spectacle locally, and says the sky is still settling |

The `429` is the only path that does not reach the room, and the only one
where the client speaks for itself: it draws the spectacle from a mood it
derives locally — `spectacleMood` is pure, and the browser already holds the
projected state — and writes a quiet feed line, so a keypress is never a
silent no-op. This does not bend §8.4. Nobody else is watching *this*
spectacle, so there is no room left to disagree with.

Both paths end at the same `room.spectacle(mood, nowMs)` call. There is one
code path that draws this thing; reaching the room decides only who sees it.

The stream route needs **no change**: it already forwards any message as
`send(message.type, message)`. `usePetStream` gains a `secret` listener and
an `onSecret` subscription beside `onReact`.

### 26.3 Which Mood, When

The mood is derived **server-side** from the authoritative state, never sent
by the client — §8.4 holds here like everywhere else. Deriving it once and
putting it in the message is also what guarantees every screen shows the
*same* spectacle: two clients evaluating "is it asleep" independently could
straddle the wake tick and disagree, and half the room seeing confetti while
the other half sees stars would quietly undo the entire point.

| Pet state | Mood | Why |
| --- | --- | --- |
| Awake and alive | `party` | the ordinary case |
| Asleep | `stars` | the room is already dim and quiet; confetti would be a smash cut |
| Egg (incubating) | `party` | incubation is hopeful, and the naming vote is already a celebration of what is coming |
| Dead | `stars`, whatever the hour | the memorial is not a place for confetti |

Death gets the star shower rather than an exception carved out for it.
Giving the one tonally risky state the version of the effect that actually
suits it is better than suppressing the feature there: an elegy instead of
a party, and the best-looking thing the death screen ever does.

### 26.4 The Spectacle

`src/game/scene/party.ts` — a `Spectacle` class owning both moods. It does
not live in `room.ts`: that file is already 549 lines, and two overlay
renderers plus a starfield would push it past the point where it is
comfortable to reason about (§9 housekeeping).

```ts
export type SpectacleMood = "party" | "stars";

export class Spectacle {
  start(mood: SpectacleMood, nowMs: number): void;
  /** Sky: behind the pet, after the decor. */
  renderBehind(ctx: SceneContext, nowMs: number): void;
  /** Confetti: in front of everything. */
  renderFront(ctx: SceneContext, nowMs: number): void;
  get active(): boolean;
  /** True while a `stars` run owns the dimming — see below. */
  get supersedesNightDim(): boolean;
}
```

Two passes rather than one, because the layering carries the meaning. The
sky goes **behind** the pet so meteors pass at depth and Makoto reads as a
silhouette against it; confetti goes **in front** so it falls past the
camera. One combined pass would put confetti behind the pet or meteors in
front of it, and both look wrong.

`DURATION_MS = 8000` for both moods.

**`party` — 8 seconds, awake**

- A full-canvas colour wash at α ≈ 0.10, its hue stepping through six stops
  on a slow beat. Low alpha on purpose: the room stays readable, and the
  meters beside it stay the thing you can check at a glance.
- Confetti from an **own fixed-size array of 64**, not the shared
  `Particles` pool. The pool holds 128 and recycles the oldest on overflow;
  eight seconds of continuous confetti would evict the crumbs and hearts
  that are the room's feedback for actual care. Confetti falls under
  gravity with a horizontal sway and a per-piece colour.
- The pet loops `celebrating`, re-triggered each time the clip runs out. It
  is a one-shot and the run outlasts it several times over, so it is re-armed
  as it lapses rather than played once at the top.
- Toast over the pet: `the ancient code`.

**The toast names the code; it never spells it.** An earlier draft of this
section had the canvas print `↑↑↓↓←→←→BA`, which is the one thing §26.7's
discovery rule rules out — a toast is shown to every witness, so printing the
sequence is the "feed spells the code out" option arrived at by accident. The
toast says only what the feed line already says.

The star mood's toast is `the sky opens`, for the same reason and in the same
register.

**`stars` — 8 seconds, asleep or dead**

| t | What |
| --- | --- |
| 0.0s | room as normal |
| 0.3s | indigo wash ramps to α ≈ 0.75 across the whole canvas — walls, floor and decor all sink beneath it |
| 0.8s | starfield fades in: ~40 fixed 1px points, three brightnesses, twinkling on their own phases |
| 1.0s | meteors begin — corner to corner, staggered, varied length and speed, a 3px head with a five-dot fading tail |
| 6.5s | the shower thins |
| 7.2s | wash ramps back down |
| 8.0s | the room again; Makoto never woke |

Everything here is drawn in `renderBehind`, so the wash never touches the
pet — it sinks the *room* and leaves the animal lit against it, which is
the whole image.

The starfield and the meteor schedule come from the same
deterministic-enough LCG `Particles` uses, seeded per run: the frame digest
(§10.1) replays `paint` to decide whether to draw, so a spectacle that
generated fresh randomness on each replay would hash differently every frame
and defeat the skip.

While a `stars` run is active the room's existing sleeping dim is
**skipped** — the indigo wash supersedes it. Both would double-dim, and the
scene would come back to normal in two visible steps instead of one.

The existing `shooting-star` ambient (§21.5) is the same phenomenon at
ordinary volume: three small streaks confined above the wainscot so they
read as sky through the window. This is that turned all the way up, which
is why it is worth them sharing a visual vocabulary rather than being two
unrelated effects.

**Audio** — `GameAudio.playSecret(mood)`. `play()` currently hardcodes
`osc.type = "square"`; it gains an `OscillatorType` parameter defaulting to
`"square"` so nothing else changes.

| Mood | Sound |
| --- | --- |
| `party` | a rising square-wave fanfare, volume 0.10 |
| `stars` | a slow triangle-wave arpeggio, volume 0.05 — the same timbre as the ambient pad, so it reads as the room breathing rather than an alert |

Muted by default like all audio, and `play()`'s existing mute check is the
only gate needed.

**Feed lines** — the canvas is `aria-hidden`, so the feed is what actually
carries this to a screen reader, as with every other scene event (§11.3).

| Mood | Line |
| --- | --- |
| `party` | 🎮 Someone remembered the ancient code. |
| `stars`, asleep | 🎮 Someone tried the ancient code. Makoto slept right through it. |
| `stars`, dead | 🎮 Someone remembered the ancient code. The sky remembered too. |

### 26.5 Retro Mode

The keepsake. `localStorage["mgc:retro"]` is absent until the code is found
and holds `"on"` / `"off"` thereafter — one key carrying both *unlocked* and
*enabled*, because "found it but switched it off" and "never found it" need
to be told apart and nothing else does.

Finding the code writes `"on"` and toasts `📺 RETRO MODE UNLOCKED`. The
unlock fires **once and once only**: after that, whether the display is on is
the caretaker's standing choice, and re-entering the code throws the
spectacle without overruling it. The header toggle is the only thing that
switches it back on.

The key is per browser *origin*, port included, so two dev stacks on
different ports keep entirely separate keepsakes — one can be on while the
other is off, which looks like an inconsistency and is not one. A 📺
button then joins the header cluster beside the 🔇 mute toggle, on this and
every future visit, carrying `aria-pressed` and an `aria-label` that names
the direction of the press (`Turn the retro display on` / `…off`) — the same
shape as the mute button it sits beside. Off, it is dimmed and desaturated,
so the control reads as switched off rather than merely unlit. Caretakers who
have not found the code have no such button, and a 📺 in someone else's
screenshot is the only clue this feature exists anywhere in the product.

**The whole app is inside the television, not just the room.** A single fixed
overlay rendered from the root layout (`src/app/components/RetroOverlay`,
styled in `globals.css`), `pointer-events: none` and `aria-hidden` — the
memorial and the leaderboard get it too.

- Scanlines on a three-pixel rhythm: one row at 34% black, two clear.
- A warm phosphor bloom over the middle.
- A vignette darkening into the corners.

This reverses the original decision, which confined the effect to a post-pass
at the end of `Room.paint`. Two things were wrong with that. Scanlines at 8%
over a 200px canvas were almost invisible, and — the real fault — the canvas
is a small part of a tall page, so a caretaker who pressed the button saw
nothing change anywhere they were looking and could not tell what the control
did. A toggle whose effect is imperceptible has failed at the only job it
has. Covering the app also makes the keepsake feel like a *mode* rather than
a filter on one widget, which is what "retro display" promises.

Moving it out of the render engine deleted more than it added: no
`scene/retro.ts`, no `Room.retro` flag, no invalidation when it flips, and
~150 `fillRect`s off every painted frame. It also retires a trap worth
recording — inside the canvas the vignette could not use a `CanvasGradient`,
because `DigestContext` stringifies any non-string `fillStyle` to the literal
`"object-fill"` (`digest.ts`), so two different gradients hash identically
and one whose appearance changed would never repaint. In CSS that constraint
does not exist, and gradients are the right tool.

Deliberately **no `backdrop-filter`** on the overlay. It would re-blur the
whole page on every paint, and with nineteen frosted panels beneath it that
is the single most expensive thing this app can do — the same reasoning that
already holds the aurora field still (`globals.css`).

### 26.6 Reduced Motion

`prefers-reduced-motion` suppresses the wash, the confetti, the starfield,
the meteors and the cheer loop. The toast and the feed line carry it alone —
the same rule §21.5 already applies to rare events, and the room's
`reducedMotion` setter is already the single place that decides it.

Retro mode is **not** suppressed. Scanlines, bloom and vignette are entirely
static; there is no motion in them to reduce, and taking someone's unlocked
keepsake away for a preference about animation would be a misreading of what
the preference asks for.

### 26.7 What It Deliberately Does Not Do

The code is going to leak — that is what easter eggs do — so it is built so
that leaking costs nothing:

- **No sim effect.** No meter moves, no coin is minted, no item is granted,
  no title changes hands. §21.5 settled this principle for rare events:
  material-free, the moment is the reward. A secret that paid out would be
  a faucet gated behind a string that everyone knows by the second week.
- **Nothing is written to Mongo.** No collection, no migration, no index.
- **Nothing is appended to the event log.** It does not replay, it leaves no
  memorial trace, and it never appears in `/api/feed` history. Someone who
  loads the page a minute later sees no evidence it happened, which is
  precisely what makes having witnessed it worth something.
- **No attribution.** See §26.2.
- **No hint, anywhere.** Nothing in the UI, on `/about`, or in the README
  says the code exists, and nothing that renders spells the sequence out —
  not the feed line, not the canvas toast. The rule has teeth: it is what
  decides the toast copy in §26.4, and the draft that printed `↑↑↓↓←→←→BA`
  over the pet broke it without meaning to.

  It spreads the way easter eggs are supposed to. Someone tries it on a whim,
  everyone watching sees the sky open and asks what that was, and the hunt
  starts in the feed. The standing tell is emergent rather than authored: a
  caretaker who has found it carries a 📺 in their header that nobody else
  has, so screenshots leak it sideways.

  Reading it in the source is a fair prize — the code is MIT and this
  document is in the repository. Documenting a secret and advertising it are
  different acts.

### 26.8 Testing

| Level | Covers |
| --- | --- |
| Unit — `konami.test.ts` | the full sequence; a wrong key mid-way; the overlapping-prefix case (`↑↑↑↓↓…`); `B`/`b` case-insensitivity; repeats and typing-target events ignored |
| Unit — mood derivation | dead → `stars`; egg → `party`; asleep → `stars`; awake → `party` |
| Unit — `Spectacle` | inert before `start` and after expiry; identical draw calls for identical `nowMs` across two runs (the digest depends on it); `supersedesNightDim` only while a `stars` run is live |
| Unit — `Room` | the spectacle repaints while it runs and lets the room settle after; reduced motion draws none of it; retro survives reduced motion |
| E2E — `e2e/konami.spec.ts` | type the sequence on `/`; **a second browser context sees the same feed line**, unattributed — the communal half is the part worth a browser; **a second entry moments later reaches both screens again**, which is the assertion the removed throttle would fail; the 📺 toggle appears for the finder and not the witness, survives a reload, and survives being switched off; the code is inert while a dialog owns the keyboard, and listening again the moment it closes |

The back-to-back case earns its place by history rather than by symmetry. A
throttle that only swallowed the *second* spectacle in a window passed every
test in this table for as long as each test cleared the guard first, and the
clearing was written off as test hygiene rather than read as the warning it
was. Nothing here is allowed to reset room-wide state between entries any
more; if a run can only pass by being handed a fresh room, that is the
finding, not the setup.

One constraint the e2e has to respect. The inertness test drives the **shop** dialog, not a minigame, even though it
is the minigames that bind the arrow keys. `social.spec.ts` owns every test
that starts a run — the pet is shared and `PLAY` carries a global cooldown, so
a second spec file racing for one would be refused and flake. Nothing is lost:
the gate is a single `!playing && !shopOpen`, and it does not know which
dialog set it.

### 26.9 Delivery Phases

Same rules as §20 and §21.10: each phase ends green on typecheck, lint and
tests, one commit per seam, nothing broken ever committed. No phase touches
more than five files.

| # | Phase | Files | Done when |
| --- | --- | --- | --- |
| **K1** | Protocol + route | `sim/secret.ts`, `messages.ts`, `api/konami/route.ts` | the route publishes a `secret` message on every call; mood derivation unit-tested |
| **K2** | Detection + feed | `hooks/konami.ts`, `hooks/useKonami.ts`, `usePetStream.ts`, `GameView` | the sequence posts, the feed line lands on every open tab, matcher unit-tested; inert during a minigame |
| **K3** | The spectacle | `scene/party.ts`, `room.ts`, `PetCanvas`, `audio.ts` | both moods draw; reduced motion falls back to the feed line; the digest still skips idle frames |
| **K4** | Retro mode | `RetroOverlay`, `layout.tsx`, `globals.css`, `useRetro.ts`, `GameView` | 📺 appears only once found, persists across reload, and switches the whole app in and out of the television |
| **K5** | E2E | `e2e/konami.spec.ts` | two contexts witness one spectacle, and witness the next one too; the keepsake reaches exactly one of them; the code is inert behind a dialog |


---

## 27. Appendix: What the Original Got Wrong

Recorded so the rebuild is measured against real defects rather than vague
dissatisfaction. Source: `~/Projects/makotogotchi_old` at `master`.

### 27.1 Architectural

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

### 27.2 Simulation Bugs

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

### 27.3 Structural

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
