---
phase: 02-strategy-core-pure-decision-logic-tdd
plan: 01
subsystem: strategy
tags: [typescript, vitest, tdd, pure-functions, heuristic, functional-core]

# Dependency graph
requires:
  - phase: 01-foundation-types-api-client-test-seam
    provides: "Ad type (probability:string free-text, encrypted?:number); decodeAd clearing the encrypted flag to 0 on success so still-flagged ads mean undecodable"
provides:
  - "src/strategy.ts — the pure functional-core decision module (first two responsibilities)"
  - "rankProbability(probability): integer rank 0–10 via exact-string lookup; unknown -> 0; never throws (STRAT-01/D-01)"
  - "PROBABILITY_FLOOR_RANK = 6 constant — the floor contract later plans (EV selector, fallback) consume"
  - "filterEligibleAds(ads): pure filter dropping expired/sub-floor/still-encrypted ads, returns a new array (STRAT-02/D-02/D-03)"
affects: [02-02-ev-selector, 02-03-shop-decisions, 02-04-state-merge, 03-runner]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exact-string-keyed Record<string, number> lookup + `?? 0` for the unknown->worst total-function rule (mirrors decode.ts decoderFor default)"
    - "Pure never-mutate filter returning a new array via Array.filter"
    - "RED->GREEN per-feature TDD commit sequence (test commit before feat commit) within one plan"

key-files:
  created:
    - src/strategy.ts
    - src/strategy.test.ts
  modified: []

key-decisions:
  - "Named the eligibility filter `filterEligibleAds` and the rank fn `rankProbability` (names were at planner discretion per CONTEXT)"
  - "Rank table uses integer ranks 0–10 from FEATURES.md (NOT the MEDIUM-confidence percentages) — the EV weighting (D-01)"
  - "still-encrypted detection is `!ad.encrypted` (truthy non-zero = undecodable) — matches decode.ts clearing the flag to 0 (D-03/D-09)"

patterns-established:
  - "Strategy module imports ONLY ./types.js via `import type` — zero runtime imports, no fetch/zod/pino/ApiClient (functional core)"
  - "Table-driven `it.each` for the 11-label rank suite plus an explicit exact four-dot 'Hmmm....' case (PITFALLS #6)"

requirements-completed: [STRAT-01, STRAT-02, TEST-01]

# Metrics
duration: 3min
completed: 2026-06-09
---

# Phase 2 Plan 01: Strategy Core Foundation (rankProbability + eligibility filter) Summary

**Established `src/strategy.ts` as the pure functional-core decision module test-first: an exact-string probability rank table (unknown -> worst, never throws) and the one-place ad eligibility filter that drops expired, sub-floor, and still-encrypted ads without mutating its input.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-09T13:20:19Z
- **Completed:** 2026-06-09T13:23:37Z
- **Tasks:** 2 of 2
- **Files modified:** 2 created

## Accomplishments

- `rankProbability` maps all 11 verified labels to their integer ranks 10..0, with the exact four-dot `"Hmmm...."` -> 6; any unknown label -> 0 and the function never throws (proven by a 16-test suite incl. a `.not.toThrow()` guard).
- `filterEligibleAds` drops expired (`expiresIn <= 0`), sub-floor (`rank < 6`), and still-encrypted (`encrypted` truthy) ads in one place, returns a new array, and never mutates its input (proven by a 14-test suite incl. mixed-board, non-mutation, and new-array-reference cases).
- Defined the `PROBABILITY_FLOOR_RANK = 6` constant and the rank table — the contract every later plan in this phase (EV selector, fallback) builds on (interface-first ordering).
- RED -> GREEN TDD discipline visible in git history for BOTH features (4 commits).

## Task Commits

Each TDD gate was committed atomically (test -> feat per feature):

1. **Task 1: RED — failing tests for rankProbability** - `7a00481` (test)
2. **Task 2a: GREEN — implement rankProbability** - `44069ef` (feat)
3. **Task 2b: RED — failing tests for eligibility filter** - `fe11908` (test)
4. **Task 2c: GREEN — implement eligibility filter** - `82cf12d` (feat)

_No REFACTOR commit needed — both implementations were minimal and clean as written._

## Files Created/Modified

- `src/strategy.ts` (82 lines) - Pure decision-core module: JSDoc header asserting purity + citing STRAT-01..06/D-01..D-12, `PROBABILITY_FLOOR_RANK` constant, exact-string `RANK` table, `rankProbability`, and `filterEligibleAds`. Imports only `./types.js` via `import type`.
- `src/strategy.test.ts` (165 lines) - Plain-object fixture suite (no mocks/network): table-driven 11-label rank tests + exact `"Hmmm...."` + unknown/never-throw; eligibility-filter tests for keep/drop rules, mixed board, non-mutation, new-array, empty-board.

## Decisions Made

- **Filter named `filterEligibleAds`, rank fn `rankProbability`** — names were explicitly at planner discretion (CONTEXT "Claude's Discretion"); chose readable, intent-revealing names.
- **Integer ranks, not percentages** — used the HIGH-confidence integer ranks 0–10 from FEATURES.md lines 74–86 as the EV weighting (D-01); the MEDIUM-confidence percentages are documentation only.
- **`!ad.encrypted` as the still-encrypted test** — a decoded/plaintext ad has `encrypted` cleared to `0`/`undefined` (decode.ts), so a truthy non-zero flag uniquely means "client could not decode -> would 400 -> drop" (D-03/D-09).

## Deviations from Plan

None - plan executed exactly as written.

The plan implemented `rankProbability` and `filterEligibleAds` in a single file write; to preserve the honest RED->GREEN gate for the filter (the plan's fail-fast rule), the filter was temporarily withheld from the GREEN-1 commit (rank-only) and its import was temporarily dropped from the test, then both restored for the filter RED/GREEN steps. This is a commit-sequencing detail, not a behavioral or scope deviation — the final state is exactly the plan's specified output.

## Issues Encountered

During the transient rank-only GREEN-1 state, Biome emitted unused-symbol warnings for `PROBABILITY_FLOOR_RANK` and the `baseAd` fixture (both used only by the not-yet-added filter). These were expected artifacts of splitting commits for the TDD gate and cleared automatically once `filterEligibleAds` landed in the GREEN-2 commit. Final Biome check on both files reports no issues.

## Verification

- `npx vitest run src/strategy.test.ts` — 30 passed (16 rank + 14 filter).
- `npx vitest run` (full suite) — 67 passed across 4 files (no regressions).
- `npx tsc --noEmit` — clean.
- `npx biome check src/strategy.ts src/strategy.test.ts` — no issues.
- Import-only constraint: `grep` for `fetch`/`zod`/`pino`/`api.js`/`fake-api-client` in `src/strategy.ts` returns 0.

## TDD Gate Compliance

Plan `type: tdd`. Gate sequence verified in git log for both features:
- rankProbability: RED `7a00481` (test) -> GREEN `44069ef` (feat). RED failed for the right reason (module/export missing), not a passing-during-RED skip.
- filterEligibleAds: RED `fe11908` (test) -> GREEN `82cf12d` (feat). RED failed with `filterEligibleAds is not a function` (export absent), confirming a genuine RED before implementation.

No gate was skipped; no test passed unexpectedly during a RED phase.

## Self-Check: PASSED

All created files exist (src/strategy.ts, src/strategy.test.ts, 02-01-SUMMARY.md) and all four task commits (7a00481, 44069ef, fe11908, 82cf12d) are present in git history.
