---
phase: 02-strategy-core-pure-decision-logic-tdd
plan: 04
subsystem: strategy
tags: [typescript, vitest, tdd, pure-functions, state-merge, functional-core, asymmetry]

# Dependency graph
requires:
  - phase: 02-strategy-core-pure-decision-logic-tdd
    plan: 03
    provides: "rankProbability, filterEligibleAds, PROBABILITY_FLOOR_RANK, chooseAd, chooseShopPurchase, MAX_LIVES_TO_KEEP, HEAL_BUFFER_GOLD — all reused unchanged; the two merge helpers are added alongside them in the same pure module"
provides:
  - "applySolveResult(state, SolveResult): GameState — folds a solve result into the prior state, carrying `level` forward (SolveResult omits it) (STRAT-06 / D-12)"
  - "applyBuyResult(state, BuyResult): GameState — folds a buy result into the prior state, carrying `score`/`highScore` forward (BuyResult omits both) (STRAT-06 / D-12)"
  - "Both helpers are PURE: spread the prior state into a NEW GameState and never mutate the input"
  - "applyBuyResult restores the score/highScore that api.ts buy() zeroes as placeholders by consuming the RAW BuyResult (the STRAT-06 subtlety)"
  - "strategy.ts is now the COMPLETE pure functional-core decision module (STRAT-01..06), still importing only ./types.js"
affects: [03-runner]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Asymmetry-preserving spread-merge: spread the prior `state` FIRST, then override ONLY the fields the response carries — so the field each response omits (`level` for solve; `score`/`highScore` for buy) survives from the prior state"
    - "applyBuyResult consumes the RAW BuyResult (not the api.ts partial GameState), so the api.ts `score:0` placeholder can never reach the threaded score"
    - "Purity via spread to a NEW object (mirrors decode.ts `{ ...input, ...changes }`); proved by snapshot toEqual + not.toBe non-mutation tests"
    - "RED→GREEN per-feature TDD commit sequence within one plan"

key-files:
  created: []
  modified:
    - src/strategy.ts
    - src/strategy.test.ts

key-decisions:
  - "Named the two helpers `applySolveResult` / `applyBuyResult` (the CONTEXT-recommended names; names were at planner/executor discretion per CONTEXT 'Claude's Discretion')"
  - "applyBuyResult consumes the RAW `BuyResult` rather than post-processing api.ts's partial GameState — the cleanest pure-function choice (CONTEXT recommendation) so the `score:0`/`highScore:0` placeholder is structurally irrelevant: score/highScore always come from the prior state"
  - "Spread the prior `state` FIRST then override result fields — the single idiom that carries the omitted field forward for both helpers (D-12); `gameId` rides along on the spread for free"

patterns-established:
  - "State is MERGED, not replaced, across turns — the solve/buy field asymmetry documented in types.ts is honored at exactly two call points, so the threaded GameState never loses `level` (on solve) or `score`/`highScore` (on buy)"
  - "The pure decision core is feature-complete: every STRAT-01..06 responsibility lives in strategy.ts as a deterministic, never-throwing, non-mutating function over plain objects, with zero runtime imports"

requirements-completed: [STRAT-06, TEST-01]

# Metrics
duration: 3min
completed: 2026-06-09
---

# Phase 2 Plan 04: State-Merge Helpers Summary

**Completed the pure strategy core test-first with the two asymmetry-preserving state-merge helpers: `applySolveResult` folds a `SolveResult` into the prior `GameState` carrying `level` forward (a solve result omits it), and `applyBuyResult` folds a `BuyResult` carrying `score`/`highScore` forward (a buy result omits both) — restoring the `score:0` placeholder that `api.ts buy()` writes; both spread the prior state into a NEW object and never mutate it.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-09T13:36:54Z
- **Completed:** 2026-06-09T13:39:20Z
- **Tasks:** 2 of 2
- **Files modified:** 2 (both extended, none created)

## Accomplishments

- `applySolveResult(state, result): GameState` (STRAT-06 / D-12): spreads the prior state, overrides `lives/gold/score/highScore/turn` from the `SolveResult`, and carries `level` + `gameId` forward — proven by a test using a distinctive prior `level: 4` against a result whose every other field differs.
- `applyBuyResult(state, result): GameState` (STRAT-06 / D-12): spreads the prior state, overrides `lives/gold/level/turn` from the `BuyResult`, and carries `score`/`highScore` + `gameId` forward.
- **The load-bearing STRAT-06 subtlety is proven:** a `BuyResult` merged into a prior state with `score: 700, highScore: 900` yields `700/900`, NOT the `0/0` that `api.ts buy()` writes for its standalone shape — because `applyBuyResult` consumes the RAW `BuyResult`, the placeholder can never corrupt the threaded final score.
- **Purity proved for both** (D-12 / T-02-08): `not.toBe` confirms each helper returns a NEW object, and a snapshot `toEqual` confirms the prior `state` object is byte-for-byte unchanged after the call.
- **strategy.ts is now feature-complete** for STRAT-01..06 and still imports only `./types.js` via `import type` (grep for `fetch`/`zod`/`pino`/`api.js`/`fake-api-client` returns 0).
- RED → GREEN TDD discipline visible in git history (2 commits); full suite 105/105 with zero regressions.

