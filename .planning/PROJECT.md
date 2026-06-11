# Dragons of Mugloar Autoplay Bot

## What This Is

A TypeScript command-line bot that automatically plays the game *Dragons of Mugloar*
(https://dragonsofmugloar.com) through its public HTTP API. It starts a game, evaluates the
available quests ("ads") each turn, picks which to solve using a readable heuristic, manages its
lives and gold (buying from the shop when sensible), and plays until game-over — logging every
decision in human-readable form and reporting the final score. Built test-first (TDD), with a
deliberately simple architecture. It is a solution to the well-known Dragons of Mugloar coding
test task.

## Core Value

The bot autonomously plays a full game of Dragons of Mugloar to completion and reports its final
score — driven by a simple, correct, well-tested decision loop. If everything else is stripped
away, this loop must work.

## Requirements

### Validated

- **Foundation / API layer (Phase 1, 2026-06-09):** the injectable `ApiClient` seam + shared
  types, cross-field `decodeAd` (Base64/ROT13), the hand-written offline `FakeApiClient`, and the
  live `HttpApiClient` (zod boundary, bounded retry, `encodeURIComponent`, HTML-error tolerance)
  all exist and are TDD-covered with zero live-network tests (API-01..API-06). The end-to-end
  capability requirements below validate once the strategy + runner phases wire this layer through.
- **Strategy core / pure decision logic (Phase 2, 2026-06-09):** the entire "what should the bot
  do" layer lives in `strategy.ts` as pure, types-only functions, fully TDD-driven (STRAT-01..06,
  TEST-01; 116 offline tests): probability-string ranking (exact-string table, unknown→worst,
  never throws), ad eligibility filtering + expected-value ad selection (`chooseAd` with
  expiry-aware tiebreak and a least-bad-gamble fallback, lock-step non-finite-reward guards), the
  shop heal/upgrade decision (live costs, healing-buffer reserve, non-finite-cost guards), and the
  `applySolveResult`/`applyBuyResult` state-merge helpers. The `ApiClient.buy()` seam returns a raw
  `BuyResult` symmetric with `solve()`, so `applyBuyResult` is reachable end-to-end and the final
  score is protected. These functions are proven in isolation; the end-to-end capability
  requirements below validate once Phase 3 wires them into the runner loop.
- **Game loop & shop integration (Phase 3, 2026-06-10):** the imperative-shell runner `runner.ts`
  now wires the proven strategy to the proven `ApiClient` seam — `playGame(api, logger)` runs a
  full autonomous game offline against `FakeApiClient` (129 offline tests, zero live network,
  LOOP-01/02/03). Per turn it drains the shop first, re-fetches ads so `expiresIn` stays current,
  solves the chosen ad, and threads all state through `applySolveResult`/`applyBuyResult` (the final
  score is never zeroed by a buy). Dual termination guards make non-termination impossible — a
  climbing turn trips the `MAX_TURN` cap, a flat turn (or a permanently-empty board) trips the
  no-progress guard. A mid-game `ApiClient` error propagates verbatim as a typed rejection (no
  try/catch, no `API_ERROR` reason — the user-facing CLI catch is deferred to Phase 4). This also
  validates cross-turn state tracking and the TDD-coverage capability.
- **Logger, CLI & live smoke (Phase 4, 2026-06-11) — milestone v1.0 complete:** the concrete
  `ConsoleLogger` (pino + pino-pretty, the sole pino importer behind the `Logger` interface) and the
  `src/index.ts` composition root — the ONLY site that constructs the real `HttpApiClient` +
  `ConsoleLogger` and injects them into `playGame` — close the end-to-end loop (LOG-01, LOG-02; 146
  offline tests, still zero live network). Each turn narrates at a leveled taxonomy (INFO per
  decision/outcome, WARN per skip/failed-buy, DEBUG play-by-play, ERROR on crash) with untrusted API
  strings carried as structured fields, never interpolated. On game end the CLI prints a bordered
  FINAL SCORE block to stdout (visible at any level) and exits 0 / 1 / 2 via `process.exitCode`
  (game-over / guard / error). The **one and only live smoke** was run and accepted: `npm start`
  played a full real game to completion (exit 0, score 3768, 70 turns) and `LOG_LEVEL=debug npm
  start` showed the full play-by-play (exit 0, score 5838, 93 turns), banners intact at both levels.
  This validates every remaining end-to-end capability requirement below.

### Active

*(none — all capability requirements validated as of Phase 4 / milestone v1.0)*

The following were validated end-to-end in Phase 4 (live smoke, 2026-06-11):

- [x] Running the CLI starts a new game and autoplays it to game-over with no human interaction
- [x] Each turn, the bot fetches the available ads/quests and current game state from the API
- [x] A readable heuristic chooses which ad to solve (prefer high reward among high-probability ads)
- [x] The bot uses the shop to stay alive / improve (buy healing or upgrades when affordable and sensible)
- [x] The bot handles API/transport errors gracefully (sane retry or clean termination, no crash)
- [x] Every decision and outcome is logged in human-readable, leveled console output
- [x] The final score is reported clearly when the game ends

### Out of Scope

