---
phase: 03-game-loop-shop-integration
plan: 02
subsystem: runner
tags: [orchestrator, imperative-shell, termination-guards, error-propagation, vitest, tdd, fake-api-client]

# Dependency graph
requires:
  - phase: 03-game-loop-shop-integration
    plan: 01
    provides: "playGame(api, logger) core loop; MAX_TURN / NO_PROGRESS_LIMIT / END (TURN_CAP & NO_PROGRESS declared but unwired)"
  - phase: 01-foundation-types-api-client-test-seam
    provides: "BoundaryError / TransportError classes; FakeApiClient scripted double; ApiClient/Logger/GameReport types"
  - phase: 02-strategy-core-pure-decision-logic-tdd
    provides: "chooseAd / chooseShopPurchase / applySolveResult / applyBuyResult pure decision functions"
provides:
  - "playGame max-turn cap (state.turn > MAX_TURN → END.TURN_CAP) — climbing-turn backstop (D-05)"
  - "playGame no-progress guard (NO_PROGRESS_LIMIT consecutive non-advancing iterations → END.NO_PROGRESS) with reset-on-advance (D-06)"
  - "Unified stall-termination: an empty board (chooseAd null, no buys) rides into NO_PROGRESS — no separate empty-board reason (D-14)"
  - "Verified error pass-through: a thrown Boundary/TransportError rejects playGame verbatim — no try/catch, no error-class import, no API_ERROR reason (D-10/D-11)"
  - "shouldStop(turn, stalls) predicate returning the END reason or null"