## Task Commits

Each TDD gate was committed atomically (test → feat):

1. **Task 1: RED — failing tests for solve/buy state merge helpers** — `fca6c9e` (test)
2. **Task 2: GREEN — implement solve/buy state merge helpers (asymmetry-preserving)** — `cf9a609` (feat)

_No REFACTOR commit needed — the implementation (two exported functions, each a single spread-merge return) was minimal and clean as written._

## Files Created/Modified

- `src/strategy.ts` (modified, +56 lines net) — Widened the type-only import to `Ad, BuyResult, GameState, ShopItem, SolveResult`; extended the file header to cite the Plan 02-04 responsibility (D-12); added the exported `applySolveResult` and `applyBuyResult`, each spreading the prior `state` first then overriding only the result-provided fields (so `level` / `score`+`highScore` survive). Still imports only `./types.js`.
- `src/strategy.test.ts` (modified, +170 lines) — Added `baseSolve(overrides): SolveResult` and `baseBuy(overrides): BuyResult` plain-object fixture builders (with the asymmetric shapes — `baseSolve` has no `level` key, `baseBuy` has no `score`/`highScore`), imported `BuyResult`/`SolveResult` via `import type`, and added `describe("applySolveResult")` and `describe("applyBuyResult")` covering carry-forward of the omitted field, adoption of the result's fields, `gameId` carry-forward, the api.ts placeholder-restore subtlety, and non-mutation + new-object purity guards. Extended the suite header to list the merge responsibilities.

## Decisions Made

- **Helper names `applySolveResult` / `applyBuyResult`** — the CONTEXT-recommended names (names were at planner/executor discretion per CONTEXT "Claude's Discretion").
- **`applyBuyResult` consumes the RAW `BuyResult`** rather than post-processing `api.ts`'s partial GameState — the cleanest pure-function choice (CONTEXT recommendation). Because score/highScore are always taken from the prior `state`, the api.ts `score:0`/`highScore:0` placeholder is structurally incapable of reaching the threaded score; the test proves the restore explicitly.
- **Spread the prior `state` first, then override the result's fields** — the single idiom that carries the omitted field forward for both helpers (D-12). `gameId` rides along on the spread without an explicit key.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. RED failed for the right reason (`applySolveResult`/`applyBuyResult is not a function` — exports absent; exactly the 8 new merge tests failed while the 60 Plans 01-03 strategy tests stayed green), and GREEN passed the full strategy suite, the full project suite, typecheck, and Biome on the first implementation.

## Verification

- `npx vitest run src/strategy.test.ts` — 68 passed (16 rank + 14 filter + 14 chooseAd + 16 chooseShopPurchase + 8 merge).
- `npx vitest run` (full suite) — 105 passed across 4 files (no regressions; the strategy file grew from 60 to 68 tests).
- `npx tsc --noEmit` — clean.
- `npx biome check src/strategy.ts src/strategy.test.ts` — no issues.
- Spread-merge constraint: `grep -c '\.\.\.state' src/strategy.ts` returns 2 (one per merge helper) — both spread the prior state.
- Import-only constraint: `grep -v '^ *\*' src/strategy.ts | grep -cE "(fetch|from \"zod\"|from \"pino\"|api\.js|fake-api-client)"` returns 0 — the only import is `import type { Ad, BuyResult, GameState, ShopItem, SolveResult } from "./types.js"`.

## TDD Gate Compliance

Plan `type: tdd`. Gate sequence verified in git log:
- merge helpers: RED `fca6c9e` (test) → GREEN `cf9a609` (feat). RED failed because both exports were absent (`applySolveResult`/`applyBuyResult is not a function`), not a passing-during-RED skip — a genuine RED before implementation.

No gate was skipped; no test passed unexpectedly during the RED phase.

## Threat Surface

The plan's `<threat_model>` mitigations are both covered by passing tests:
- **T-02-07 (Tampering / data integrity):** the carry-forward tests prove the spread-merge preserves the prior `level` (solve) and `score`/`highScore` (buy) by overriding ONLY result-provided fields — and the placeholder-restore test proves the api.ts `score:0` can never corrupt the threaded score.
- **T-02-08 (Repudiation / state consistency):** the non-mutation snapshot tests and the `not.toBe` new-object tests prove each helper returns a fresh GameState and never mutates its input, so a stale reference can't be aliased into a later turn.

No new security-relevant surface introduced (pure functional core, no I/O, no schema/network change, no package installs — the supply-chain checkpoint T-{phase}-SC does not apply).

## Known Stubs

None. Both helpers are fully implemented pure functions wired against the real `GameState`/`SolveResult`/`BuyResult` types — no hardcoded empty values, no placeholder text, no TODO/FIXME, no unwired data source.

## Self-Check: PASSED

- `src/strategy.ts` exists and exports `applySolveResult` and `applyBuyResult`.
- `src/strategy.test.ts` exists with `describe("applySolveResult ...")` and `describe("applyBuyResult ...")`.
- `.planning/phases/02-strategy-core-pure-decision-logic-tdd/02-04-SUMMARY.md` exists.
- Both task commits present in git history (`fca6c9e` test, `cf9a609` feat).
