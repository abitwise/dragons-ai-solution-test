---
phase: 04-logger-cli-live-smoke
fixed_at: 2026-06-11T00:46:30Z
review_path: .planning/phases/04-logger-cli-live-smoke/04-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-06-11T00:46:30Z
**Source review:** .planning/phases/04-logger-cli-live-smoke/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (all Warnings — `fix_scope: critical_warning`)
- Fixed: 5
- Skipped: 0
- Out of scope (not attempted): IN-01, IN-02, IN-03 (Info tier)

All fixes were verified with Tier 1 (re-read), Tier 2 (`tsc --noEmit` + `biome check`),
and the full Vitest suite (151 tests passing after every fix). The worktree had no
`node_modules`, so the project's installed toolchain (`tsc`, `biome`, `vitest`) was
invoked directly to make module resolution and type-checking authoritative rather than
falling back to a bare syntax check.

## Fixed Issues

### WR-01: `void main()` had no rejection handler and construction ran outside the try/catch

**Files modified:** `src/index.ts`
**Commit:** b634785
**Applied fix:** Moved `new HttpApiClient()` INSIDE `main`'s existing `try` so a
constructor throw (it reads `process.env` and runs a regex `.replace`) is caught and
mapped to the deterministic exit-2 path. Wrapped the launch as
`void main().catch(...)` so any escape — most importantly a throw during
`createConsoleLogger` (which must stay OUTSIDE the try so the catch can use the logger)
— maps to a deterministic exit 2 instead of an unhandled rejection with a
non-deterministic exit code. Preserves the D-08 contract.

### WR-02: `--help` / `-h` flag was parsed but never acted on

**Files modified:** `src/index.ts`, `src/index.test.ts`
**Commit:** 016c078
**Applied fix:** Added an exported pure `isHelpRequested(argv)` helper (non-strict
`parseArgs` so help is honored even alongside an unknown flag) and an exported `USAGE`
block. `main` now checks help FIRST and, when set, prints `USAGE` to stdout and returns
with `process.exitCode = 0` before constructing the logger/client or starting a game.
Added four `index.test.ts` cases asserting help detection (`--help`/`-h`, the
non-help/false cases, the unknown-flag-coexistence case, and a non-empty `USAGE`).
Test count for that file went from 9 to 13, all passing.

### WR-03: No-progress guard equated "turn did not advance" with "no progress"

**Files modified:** `src/runner.ts`, `src/runner.test.ts`
**Commit:** e5ccdfd
**Applied fix:** Captured `scoreBefore` and `goldBefore` alongside `turnBefore` at the
top of each loop iteration, then defined progress as
`state.turn > turnBefore || state.score !== scoreBefore || state.gold !== goldBefore`.
The stall counter now resets when ANY tracked state field advances, so a turn-flat-
but-real-progress iteration is no longer miscounted as a stall and a winnable game is not
aborted prematurely. Added a `runner.test.ts` case driving repeated score-advancing
turn-flat solves and asserting the game ends via GAME_OVER (lives:0) rather than
NO_PROGRESS, running well past `NO_PROGRESS_LIMIT`. The three existing no-progress tests
still pass because their stall scenarios genuinely change nothing (empty board, no buys,
turn/score/gold all flat).

**NOTE — requires human verification:** This is a behavioral/logic change to the
termination guard. Tiers 1–2 plus the full suite confirm it is syntactically correct,
type-correct, and that no existing test regressed, but a developer should confirm the
new progress definition matches the intended termination semantics (especially that the
guard still reliably catches a truly flat loop in live play).

### WR-04: `printBanner` width computed from `String.length` — a non-ASCII `reason` could mis-border the banner

**Files modified:** `src/types.ts`, `src/runner.ts`
**Commit:** df54873
**Applied fix:** Applied the finding's preferred fix — narrowed the type rather than
changing the width math. Added a type-level `EndReason` string-literal union to
`types.ts` (the three exact END strings; no runtime value, no runtime import, so
`types.ts` stays the leaf of the dependency graph) and changed `GameReport.reason` from
`string` to `EndReason`. Added a type-only drift-catcher in `runner.ts`
(`type _AssertEndValuesAreEndReason = (typeof END)[keyof typeof END] extends EndReason ? true : never;`)
so `tsc` fails if a runtime `END` value ever drifts from the union or a fourth reason is
added without updating the type. The banner now only ever receives one of three known
ASCII strings. All 151 tests still pass and `tsc`/`biome` are clean.

### WR-05: The exit-2 catch collapsed all throw types and double-emitted the failure on two channels

**Files modified:** `src/index.ts`
**Commit:** 9987ee3
**Applied fix:** Imported `TransportError`/`BoundaryError` from `api.js` and branched the
catch's *reporting* (not the exit code — still a single exit-2 mapping) by `instanceof`:
`transport error`, `boundary error`, or `unexpected internal error` for anything else
(so a real `TypeError` stands out during the live smoke instead of being masked as an
expected network failure). Removed the double-print: the human-readable headline is now
emitted on exactly one channel (the always-visible `process.stdout.write`, shown even at
`silent`), while `logger.error` carries only the structured `{ kind, error }` diagnostic
fields and no longer repeats the human headline.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-06-11T00:46:30Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
