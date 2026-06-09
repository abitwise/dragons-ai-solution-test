---
phase: 02-strategy-core-pure-decision-logic-tdd
plan: 02
subsystem: strategy
tags: [typescript, vitest, tdd, pure-functions, heuristic, expected-value, functional-core]

# Dependency graph
requires:
  - phase: 02-strategy-core-pure-decision-logic-tdd
    plan: 01
    provides: "rankProbability (exact-string rank 0–10, unknown→0), filterEligibleAds (floor+expiry+encrypted filter), PROBABILITY_FLOOR_RANK = 6 — all reused unchanged by chooseAd"
provides:
  - "chooseAd(ads): Ad | null — the ad selector (STRAT-03 / D-04..D-07)"
  - "Highest-EV selection (reward × rank) among floor-eligible ads, reusing Plan 01's rank + eligibility filter (D-04)"
  - "Deterministic tiebreak: sooner expiry first, then higher reward (D-05)"
  - "Least-bad-gamble fallback: relaxes ONLY the floor, still excludes expired + still-encrypted ads (D-06)"
  - "Explicit null no-ad signal for a truly empty/no-solvable board; never throws, never mutates input (D-07)"
affects: [02-03-shop-decisions, 02-04-state-merge, 03-runner]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single pure comparator (`preferAd`) + `Array.reduce` `bestOf` for deterministic selection (sort-or-reduce was at planner discretion; chose reduce)"
    - "EV expression extracted to a small un-exported `expectedValue` helper (mirrors decode.ts un-exported helpers)"
    - "Total-function explicit-null no-ad signal instead of an exception (mirrors decode.ts pass-through returns)"
    - "RED→GREEN per-feature TDD commit sequence within one plan"

key-files:
  created: []
  modified:
    - src/strategy.ts
    - src/strategy.test.ts

key-decisions:
  - "chooseAd returns `Ad | null` (not a discriminated union) — null is the no-ad signal the Phase 3 runner branches on (D-07; shape was at planner discretion)"
  - "Selection implemented as one comparator (`preferAd`) folded by `Array.reduce` (`bestOf`) — readable, not an optimizer (sort-vs-reduce was at planner discretion)"
  - "Fallback solvable set = `ads.filter(a => a.expiresIn > 0 && !a.encrypted)` — relaxes ONLY the floor; never relaxes onto an expired or still-encrypted ad that would 400 (D-06 / PITFALLS #2)"
  - "Reused Plan 01's filterEligibleAds + rankProbability verbatim — no rank-table or floor duplication (grep -c 'const RANK' = 1)"

patterns-established:
  - "EV = reward × rankProbability(probability) is the selection metric (D-04); the integer rank table from Plan 01 is the weighting"
  - "Deterministic ordering keeps fixture-based tests stable: EV desc → expiresIn asc → reward desc"

requirements-completed: [STRAT-03, TEST-01]

# Metrics
duration: 2min
completed: 2026-06-09
---

# Phase 2 Plan 02: chooseAd EV Selector Summary

