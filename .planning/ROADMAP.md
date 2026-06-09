# Roadmap: Dragons of Mugloar Autoplay Bot

## Overview

The bot is built inside-out, test-first. Phase 1 establishes the shared types and the injectable `ApiClient` seam — the single decision that makes every later phase testable offline against a hand-written `FakeApiClient`, with no network in the suite. Phase 2 drives the pure decision core (`strategy.ts`) entirely from tests, since its inputs are plain objects: this is where the bulk of the value, the bug-prone logic, and the TDD coverage live. Phase 3 wires the proven seam and proven strategy into a thin orchestration loop with shop integration and infinite-loop guards. Phase 4 adds the leveled human-readable logging, the CLI composition root, the final-score report, and the one and only live smoke run. The architecture stays deliberately small: six flat source files, manual dependency injection, no HTTP-mocking library, no database, no web server.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation — Types, API Client & Test Seam** - Shared types plus the injectable HttpApiClient (retry, decode, coercion) and the FakeApiClient double; suite passes offline
- [ ] **Phase 2: Strategy Core — Pure Decision Logic (TDD)** - Test-first pure functions for probability ranking, ad selection, state merge, and shop decisions
- [ ] **Phase 3: Game Loop & Shop Integration** - A thin runner that autoplays one full game to game-over with shop buys and infinite-loop guards
- [ ] **Phase 4: Logger, CLI & Live Smoke** - Leveled human-readable logging, the CLI composition root, a clear final-score summary, and a live smoke run

## Phase Details

### Phase 1: Foundation — Types, API Client & Test Seam

**Goal**: The injectable `ApiClient` seam and all shared types exist, so every later phase can be developed and tested offline against a `FakeApiClient`; the real `HttpApiClient` talks to the live API correctly and never crashes on its quirks.
**Depends on**: Nothing (first phase)
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06
**Success Criteria** (what must be TRUE):

  1. The `ApiClient` interface is defined in `types.ts` and a hand-written `FakeApiClient` implements it, so the rest of the codebase depends on the interface, not on `fetch`
  2. `HttpApiClient` can start a game, fetch messages, solve an ad, read the shop, and buy an item against the live API, returning typed models for each
  3. An encrypted ad (`encrypted:1` Base64 or `encrypted:2` ROT13) is decoded across `adId`, `message`, and `probability` before it reaches any caller, and a `/`-containing `adId` is URL-encoded so `/solve` does not 400
  4. A transient failure is retried with bounded backoff and a non-JSON (HTML) error body is handled without throwing an unhandled crash; a string `reward` is coerced to a number at the client boundary
  5. The test suite runs and passes with zero live network calls

**Plans**: 4 plans (3 waves)
Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Bootstrap ESM/TS project + shared types & ApiClient/Logger interfaces (the seam)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — decodeAd (TDD): cross-field Base64/ROT13 decode, all-three-fields-or-none
- [ ] 01-03-PLAN.md — FakeApiClient: scripted offline test double implementing ApiClient

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-04-PLAN.md — HttpApiClient (TDD): zod boundary, retry-at-edge, encodeURIComponent, decode integration

### Phase 2: Strategy Core — Pure Decision Logic (TDD)

**Goal**: All "what should the bot do" logic exists as pure, fully test-driven functions in `strategy.ts`, so decisions are deterministic, readable, and proven before any loop integrates them.
**Depends on**: Phase 1
**Requirements**: STRAT-01, STRAT-02, STRAT-03, STRAT-04, STRAT-05, STRAT-06, TEST-01
**Success Criteria** (what must be TRUE):

  1. Every one of the 11 probability strings (including the exact `"Hmmm...."` four-dot label) maps to its rank, and an unknown string ranks worst and never throws
  2. Given a mixed board, the chosen ad is the best by expected value (`reward × rank`) after filtering expired, sub-floor, and unhandled-encryption ads, with an expiry-aware tiebreak; an empty or all-risky board yields the defined fallback rather than a crash
  3. Applying a solve result and applying a buy result each merge into game state correctly — solve omits `level`, buy omits `score` — without clobbering the missing field
  4. The bot decides to buy `hpot` when lives are low and gold allows, and only buys a level-raising upgrade from surplus gold after reserving a healing buffer
  5. The strategy test suite covers all of the above and runs fast and deterministically with no mocks and no network (inputs are plain objects)

**Plans**: TBD

Plans:

- [ ] TBD

### Phase 3: Game Loop & Shop Integration

**Goal**: A thin `runner.ts` orchestrates a complete autonomous game — fetch, decide, act, update, log — wiring the proven strategy to the proven `ApiClient` seam, and can never run forever.
**Depends on**: Phase 2
**Requirements**: LOOP-01, LOOP-02, LOOP-03
**Success Criteria** (what must be TRUE):

  1. Driven by the `FakeApiClient`, a full game runs to lives-zero game-over and returns a correct `GameReport` (final score, turns, end reason)
  2. The loop terminates via the max-turn safety cap and via the no-progress guard in their respective scenarios, proving it can never spin forever
  3. Ads are re-fetched after each turn-consuming action so `expiresIn` stays current, and the defined fallback is applied when no eligible ad exists
  4. An `ApiClient` error mid-game ends the run cleanly (game-over with a reason) rather than crashing, and the whole loop is verified offline against the fake with no live network

**Plans**: TBD

### Phase 4: Logger, CLI & Live Smoke

**Goal**: Running the CLI plays one full game end-to-end, narrates every decision in leveled human-readable output, prints a clear final-score summary, and exits with a status code reflecting the outcome.
**Depends on**: Phase 3
**Requirements**: LOG-01, LOG-02
**Success Criteria** (what must be TRUE):

  1. Each turn's decision and outcome is logged in leveled, human-readable form (INFO per decision, WARN for skips, ERROR for failures)
  2. On game end the CLI prints a distinct final-score block (score, turns, end reason) and exits with a status code that reflects the run outcome
  3. `index.ts` is the only place real `HttpApiClient` and `ConsoleLogger` are constructed and injected into `playGame`
  4. A manual live smoke run against the real API completes a full game and prints the summary, while the automated test suite still makes zero live network calls

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation — Types, API Client & Test Seam | 1/4 | In Progress|  |
| 2. Strategy Core — Pure Decision Logic (TDD) | 0/TBD | Not started | - |
| 3. Game Loop & Shop Integration | 0/TBD | Not started | - |
| 4. Logger, CLI & Live Smoke | 0/TBD | Not started | - |
