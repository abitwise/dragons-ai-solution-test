# Architecture Research

**Domain:** TypeScript/Node CLI bot that autoplays an HTTP-API game (Dragons of Mugloar)
**Researched:** 2026-06-08
**Confidence:** HIGH (architecture & TDD seams) / MEDIUM (exact API field names — verified against PROJECT.md + ecosystem, not live API which was unreachable in this sandbox)

## Standard Architecture

The right shape for this project is a **functional core / imperative shell**: pure
decision logic in the middle, all I/O (network + console) pushed to the edges, wired
together by a thin loop. This is the smallest structure that makes the strategy
testable without a network and keeps the brief's "keep it simple" mandate honest.

There are exactly **five concerns** and they map to five small modules. Resist adding a
sixth.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                       IMPERATIVE SHELL (does I/O)                      │
│                                                                        │
│   ┌──────────────┐        ┌──────────────────────────────────────┐    │
│   │  index.ts    │        │            runner.ts                  │    │
│   │  (CLI entry) │──────▶ │  (game loop / orchestrator)           │    │
│   │  wires deps  │        │                                       │    │
│   └──────────────┘        │   each turn:                          │    │
│          │                │   fetch → decide → act → update → log │    │
│          │ injects        └───┬───────────────┬──────────────┬────┘    │
│          ▼                    │ calls         │ calls (pure) │ calls   │
│   ┌──────────────┐            ▼               │              ▼         │
│   │  logger.ts   │     ┌──────────────┐       │       ┌──────────────┐ │
│   │ (leveled)    │◀────│  ApiClient   │       │       │  logger.ts   │ │
│   └──────────────┘     │  (interface) │       │       └──────────────┘ │
│                        │  + HttpApi   │       │                        │
│                        │   impl       │       │                        │
│                        └──────┬───────┘       │                        │
│                               │ fetch()       │                        │
│  ─────────────────────────────│───────────────│──────────────────────  │
│                               ▼               ▼                        │
│                        ┌──────────────┐  ┌──────────────────────────┐  │
│                        │  Mugloar     │  │   FUNCTIONAL CORE        │  │
│                        │  HTTP API    │  │   strategy.ts (PURE)     │  │
│                        │  (external)  │  │   - rankAds(ads)         │  │
│                        └──────────────┘  │   - chooseAd(state,ads)  │  │
│                                          │   - decideShop(state,    │  │
│                        ┌──────────────┐  │       items)             │  │
│                        │  types.ts    │  │   - scoreProbability(t)  │  │
│                        │ (shared      │◀─┤   NO I/O. NO awaits.     │  │
│                        │  models)     │  └──────────────────────────┘  │
│                        └──────────────┘                                │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `types.ts` | Shared data models: `GameState`, `Ad`, `ShopItem`, `SolveResult`, the `ApiClient` interface, the `Logger` interface. No logic. | Plain `interface`/`type` declarations + a couple of literal-union types for probability text. |
| `api.ts` | The **testing seam**: declares `ApiClient` interface and provides `HttpApiClient` — the only module that calls `fetch`. Maps raw JSON to typed models. | `interface ApiClient` + a class/factory implementing it with `fetch` + small retry wrapper. |
| `strategy.ts` | The **functional core**: pure functions that decide *what to do* given state. No `await`, no `fetch`, no `console`, no `Date.now`/`Math.random` unless passed in. | Exported pure functions returning plain values (chosen `adId`, list of buys, ranked ads). |
| `runner.ts` | The orchestrator: owns the turn loop. Calls the API, passes results to strategy, executes the decision, updates in-memory state, logs each step. Stops when `lives === 0`. | One `async function playGame(api, logger): Promise<GameReport>`. |
| `logger.ts` | Leveled, human-readable console output (`debug`/`info`/`warn`/`error`). Declares a `Logger` interface so the runner depends on the interface, not `console`. | Tiny wrapper over `console` with a level threshold. No library needed. |
| `index.ts` | CLI entrypoint (`bin`). The **composition root**: constructs `HttpApiClient` + `ConsoleLogger`, calls `playGame`, prints the final report, sets exit code. The *only* place real dependencies are instantiated. | `#!/usr/bin/env node` shebang, parse minimal flags, `await playGame(...)`. |

## Recommended Project Structure