**Added `chooseAd` to the pure strategy core test-first: it picks the highest expected-value (`reward × rank`) ad among the floor-eligible set (reusing Plan 01's rank table and filter), breaks ties by sooner expiry then higher reward, falls back to a least-bad gamble (relaxing only the floor, never onto an expired or still-encrypted ad) when nothing clears the floor, and returns an explicit `null` only when the board is truly empty — never throwing, never mutating its input.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-06-09T13:26:55Z
- **Completed:** 2026-06-09T13:29:06Z
- **Tasks:** 2 of 2
- **Files modified:** 2 (both extended, none created)

## Accomplishments

- `chooseAd(ads): Ad | null` selects the highest-EV eligible ad, proving a moderate-reward safe ad (EV 2000) beats a higher-raw-reward risky ad (EV 1800) — EV beats raw reward (PITFALLS #4 / D-04).
- Deterministic tiebreak via one pure `preferAd` comparator: EV desc → `expiresIn` asc → `reward` desc (D-05), proven by an EV-tie→sooner-expiry test and an EV-tie+expiry-tie→higher-reward test.
- Least-bad-gamble fallback (D-06): an all-sub-floor but solvable board returns the best EV among the gambles, while a still-encrypted ad (EV 45000) and an expired ad are excluded even in the fallback — neither can ever be POSTed to `/solve` (T-02-04 / PITFALLS #2).
- Explicit `null` no-ad signal (D-07): empty board, all-expired board, and all-still-encrypted board each return `null` without throwing (T-02-03 — prevents the PITFALLS #5 downstream loop hang).
- Reused Plan 01's `filterEligibleAds` and `rankProbability` verbatim — no rank-table or floor duplication (`grep -c "const RANK"` = 1).
- RED → GREEN TDD discipline visible in git history (2 commits).

## Task Commits

Each TDD gate was committed atomically (test → feat):

1. **Task 1: RED — failing tests for chooseAd selection/tiebreak/fallback/empty-board** - `4d51e46` (test)
2. **Task 2: GREEN — implement chooseAd EV selection + tiebreak + fallback + null signal** - `ca22a25` (feat)

_No REFACTOR commit needed — the implementation (a single comparator, a small `bestOf` reducer, an extracted `expectedValue` helper, and `chooseAd`) was minimal and clean as written._

## Files Created/Modified

- `src/strategy.ts` (modified, +70 lines) - Added `expectedValue` (EV = reward × rank), `preferAd` (the deterministic comparator), `bestOf` (reduce over candidates), and the exported `chooseAd` (eligible-best → fallback solvable-best → null). Updated the file header to cite the Plan 02-02 responsibility. Still imports only `./types.js` via `import type`.
- `src/strategy.test.ts` (modified, +164 lines) - Added `describe("chooseAd (STRAT-03)")` with nested families: EV selection (D-04), expiry-aware tiebreak (D-05), least-bad-gamble fallback (D-06), empty/no-solvable board (D-07), and a non-mutation purity guard. All plain-object fixtures reusing the existing `baseAd` builder; distinct `adId`s make winner assertions unambiguous; EVs computed by hand from FEATURES.md ranks.

## Decisions Made

- **`chooseAd` returns `Ad | null`** — the simplest total-function no-ad signal (not a discriminated union); the Phase 3 runner branches on `null` to shop or end (D-07; return shape was at planner discretion).
- **One comparator folded by `reduce`** — `preferAd` encodes EV-desc → expiry-asc → reward-desc; `bestOf` reduces the candidate list. Readable and stable, not an optimizer (sort-vs-reduce was at planner discretion).
- **Fallback relaxes ONLY the floor** — `ads.filter(a => a.expiresIn > 0 && !a.encrypted)`; an expired or still-encrypted ad is never selected even in the least-bad gamble (D-06 / PITFALLS #2).
- **Verbatim reuse of Plan 01** — `filterEligibleAds` for the primary candidate set and `rankProbability` for the EV weight; no redefinition of the rank table or floor.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. RED failed for the right reason (`chooseAd is not a function` — export absent, all 14 new tests; the 30 Plan-01 tests stayed green), and GREEN passed the full strategy suite, typecheck, and Biome on the first implementation.

## Verification

- `npx vitest run src/strategy.test.ts` — 44 passed (16 rank + 14 filter + 14 chooseAd).
- `npx vitest run` (full suite) — 81 passed across 4 files (no regressions).
- `npx tsc --noEmit` — clean.
- `npx biome check src/strategy.ts src/strategy.test.ts` — no issues.
- Reuse constraint: `grep -c "const RANK" src/strategy.ts` = 1 (no rank-table duplication).
- Import-only constraint: the only `import` in `src/strategy.ts` is `import type { Ad } from "./types.js"`; the two `fetch`/`zod`/`pino` grep hits are in the purity-asserting file-header JSDoc, not runtime imports.

## TDD Gate Compliance

Plan `type: tdd`. Gate sequence verified in git log:
- chooseAd: RED `4d51e46` (test) → GREEN `ca22a25` (feat). RED failed because the export was absent (`chooseAd is not a function`), not a passing-during-RED skip — a genuine RED before implementation.

No gate was skipped; no test passed unexpectedly during the RED phase.

## Threat Surface

The plan's `<threat_model>` mitigations are both covered by passing tests:
- **T-02-03 (DoS/robustness):** the empty / all-expired / all-still-encrypted boards return `null` and the `.not.toThrow()` guard proves no exception — prevents a downstream loop hang.
- **T-02-04 (Tampering / 400-injection):** the fallback-excludes-encrypted and fallback-excludes-expired tests prove a still-undecoded or expired `adId` can never be selected and POSTed to `/solve`.

No new security-relevant surface introduced (pure functional core, no I/O, no schema/network change).

## Self-Check: PASSED

- `src/strategy.ts` exists and exports `chooseAd`.
- `src/strategy.test.ts` exists with `describe("chooseAd (STRAT-03)")`.
- `.planning/phases/02-strategy-core-pure-decision-logic-tdd/02-02-SUMMARY.md` exists.
- Both task commits present in git history (`4d51e46` test, `ca22a25` feat).
