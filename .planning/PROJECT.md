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

### Active

- [ ] Running the CLI starts a new game and autoplays it to game-over with no human interaction
- [ ] Each turn, the bot fetches the available ads/quests and current game state from the API
- [ ] A readable heuristic chooses which ad to solve (prefer high reward among high-probability ads)
- [ ] The bot tracks game state across turns (lives, gold, score, level/turn)
- [ ] The bot uses the shop to stay alive / improve (buy healing or upgrades when affordable and sensible)
- [ ] The bot handles API/transport errors gracefully (sane retry or clean termination, no crash)
- [ ] Every decision and outcome is logged in human-readable, leveled console output
- [ ] The final score is reported clearly when the game ends
- [ ] Core decision logic is covered by TDD unit tests against a mocked API client

### Out of Scope

- Web UI / frontend — CLI only; this is a backend exercise
- Persistent storage / database — game state lives in memory for one run, by design
- Multi-game benchmarking and stats aggregation — one game per run for v1 (possible future toggle)
- ML / search-based strategy optimizer — a readable heuristic is the intended ceiling ("keep it simple")
- Decoding advanced/encrypted ads beyond trivial cases — skip or ignore rather than over-engineer
- Hitting the live API from the test suite — tests use a mocked client only

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
| TypeScript + Node CLI | Required by brief; natural fit for an API-driven bot | — Pending |
| Readable heuristic strategy (best reward among high-probability ads) | "Keep it simple" — good-enough play without optimizer complexity | — Pending |
| Play a single game to game-over per CLI run | Simplest useful, demonstrable behavior | — Pending |
| Mock the API in unit tests | Fast, deterministic TDD without network flakiness | — Pending |
| Human-readable, leveled logging | Makes the bot's decisions easy to follow and review | — Pending |

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
*Last updated: 2026-06-08 after initialization*