```
src/
├── types.ts          # GameState, Ad, ShopItem, ApiClient & Logger interfaces — no logic
├── api.ts            # ApiClient interface + HttpApiClient (the ONLY fetch caller) + retry
├── strategy.ts       # PURE decision functions — the heavily-tested core
├── runner.ts         # playGame(api, logger): the turn loop / orchestrator
├── logger.ts         # leveled console Logger (interface lives in types.ts)
└── index.ts          # CLI entry / composition root: wires real deps, prints report
tests/
├── strategy.test.ts  # the bulk of the tests — pure, fast, no mocks needed for inputs
├── runner.test.ts    # loop behavior with a FakeApiClient (in-memory)
└── api.test.ts       # JSON→model mapping + retry, optional (can stub fetch)
package.json
tsconfig.json
```

That is the whole thing. **Six source files. No folders under `src/`.** If a folder
like `services/` or `domain/` starts to feel necessary, that is the over-engineering
smell — stop and reconsider.

### Structure Rationale

- **Flat `src/`:** A project this size does not earn nested directories. Folders add
  navigation cost and imply layering that does not exist here. Files are the modules.
- **`types.ts` holds both data models and the two interfaces (`ApiClient`, `Logger`):**
  Co-locating the contracts means every module imports its dependencies' *shapes* from
  one place, and tests import the same `ApiClient` interface they fake. One source of
  truth for the seam.
- **`strategy.ts` separate from `runner.ts`:** This split *is* the architecture. The
  strategy is pure and trivially testable; the runner is glue. Keeping them apart is
  what makes TDD pleasant. Do not merge them "to save a file."
- **`index.ts` as the only composition root:** Real `fetch` and real `console` are
  constructed in exactly one place. Everything downstream receives interfaces. This is
  manual dependency injection — no container, no framework.

## Architectural Patterns

### Pattern 1: Functional Core, Imperative Shell

**What:** All decision logic lives in pure functions (`strategy.ts`). All side effects
(HTTP, console, clock) live in the shell (`api.ts`, `logger.ts`, `runner.ts`,
`index.ts`). The shell gathers data, hands plain values to the core, and acts on the
core's plain-value answer.

**When to use:** Any bot/agent loop where the "what should I do" logic is the valuable,
bug-prone part and the I/O is mechanical. This is exactly that.

**Trade-offs:** You pass state in and out explicitly instead of mutating shared objects
— slightly more verbose, dramatically more testable. For this project the verbosity is
negligible.

**Example:**
```typescript
// strategy.ts — PURE. Given the world, return a decision. No awaits, no fetch.
export function chooseAd(state: GameState, ads: Ad[]): Ad | undefined {
  return ads
    .filter(ad => !ad.encrypted)               // skip out-of-scope encrypted ads
    .map(ad => ({ ad, ev: scoreAd(state, ad) }))
    .sort((a, b) => b.ev - a.ev)[0]?.ad;
}

// scoreAd & scoreProbability are pure too — the unit-test surface area lives here.
export function scoreProbability(text: ProbabilityText): number { /* map → 0..1 */ }
```

### Pattern 2: Injectable Client Interface (the TDD seam)

**What:** Define `ApiClient` as an interface in `types.ts`. The runner and any consumer
depend on the *interface*. Production wires `HttpApiClient`; tests wire a hand-written
`FakeApiClient` that returns scripted responses from in-memory data. No network, no HTTP
mocking library, no `nock`/`msw`.

**When to use:** Whenever you must test loop/orchestration logic that would otherwise hit
the network. This is the single most important seam in the codebase.

**Trade-offs:** One extra interface declaration. That is the entire cost, and it buys
fully deterministic, millisecond-fast tests of the game loop.

**Example:**
```typescript
// types.ts
export interface ApiClient {
  startGame(): Promise<GameState>;
  getMessages(gameId: string): Promise<Ad[]>;
  solve(gameId: string, adId: string): Promise<SolveResult>;
  getShop(gameId: string): Promise<ShopItem[]>;
  buy(gameId: string, itemId: string): Promise<GameState>;
}

// tests/runner.test.ts — a fake, not a mock framework
class FakeApiClient implements ApiClient {
  constructor(private script: { ads: Ad[][]; results: SolveResult[] }) {}
  async startGame() { return { gameId: 'g1', lives: 3, gold: 0, score: 0, turn: 0 }; }
  async getMessages() { return this.script.ads.shift() ?? []; }
  async solve()       { return this.script.results.shift()!; }
  async getShop()     { return []; }
  async buy()         { return /* updated state */; }
}
// Then: assert that playGame(new FakeApiClient(...), silentLogger) loops correctly,
// stops at lives === 0, and reports the right final score.
```

### Pattern 3: Retry at the Edge (boundary for transient failures)

