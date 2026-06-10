---
phase: 04-logger-cli-live-smoke
plan: 02
subsystem: testing
tags: [logging, pino, narration, runner, vitest, log-levels]

# Dependency graph
requires:
  - phase: 03-game-loop-shop-integration
    provides: "playGame(api, logger) loop, drainShop, the two termination guards, the three END strings"
  - phase: 04-logger-cli-live-smoke (04-01)
    provides: "ConsoleLogger + createConsoleLogger (the Pino-backed Logger impl) and the foldArgs message-first bridge"
provides:
  - "Enriched runner.ts turn-level narration on the INFO/WARN/DEBUG taxonomy (LOG-01)"
  - "Exported `END` reason vocabulary from runner.ts for DRY reason->exit-code mapping in index.ts (Plan 03)"
  - "Recording-spy Logger tests proving the level taxonomy offline (assert level, not wording)"
affects: [04-03 (index.ts imports END for exit-code mapping), 04-04 (live smoke watches the narration)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Turn-level narration taxonomy: INFO=decisions/outcomes, WARN=skips/nothing-to-do, DEBUG=verbose play-by-play; raw arrays never above DEBUG"
    - "Untrusted API strings (ad probability, shop name) passed as STRUCTURED log fields, never interpolated into the message (T-04-01)"
    - "Recording Logger spy: a four-push-closure factory capturing { level, message } to assert the level contract without coupling to wording"

key-files:
  created: []
  modified:
    - src/runner.ts
    - src/runner.test.ts

key-decisions:
  - "Q1 resolved option (b): export `END` from runner.ts (additive only) so index.ts maps reason->exit-code from one source of truth"
  - "Captured the raw SolveResult before folding so the INFO outcome line reports the body's `success` boolean (the source of truth), not a derived guess"
  - "Narration tests assert the recorded LEVEL (+ non-empty message), never the rendered string, so wording stays free to change"

patterns-established:
  - "INFO/WARN/DEBUG turn narration taxonomy applied inside the LOCKED loop with no control-flow change"
  - "Structured-field logging of untrusted API strings as the log-injection mitigation (T-04-01)"
  - "recordingLogger() in-file factory for level-taxonomy assertions"

requirements-completed: [LOG-01]

# Metrics
duration: 3min
completed: 2026-06-10
---

# Phase 4 Plan 02: Runner Narration Taxonomy + Exported END Summary

**Enriched `runner.ts` so each turn narrates its chosen ad, solve outcome, and shop buys at INFO, its empty-board/failed-buy skips at WARN, and the candidate/catalog/fetch play-by-play at DEBUG — plus exported the `END` reason vocabulary for DRY exit-code mapping, all without touching loop mechanics, the signature, the guards, or the three END strings.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-10T20:51:04Z
- **Completed:** 2026-06-10T20:53:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Promoted the turn decision/outcome to INFO (a new "chose ad" line + a "solve outcome" line carrying the body's `success` and the lives/gold/score state) while keeping the verbose per-field detail at DEBUG — a default `info` run is now one scannable line per decision.
- Added WARN narration on the two skip paths: the no-eligible-ad / empty-board turn (D-14 nothing-to-do) and a `shoppingSuccess:false` buy in `drainShop`.
- Added DEBUG play-by-play: the candidate ads + their reward/probability/expiry view each turn, the shop catalog, and the shop fetch boundaries — raw arrays ride ONLY at DEBUG.
- Exported `END` (additive, byte-identical strings) so `index.ts` (Plan 03) can map `GameReport.reason` to exit codes from a single source of truth.
- Added a `recordingLogger()` spy and three offline behavioral tests asserting the INFO/WARN level taxonomy on the solved-turn, empty-board, and failed-buy paths.

## Task Commits

Each task was committed atomically:

1. **Task 1: Export END + enrich runner narration (INFO/WARN/DEBUG taxonomy)** - `821eb0a` (feat)
2. **Task 2: Assert narration LEVELS via a recording Logger spy** - `72d10d4` (test)

## Files Created/Modified
- `src/runner.ts` - Exported `END`; threaded the `Logger` into `drainShop`; added INFO (chose ad / solve outcome / bought item), WARN (no-eligible-ad / shoppingSuccess:false), and DEBUG (candidate view, shop catalog, fetch boundaries) narration inside the locked loop; added a private `candidateView` helper deriving a structured DEBUG view from the already-fetched `ads` (no new strategy export).
- `src/runner.test.ts` - Added a `recordingLogger()` factory capturing `{ level, message }` and a `playGame narration levels` describe block with three offline cases (info on a solved turn, warn on the empty board, warn on a failed buy).

## Decisions Made
- **Q1 → option (b): export `END`.** Chosen per CONTEXT/RESEARCH Open Q1 to keep the reason->exit-code mapping DRY and greppable in Plan 03's `index.ts`. The `as const` object and its three exact strings are unchanged; only the `export` keyword was added.
- **Capture the raw `SolveResult` before folding.** The INFO "solve outcome" line needs the body's `success` boolean (the source of truth, not HTTP status). Since `applySolveResult` drops `success`, the raw result is bound to a local first, then folded — so the outcome line reports the true flag.
- **Runner emits no `logger.error`.** The plan left this to discretion (Phase 3 D-11 / D-09 make `index.ts` the authoritative error logger). No try/catch was added; a thrown error still rejects `playGame` verbatim. `logger.error` narration is deferred to `index.ts`'s catch in Plan 03.

## Deviations from Plan

None — plan executed exactly as written. (One intra-task self-correction: an initial draft of the "solve outcome" INFO line used a placeholder expression for `success`; it was immediately replaced with the body's real `success` boolean by capturing the raw `SolveResult` before folding. This was corrected before the Task 1 commit and is reflected in the decisions above, not a post-commit fix.)

## Issues Encountered
None. All gates passed first time after the in-flight `success` correction: `tsc --noEmit` clean, `biome check` clean, full suite 137/137 (was 134; +3 new narration tests).

## Threat Surface
No new security surface introduced. The T-04-01 (log-injection) and T-04-02 (raw-object disclosure above DEBUG) mitigations from the plan's threat model were applied as designed: every untrusted API string (ad `probability`, shop `name`) is passed as a structured object field, and all raw arrays/catalogs ride only at DEBUG. No new dependencies (T-04-SC accept holds).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `END` is now an export, unblocking Plan 03's `index.ts` exit-code mapping (`import { END }` → `reason->code`, D-08).
- The INFO/WARN/DEBUG narration is in place, so the Plan 04 live smoke (`npm start` / `LOG_LEVEL=debug npm start`) will show the scannable one-line-per-decision INFO narrative and the full DEBUG play-by-play.
- Phase-3 loop mechanics, the `playGame(api, logger)` signature, the two guards, and the three `END` strings are all unchanged; Phase-3 tests stay green.

## Self-Check: PASSED

- FOUND: src/runner.ts (modified, `export const END` present)
- FOUND: src/runner.test.ts (modified, `recordingLogger` + 3 narration-level tests present)
- FOUND commit: 821eb0a (Task 1 — feat: export END + enrich runner narration)
- FOUND commit: 72d10d4 (Task 2 — test: assert narration levels via recording spy)
- Verified: typecheck 0, lint 0, full suite 137/137 passing

---
*Phase: 04-logger-cli-live-smoke*
*Completed: 2026-06-10*