- Web UI / frontend — CLI only; this is a backend exercise
- Persistent storage / database — game state lives in memory for one run, by design
- Multi-game benchmarking and stats aggregation — one game per run for v1 (possible future toggle)
- ML / search-based strategy optimizer — a readable heuristic is the intended ceiling ("keep it simple")
- Decoding advanced/encrypted ads beyond trivial cases — skip or ignore rather than over-engineer
- Hitting the live API from the test suite — tests use a mocked client only

## Current State

**Shipped:** v1.0 "Autoplay Bot" — 2026-06-11 (milestone complete, audit passed 18/18).

The bot is feature-complete for v1: `npm start` plays one full real game of Dragons of Mugloar to
game-over, narrates every decision, prints a FINAL SCORE banner, and exits with a status code
reflecting the outcome. Accepted live runs scored 3768 (70 turns) and 5838 (93 turns), both exit 0.

- **Codebase:** 8 TypeScript modules + 7 test files in a flat `src/` (~3.8k LOC incl. tests); no
  build step (tsx), ESM, manual DI.
- **Tech stack:** Node 24 LTS, TypeScript 5.9, tsx, Vitest (151 tests), pino + pino-pretty, zod (API
  boundary only), Biome.
- **Quality gates:** `npm test` (151 passing, zero live network), `tsc --noEmit`, and `biome check`
  all green.
- **Known tech debt (v2 candidates, non-blocking):** advisory comment/rationale inaccuracies around
  the non-finite guards, a theoretical EV-overflow edge not reachable via the live API, and minor
  smells (redundant Base64 length check, no retry jitter). Full list in
  `.planning/milestones/v1.0-MILESTONE-AUDIT.md`.

## Next Milestone Goals

Not yet scoped. Candidate directions carried in v2 requirements (see archived
`milestones/v1.0-REQUIREMENTS.md`): adaptive within-game probability memory (STRAT-07),
reputation-aware ad weighting (STRAT-08), and multi-game runs with score-statistics aggregation
(RUN-01). Start the next cycle with `/gsd-new-milestone`.

## Context

- *Dragons of Mugloar* exposes a REST API (base `https://www.dragonsofmugloar.com/api/v2`). The
  typical play loop is: **start game** → **get messages** (ads, each with a reward, an `expiresIn`
  countdown, a textual success `probability`, and sometimes an `encrypted` flag) → **solve** an ad
  → optionally visit the **shop** (buy healing potions and upgrades with gold) → repeat.
- Success probability arrives as descriptive text ("Sure thing", "Piece of cake", "Walk in the
  park", "Quite likely", "Hmmm....", "Gamble", "Risky", "Rather detrimental", "Suicide mission",
  etc.) that must be mapped to a usable likelihood ranking.
- Score (reputation) grows as ads are solved; lives decrease on failed/risky attempts; the game
  ends when lives reach zero. There is no hard "win" — the goal is to maximize final score before
  game-over.
- This is a common job-application / interview take-home task; the brief here asks specifically for
  a simple, TDD, well-logged TypeScript backend CLI.

## Constraints

- **Tech stack**: TypeScript on Node.js — explicitly required by the brief
- **Methodology**: Test-Driven Development — write tests first, then implementation
- **Architecture**: Keep it simple — minimal layers, no over-engineering
- **Interface**: Command-line, fully autoplaying — no human input during a game
- **Logging**: Human-readable, leveled console output (clear turn-by-turn narration)
- **Testing**: Unit tests against a mocked HTTP API client — fast, deterministic, no network
- **External dependency**: Relies on the live Dragons of Mugloar API being reachable at runtime

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript + Node CLI | Required by brief; natural fit for an API-driven bot | ✅ Good — shipped v1.0 on Node 24 / TS 5.9 / tsx / Vitest / Biome; the live smoke ran a full real game end-to-end |
| Functional core / imperative shell — 8 flat `src/` modules, manual DI, no HTTP-mock library | "Keep it simple"; the injectable `ApiClient` seam is the one decision that makes everything testable offline | ✅ Good — `types.ts → strategy.ts → runner.ts → index.ts` chain verified acyclic; `api.ts` the sole `fetch` caller; 151 offline tests, zero live network |
| Readable heuristic strategy (best reward among high-probability ads) | "Keep it simple" — good-enough play without optimizer complexity | ✅ Good — Phase 2 `chooseAd` ranks by expected value (`reward × rank`) with an expiry-aware tiebreak and a least-bad-gamble fallback; all pure and TDD-covered |
| Play a single game to game-over per CLI run | Simplest useful, demonstrable behavior | ✅ Good — Phase 3/4 `playGame` runs one full game to game-over; dual termination guards make non-termination impossible; live smoke confirmed end-to-end |
| Mock the API in unit tests | Fast, deterministic TDD without network flakiness | ✅ Good — `FakeApiClient` (+ `vi.spyOn(fetch)` in `api.test.ts`) drives all 151 offline tests with zero live network |
| Human-readable, leveled logging | Makes the bot's decisions easy to follow and review | ✅ Good — Phase 4 `ConsoleLogger` (pino + pino-pretty) narrates INFO/WARN/DEBUG per turn; always-visible FINAL SCORE banner; 3-way exit code (0/1/2) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-11 after v1.0 "Autoplay Bot" milestone completion (audit passed, archived, tagged)*