**What:** Transient HTTP failures (5xx, network blips, timeouts) are handled **inside
`HttpApiClient`**, not in the loop. Each method wraps `fetch` in a small bounded
retry-with-backoff. The runner only sees either a clean typed result or a thrown error
it cannot recover from.

**When to use:** Always, for a bot that depends on a live external API. Keeping retry at
the edge means the loop and strategy never learn about HTTP. PROJECT.md requires "sane
retry or clean termination, no crash" — this is where that lives.

**Trade-offs:** Retry policy is one concern in one place. The runner stays simple: it can
optionally wrap a *turn* in try/catch to decide "retry the turn vs. end the game
gracefully," but it never touches `fetch`.

**Example:**
```typescript
// api.ts — retry lives next to the only fetch call
async function getJson<T>(url: string, init?: RequestInit, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt < tries) { await delay(attempt * 250); continue; }
      if (!res.ok) throw new ApiError(res.status, await res.text());
      return (await res.json()) as T;
    } catch (err) {
      if (attempt >= tries) throw err;   // give up → runner ends game cleanly
      await delay(attempt * 250);
    }
  }
}
```

## Data Flow

### Per-Turn Flow (the core loop)

```
index.ts:  new HttpApiClient() + new ConsoleLogger()  ── injected ──▶ playGame(api, logger)

playGame:
  state = await api.startGame()            // gameId, lives, gold, score, turn
  log.info("Game started: %o", state)

  while (state.lives > 0):
    ads   = await api.getMessages(state.gameId)        // [{ adId, message, reward, expiresIn, probability, encrypted }]
    ad    = strategy.chooseAd(state, ads)        // PURE — returns chosen Ad (or none)
    if (!ad) break
    log.info("Turn %d: solving '%s' (reward %d, %s)", state.turn, ad.message, ad.reward, ad.probability)

    result = await api.solve(state.gameId, ad.adId)    // { success, lives, gold, score, turn }
    state  = applyResult(state, result)          // PURE state update
    log.info("→ %s | lives %d, gold %d, score %d", result.success ? "WON" : "LOST", state.lives, state.gold, state.score)

    if (strategy.shouldShop(state)):             // PURE
      items = await api.getShop(state.gameId)
      for itemId of strategy.decideBuys(state, items):   // PURE
        state = await api.buy(state.gameId, itemId)
        log.debug("Bought %s; gold now %d", itemId, state.gold)

  log.info("GAME OVER — final score %d after %d turns", state.score, state.turn)
  return { score: state.score, turns: state.turn, ... }   // GameReport
```

### Direction of Dependencies (who imports whom)

```
index.ts  ──▶ api.ts, logger.ts, runner.ts, types.ts      (composition root: imports everything)
runner.ts ──▶ strategy.ts, types.ts                        (depends on ApiClient & Logger INTERFACES, not impls)
strategy.ts ─▶ types.ts                                    (pure; imports only data shapes)
api.ts    ──▶ types.ts                                     (implements ApiClient)
logger.ts ──▶ types.ts                                     (implements Logger)
types.ts  ──▶ (nothing)                                    (leaf — no imports)
```

Dependencies point **inward and downward**. `strategy.ts` (the core) imports nothing but
types. Nothing imports `index.ts`. This acyclic shape is what keeps the project
understandable at a glance.

### Key Data Flows

1. **Decision flow (pure):** `runner` collects `GameState` + `Ad[]` → hands them to
   `strategy.chooseAd` → receives a plain `Ad` back. No I/O crosses into the core.
2. **State threading:** `GameState` is created by `startGame`, then *returned* (not
   mutated) by each `solve`/`buy` and re-derived by pure `applyResult`. State lives in a
   single `let state` in `playGame` — in memory, one run, by design (PROJECT.md).
3. **Error flow:** transient errors absorbed inside `api.ts` retries; unrecoverable
   errors throw → `runner` ends the game cleanly and reports → `index.ts` sets exit code.

## Scaling Considerations

This is a single-game, single-run CLI. "Scale" here means code growth, not users.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| v1 (single game per run) | The five-module flat structure as described. Nothing more. |
| Multi-game benchmarking (future, out of scope now) | Wrap `playGame` in a loop in `index.ts`, aggregate `GameReport`s. **No structural change** — strategy and runner are already reusable. |
| Smarter strategy (future, explicitly capped at "readable heuristic") | Add pure functions to `strategy.ts` only. The seam already isolates this; the loop never changes. |

### Scaling Priorities