affects: [04 (index.ts CLI composition root — maps GAME_OVER→exit 0, TURN_CAP/NO_PROGRESS→non-zero, catches the propagated typed error)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Termination guards evaluated AFTER each iteration's work, reflecting the just-played turn"
    - "Stall counter with reset-on-advance: stalls = turn > turnBefore ? 0 : stalls + 1"
    - "Error pass-through: no error boundary in the runner — index.ts (Phase 4) owns the catch"
    - "shouldStop(turn, stalls) predicate keeps the loop body readable (plan-sanctioned inline refactor)"

key-files:
  created: []
  modified:
    - src/runner.ts
    - src/runner.test.ts

key-decisions:
  - "Guards checked at the BOTTOM of each iteration (after shop+solve) comparing state.turn to the turn captured at iteration start — so the advancing iteration resets the stall counter BEFORE the guard fires (the reset-on-advance test would falsely trip with a top-of-loop check)."
  - "shouldStop(turn, stalls) extracted as a small predicate returning the END reason or null — done inline during GREEN, so no separate refactor commit (an empty no-op)."
  - "Error pass-through needed ZERO code: a thrown Boundary/TransportError already propagates verbatim through the await-only loop; only doc comments were added. The runner imports no error class and adds no try/catch."
  - "Removed the 03-01 biome-ignore noUnusedVariables suppressions on MAX_TURN / NO_PROGRESS_LIMIT now that both are wired."

patterns-established:
  - "Dual termination guards make non-termination impossible (D-07): turn either climbs (→ TURN_CAP) or stalls (→ NO_PROGRESS)."
  - "The runner is a thin error pass-through (D-11) — typed ApiClient errors reject verbatim; the CLI layer owns the catch."

requirements-completed: [LOOP-02, LOOP-03]

# Metrics
duration: 6min
completed: 2026-06-10
---

# Phase 3 Plan 02: playGame Termination Guards & Error Pass-Through Summary

**TDD-wired the two safety guards (max-turn cap + no-progress stall counter) into `playGame` and verified the typed-error pass-through — proving the loop can NEVER spin forever (turn climbs → TURN_CAP, turn stalls → NO_PROGRESS) and that a mid-game ApiClient error rejects verbatim while solve/buy failure bodies are normal play.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-10T14:55:31Z
- **Completed:** 2026-06-10T15:01:33Z
- **Tasks:** 2 (RED, GREEN; REFACTOR folded into GREEN)
- **Files modified:** 2 (both extended, not created)

## Accomplishments

- **RED:** Added a new `describe("playGame termination & errors", ...)` block with 8 offline `FakeApiClient`-driven `it(...)` cases — TURN_CAP (climbing turn, lives stay > 0), NO_PROGRESS (3 consecutive stalls), reset-on-advance, empty-board→NO_PROGRESS (D-14), `BoundaryError` rejection, `TransportError` rejection, solve-`success:false`-is-normal, and buy-`shoppingSuccess:false`-is-normal. The 4 guard cases failed (RED) because `MAX_TURN`/`NO_PROGRESS_LIMIT` were declared-but-unwired; the 2 error-rejection and 2 failure-body cases already passed (pass-through + normal-play behaviour pre-existed). The 5 plan-03-01 happy-path tests stayed green (additive).
- **GREEN:** Wired both guards into the existing loop without touching the 03-01 shop-drain / fresh-ads / state-threading logic. Added a `stalls` counter that resets the instant `state.turn` advances and accumulates otherwise, plus a `shouldStop(turn, stalls)` predicate returning `END.TURN_CAP` / `END.NO_PROGRESS` / `null`, checked at the bottom of each iteration. The error path needed no code. All 13 runner tests, the full 129-test suite, `tsc --noEmit`, and `biome check .` are clean.
- **Phase 3 is feature-complete:** all three end reasons are reachable and tested — `GAME_OVER` (03-01), `TURN_CAP`, and `NO_PROGRESS` — and the mid-game-error path is a clean typed rejection.

## Task Commits

Each task was committed atomically (TDD gate sequence — `test(03-02)` precedes `feat(03-02)`):

1. **Task 1 (RED): failing tests for turn-cap, no-progress guard, and error pass-through** — `0b287f2` (test)
2. **Task 2 (GREEN): wire turn-cap and no-progress termination guards into playGame** — `9d8d1a4` (feat)

**REFACTOR:** none as a separate commit — the plan's suggested cleanup (extracting a `shouldStop` predicate) was written that way during GREEN, so a separate `refactor(03-02)` commit would have been an empty no-op and was deliberately not made (same rationale as 03-01).

**Plan metadata:** committed separately (SUMMARY + STATE + ROADMAP + REQUIREMENTS).

## Files Created/Modified

- `src/runner.ts` (modified) — wired the two guards into the existing `playGame` loop. Added a top-of-loop `turnBefore` capture, a bottom-of-loop `stalls = state.turn > turnBefore ? 0 : stalls + 1` reset-or-accumulate, and a `shouldStop(turn, stalls)` predicate that returns `END.TURN_CAP` (when `turn > MAX_TURN`) / `END.NO_PROGRESS` (when `stalls >= NO_PROGRESS_LIMIT`) / `null`. Removed the 03-01 `biome-ignore` suppressions on the now-wired constants. No try/catch, no error-class import, `END` still has exactly three reasons. The 03-01 `drainShop` helper and fresh-ads-before-solve ordering are untouched.
- `src/runner.test.ts` (modified) — added `import { BoundaryError, TransportError } from "./api.js"` and a new `describe` block of 8 cases, reusing the existing `baseState`/`solveFixture`/`adFixture` builders and silent logger. The spin-scenario function sources carry bounded throw-guards (well above each guard's trip point) so an UNWIRED-guard RED fails FAST as a rejection instead of spinning to OOM.

## Decisions Made

- **Bottom-of-loop guard check (reset-on-advance correctness):** the stall counter is compared against the turn captured at the START of the same iteration and evaluated AFTER the iteration's work. A top-of-loop check would trip on the third stall BEFORE the advancing iteration's solve could reset the counter — the reset-on-advance test (6 board fetches, 1 solve) specifically pins this ordering.
- **Error pass-through is zero-code:** the await-only loop already lets a thrown `Boundary`/`TransportError` reject `playGame` verbatim; the GREEN change added only documentation. The runner imports no error class and wraps nothing (D-11), so the Phase-4 CLI sees the original typed error.
- **`shouldStop` predicate (plan-sanctioned refactor, inline during GREEN):** keeps the loop body readable while making both guards reachable every iteration; no separate refactor commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test reliability] Spin scenarios OOM'd the Vitest worker in RED instead of rejecting fast**
- **Found during:** Task 1 (RED), first suite run
- **Issue:** The TURN_CAP / NO_PROGRESS / reset / empty-board cases use function sources (which never exhaust) to drive the guard. With the guards UNWIRED the loop spins forever, and the first RED run grew `FakeApiClient.calls` unboundedly until the worker ran out of heap (~31s, OOM crash) — a non-zero exit, but a slow/unreliable RED signal rather than the plan's intended fast rejection.
- **Fix:** Added a bounded throw-guard inside each spin scenario's function source (e.g. `if (iteration > 50) throw …`, and `> MAX_TURN + 50` for the cap), set well ABOVE each guard's GREEN trip point. UNWIRED-guard RED now rejects fast (~160ms); the wired guard (GREEN) fires before the throw-guard, so the bound never interferes.
- **Files modified:** src/runner.test.ts (RED commit)
- **Verification:** RED run dropped from ~31s OOM to ~160ms with exactly the 4 guard cases failing; GREEN run passes all 13 in ~150ms.
- **Committed in:** `0b287f2` (Task 1 RED commit)

---

**Total deviations:** 1 auto-fixed (test-reliability hardening of the RED fixtures).
**Impact on plan:** No behaviour or scope change — the throw-guards only bound a would-be infinite RED spin and never fire on the GREEN path. The RED signal is the same (the 4 guard cases fail because the guards are unwired), just fast and crash-free.

## Issues Encountered

None beyond the RED-spin reliability fix above. The GREEN implementation passed all 13 runner cases on the first wired run; the error pass-through required no code.

## Known Stubs

None — both guards are fully wired and exercised; the error path is a verified pass-through. No placeholder data, no hardcoded empties flowing to output.

## Threat Flags

None — this plan introduced no new network endpoints, auth paths, file access, or schema changes. It hardened the two trust boundaries already in the plan's threat register (API `turn`/`lives` → loop control via the dual guards T-03-05/T-03-06; thrown ApiClient error → caller via verbatim propagation T-03-07; failure-body-vs-thrown-error disambiguation T-03-08), all now test-covered.

## User Setup Required

None — no external service configuration; no new packages installed.

## Next Phase Readiness

- Phase 3 is feature-complete: `playGame` provably terminates in all three scenarios (`GAME_OVER` / `TURN_CAP` / `NO_PROGRESS`), all offline-verified against `FakeApiClient` with zero live network, and a mid-game ApiClient error is a clean typed rejection.
- Phase 4 (`index.ts` CLI composition root) can now wire the real `HttpApiClient` + a concrete `Logger`, call `playGame`, map the three `END` reasons to exit codes (`GAME_OVER` → 0, the other two → non-zero), and `catch` the propagated `Boundary`/`TransportError` for the failure exit path.
- Carried-forward concern (unchanged, Phase 4 scope): the base URL must default to the non-`www` host (`https://dragonsofmugloar.com/api/v2`) and stay configurable — a wiring concern for `index.ts`, unaffected by this plan.

## Self-Check: PASSED

- FOUND: src/runner.ts
- FOUND: src/runner.test.ts
- FOUND: .planning/phases/03-game-loop-shop-integration/03-02-SUMMARY.md
- FOUND commit: 0b287f2 (test(03-02) RED)
- FOUND commit: 9d8d1a4 (feat(03-02) GREEN)

---
*Phase: 03-game-loop-shop-integration*
*Completed: 2026-06-10*