1. **First thing that would tempt over-engineering:** richer strategy. Keep it as more
   pure functions in `strategy.ts`; do not introduce a "strategy plugin" abstraction.
2. **Second:** multiple games. That is an `index.ts` for-loop, not a new layer.

## Anti-Patterns

### Anti-Pattern 1: Layered enterprise scaffolding

**What people do:** Create `src/domain/`, `src/services/`, `src/infrastructure/`,
`src/application/`, repository interfaces, factories, and a DI container for a ~400-line
bot.
**Why it's wrong:** It buries five simple files under ceremony, slows comprehension, and
directly violates the brief's "keep it simple, don't overdo the architecture."
**Do this instead:** Flat `src/` with six files. Manual DI = passing `api` and `logger`
as function arguments in `index.ts`.

### Anti-Pattern 2: Mocking `fetch` / HTTP in tests instead of injecting a client

**What people do:** Reach for `nock`, `msw`, `jest.mock('node-fetch')`, or monkey-patch
global `fetch` to test the loop.
**Why it's wrong:** Couples tests to HTTP transport details, makes them slow and brittle,
and tests the wrong layer. The interesting logic is the *decision*, not the JSON over the
wire.
**Do this instead:** Test pure `strategy.ts` with plain inputs, and test `runner.ts` with
a hand-written `FakeApiClient` that implements the `ApiClient` interface. Reserve any
real-`fetch` testing for `api.ts` alone (and even there, stubbing the global `fetch` is
enough — no library).

### Anti-Pattern 3: Side effects in the strategy

**What people do:** Let strategy functions call the API, log, read the clock, or use
`Math.random` internally ("just this once, to break ties").
**Why it's wrong:** It destroys determinism and forces mocks back into the core, defeating
the whole point of the seam.
**Do this instead:** Keep `strategy.ts` pure. If a decision needs randomness or time, pass
it in as a parameter (`chooseAd(state, ads, rng?)`) so tests stay deterministic.

### Anti-Pattern 4: A god-object `Game` class holding api + state + strategy + logging

**What people do:** One `class Game` with `this.api`, `this.state`, `this.log`, and a
`play()` that does everything.
**Why it's wrong:** Re-couples the four concerns the architecture just separated; the
pure logic is no longer pure (it lives on `this`).
**Do this instead:** Keep `playGame(api, logger)` as a function that *uses* pure strategy
helpers and threads `state` explicitly. A class is not needed for a single run.

### Anti-Pattern 5: Event buses / queues / persistence

**What people do:** Add an event emitter "for decoupling," a job queue, or SQLite to
"save progress."
**Why it's wrong:** PROJECT.md puts persistence and aggregation explicitly out of scope;
game state is in-memory for one run by design.
**Do this instead:** A `let state` variable and a `while` loop. That is the entire state
management system.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Dragons of Mugloar HTTP API (`https://www.dragonsofmugloar.com/api/v2`) | `HttpApiClient` behind the `ApiClient` interface; native `fetch` (Node 18+); bounded retry on 5xx/network errors | Confirmed endpoint set (see below). The live API was unreachable from this sandbox, so STACK/PITFALLS research should re-verify exact field names against a live `GET`/`POST` before coding. |

**Endpoint set (per PROJECT.md + consistent ecosystem usage — MEDIUM confidence on exact paths/fields, verify live):**

| Action | Method & Path | Key response fields |
|--------|---------------|---------------------|
| Start game | `POST /game/start` | `gameId`, `lives`, `gold`, `level`, `score`, `highScore`, `turn` |
| Get ads | `GET /{gameId}/messages` | array of `{ adId, message, reward, expiresIn, probability (text), encrypted }` |
| Solve ad | `POST /{gameId}/solve/{adId}` | `success`, `lives`, `gold`, `score`, `highScore`, `turn`, `message` |
| List shop | `GET /{gameId}/shop` | array of `{ id, name, cost }` |
| Buy item | `POST /{gameId}/shop/buy/{itemId}` | `shoppingSuccess`, `gold`, `lives`, `level`, `turn` |
| Reputation (optional) | `POST /{gameId}/investigate/reputation` | `people`, `state`, `underworld` |

`probability` arrives as descriptive text ("Sure thing", "Piece of cake", "Walk in the
park", "Quite likely", "Hmmm....", "Gamble", "Risky", "Rather detrimental", "Suicide
mission", etc.) → map to a numeric rank in a pure `scoreProbability` function in
`strategy.ts`. This mapping table is a prime TDD target.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `runner.ts ↔ api.ts` | Through the `ApiClient` **interface** (async methods returning typed models) | This is the injected seam. Runner never imports `HttpApiClient` directly. |
| `runner.ts ↔ strategy.ts` | Direct function calls with **plain values** (no I/O, no Promises) | Pure boundary — the heart of testability. |
| `runner.ts ↔ logger.ts` | Through the `Logger` **interface** | Tests pass a silent/spy logger; no console noise in CI. |
| `index.ts ↔ everything` | Constructs real impls, injects them | Composition root; the only place `new HttpApiClient()` / `new ConsoleLogger()` appears. |

## Suggested Build Order (TDD-first)

Build inside-out so tests come before the things they validate, and each step compiles on
its own.

1. **`types.ts`** — define `GameState`, `Ad`, `ShopItem`, `SolveResult`, `GameReport`,
   the `probability` union, and the `ApiClient` + `Logger` interfaces. *No tests* (no
   behavior). Everything else depends on this leaf.
2. **`strategy.ts` (TDD core)** — write `strategy.test.ts` first: probability-text →
   score mapping, `chooseAd` ranking, `decideBuys`, `applyResult`. Then implement until
   green. This is where most tests live; it needs **no mocks** because inputs are plain
   objects.
3. **`FakeApiClient` + `runner.ts` (TDD loop)** — write `runner.test.ts` against a
   hand-written fake implementing `ApiClient`: assert the loop fetches→decides→acts,
   threads state, stops at `lives === 0`, and returns a correct `GameReport`. Then
   implement `playGame`.
4. **`api.ts` (`HttpApiClient` + retry)** — implement the real `fetch`-based client and
   the retry-at-the-edge helper. Optionally test JSON-mapping/retry by stubbing global
   `fetch` (no HTTP library). Lower test priority than core/loop.
5. **`logger.ts`** — leveled console wrapper implementing `Logger`. Trivial; light or no
   tests.
6. **`index.ts`** — composition root: parse minimal flags, construct real `api` + `logger`,
   `await playGame(...)`, print the `GameReport`, set exit code. Validate by running the
   CLI against the live API (manual/integration, not unit).

**Why this order:** steps 2–3 (the valuable, bug-prone logic) are fully test-driven with
zero network before any real HTTP exists. The injectable `ApiClient` interface defined in
step 1 is what makes steps 2–3 possible.

## "Keep It Simple" Guardrails (hard limits)

- **Six source files, flat `src/`.** If you reach for a subfolder, stop.
- **Manual DI only:** pass `api` and `logger` as arguments. No DI container, no decorators,
  no reflection.
- **No HTTP-mocking library.** Test the loop with a `FakeApiClient`; test the core with
  plain objects.
- **No classes required** except possibly `HttpApiClient`/`ConsoleLogger` (and even those
  can be factory functions returning an object literal that satisfies the interface).
- **No plugin system, event bus, queue, or database.** State is one `let` in one loop.
- **Strategy stays pure** — no `await`, `fetch`, `console`, `Date`, or `Math.random`
  inside `strategy.ts` (inject them if ever needed).
- **Test runner: prefer Vitest** for new TS projects (fast watch, native ESM/TS, best DX);
  **`node:test` + `tsx`** is the zero-extra-dependency alternative if you want to avoid
  any test framework. Either satisfies the TDD requirement — pick one and move on.

## Sources

- `.planning/PROJECT.md` — base URL `https://www.dragonsofmugloar.com/api/v2`, play loop,
  probability text values, in-scope/out-of-scope constraints (HIGH — project source of truth)
- Dragons of Mugloar official API doc: https://dragonsofmugloar.com/doc/ (SPA, content
  loads via JS; could not be scraped headlessly — endpoint set corroborated below)
- Ecosystem reference solutions confirming the v2 endpoint set and probability ranking:
  https://github.com/jcarlosvale/dragonsOfMugloar ,
  https://github.com/dynamics3/dragonsofmugloar ,
  https://github.com/CardoEggert/DragonsOfMugloarPlayer (MEDIUM — community implementations)
- Test-runner landscape (Vitest vs node:test for new TS projects, 2026):
  https://www.pkgpulse.com/guides/node-test-vs-vitest-vs-jest-native-test-runner-2026 ,
  https://vitest.dev/guide/comparisons (MEDIUM — current ecosystem guidance)
- Functional core / imperative shell is a well-established testability pattern; applied
  here to isolate pure strategy from I/O (HIGH — standard pattern)

---
*Architecture research for: TypeScript CLI autoplay bot over an HTTP game API*
*Researched: 2026-06-08*
