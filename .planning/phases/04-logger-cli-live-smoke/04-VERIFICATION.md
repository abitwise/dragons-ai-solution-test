---
phase: 04-logger-cli-live-smoke
verified: 2026-06-11T00:30:00Z
status: passed
human_accepted: 2026-06-11
score: 4/4 must-haves verified (SC-1..3 automated; SC-4 live half human-accepted)
overrides_applied: 0
human_verification:
  - test: "Review the recorded live-smoke evidence in 04-04-SUMMARY.md and confirm it satisfies SC-4"
    expected: "Two npm start runs against the real API each completed a full game, printed the FINAL SCORE banner intact, and exited 0 — as recorded in 04-04-SUMMARY.md"
    why_human: "The live API cannot be called from CI/offline verification. The recorded evidence (score 3768/5838, exit 0 both runs, banner intact) was captured during execution; a human must accept that evidence as authentic."
    result: "ACCEPTED — operator approved the human-verify checkpoint on 2026-06-11 against the captured live-run evidence (npm start exit 0 score 3768 / LOG_LEVEL=debug exit 0 score 5838, banners intact)."
---

# Phase 4: Logger, CLI & Live Smoke — Verification Report

**Phase Goal:** Running the CLI plays one full game end-to-end, narrates every decision in leveled human-readable output, prints a clear final-score summary, and exits with a status code reflecting the outcome.

**Verified:** 2026-06-11T00:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Each turn's decision and outcome is logged in leveled, human-readable form (INFO per decision, WARN for skips, ERROR for failures) | VERIFIED | `runner.ts` emits 6 `logger.info` calls (game started, chose ad, solve outcome, game stopped, game over + bought item), 2 `logger.warn` calls (no eligible ad; buy not completed), and 4 `logger.debug` calls for play-by-play. `index.ts` emits `logger.error("game crashed")` in the catch path. All untrusted strings pass as structured fields, never interpolated. Covered by 3 offline narration-level tests in `runner.test.ts` (recordingLogger spy asserting INFO/WARN/DEBUG). |
| SC-2 | On game end the CLI prints a distinct final-score block (score, turns, end reason) and exits with a status code that reflects the run outcome | VERIFIED | `printBanner()` in `index.ts` (lines 100–110) writes a bordered block with `FINAL SCORE`, `TURNS PLAYED`, and `END REASON` directly to `process.stdout`. Exit codes: `process.exitCode = exitCodeForReason(report.reason)` (0 = GAME_OVER, 1 = guard stop) and `process.exitCode = 2` in the catch. No `process.exit()` call exists anywhere in the file (confirmed by grep — only comment mentions). `exitCodeForReason` is unit-tested across all three END values. |
| SC-3 | `index.ts` is the only place real `HttpApiClient` and `ConsoleLogger` are constructed and injected into `playGame` | VERIFIED | `new HttpApiClient()` appears exactly once in production code: `index.ts:148`. All other occurrences in `src/` are in `api.test.ts` (test fixtures with an injected no-delay stub — not live construction sites for the CLI path). `createConsoleLogger(level)` appears once: `index.ts:147`. `logger.ts` defines the factory; `index.ts` is the only caller in the production path. |
| SC-4 | A manual live smoke run against the real API completes a full game and prints the summary, while the automated test suite still makes zero live network calls | UNCERTAIN (human needed) | **Offline gate:** `npm test` → 146/146 pass, exit 0. `npm run typecheck` → exit 0. All test network calls are intercepted via `vi.spyOn(globalThis, "fetch")` in `api.test.ts`; no raw `fetch(` call exists in any `*.test.ts` file (grep confirmed). **Live smoke:** Evidence is recorded in `04-04-SUMMARY.md` — two runs (`npm start` exit 0 score 3768/70 turns, `LOG_LEVEL=debug npm start` exit 0 score 5838/93 turns), both ending `game over: lives reached 0`, banner intact. This evidence cannot be reproduced offline. |

**Score:** 3/4 truths verified automatically; SC-4's live-run half requires human acceptance.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/logger.ts` | `ConsoleLogger` + `foldArgs` + `createConsoleLogger` factory | VERIFIED | 128 lines; implements `Logger` interface; only pino/pino-pretty importer; sync pretty stream via `pino(opts, pinoPretty({ sync: true }))`; pure `foldArgs` with all three branches |
| `src/logger.test.ts` | Offline spy tests for fold branches and level routing | VERIFIED | 5 tests using pino `{ enabled: false }` spy; covers object-fold, zero-args, per-level routing, multi-wrap, array-wrap |
| `src/runner.ts` | Enriched narration, exported `END` | VERIFIED | `END` exported as `as const` object at line 49; 6 INFO + 2 WARN + 4 DEBUG logger calls; `ERROR` deliberately omitted (index.ts owns catch — per plan design D-11) |
| `src/runner.test.ts` | `recordingLogger` + 3 narration-level tests | VERIFIED | `describe("playGame narration levels")` at line 413 with 3 offline tests asserting level and non-empty message |
| `src/index.ts` | Composition root: resolveLogLevel, exitCodeForReason, main, printBanner | VERIFIED | 167 lines; `resolveLogLevel` + `exitCodeForReason` exported and unit-tested; `printBanner` writes to `process.stdout`; `safeResolveLogLevel` ensures single `createConsoleLogger` call; `void main()` entrypoint |
| `src/index.test.ts` | Offline unit tests for pure helpers | VERIFIED | 9 tests — 8 for `resolveLogLevel` precedence/rejection matrix + 1 for `exitCodeForReason` mapping |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `index.ts` | `runner.ts playGame` | `import { END, playGame }` | VERIFIED | Line 31: `import { END, playGame } from "./runner.js"` |
| `index.ts` | `logger.ts createConsoleLogger` | `import { createConsoleLogger }` | VERIFIED | Line 30: `import { createConsoleLogger } from "./logger.js"` |
| `index.ts` | `api.ts HttpApiClient` | `import { HttpApiClient }` | VERIFIED | Line 29: `import { HttpApiClient } from "./api.js"` |
| `runner.ts` | `logger` parameter | `Logger` interface injected at call site | VERIFIED | `playGame(api, logger)` and `drainShop(api, state, logger)` both accept the `Logger` interface; `index.ts` injects `createConsoleLogger(level)` result |
| `exitCodeForReason` | `END` from `runner.ts` | `reason === END.GAME_OVER` | VERIFIED | `index.ts:90`: `return reason === END.GAME_OVER ? 0 : 1` — single source of truth |
| `printBanner` | `GameReport` fields | `report.score / report.turns / report.reason` | VERIFIED | Lines 102–104 in `printBanner`; typed fields only (T-04-05) |
| `process.exitCode` | outcome | set in try (`exitCodeForReason`) and catch (hardcoded 2) | VERIFIED | Lines 153 and 162; no `process.exit()` call |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `printBanner` in `index.ts` | `report: GameReport` | `await playGame(api, logger)` | Yes — `playGame` returns `{ score, turns, reason }` from live `api.startGame()` → loop → `applySolveResult` state thread | FLOWING |
| `logger.info("chose ad", ...)` in `runner.ts` | `ad.adId`, `ad.reward`, `ad.probability` | `api.getMessages(state.gameId)` → `chooseAd(ads)` | Yes — real API response decoded via `HttpApiClient`; not hardcoded | FLOWING |
| `logger.info("solve outcome", ...)` in `runner.ts` | `result.success`, `state.lives`, `state.gold`, `state.score` | raw `api.solve(...)` result before `applySolveResult` fold | Yes — captures pre-fold raw body for `success` flag | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes, 146 tests, zero network | `npm test` | exit 0, 146/146 in 275ms | PASS |
| TypeScript type-check clean | `npm run typecheck` (`tsc --noEmit`) | exit 0, no errors | PASS |
| No `process.exit()` in index.ts | `grep -n "process\.exit(" src/index.ts` | Only comment matches, 0 real calls | PASS |
| Single `new HttpApiClient()` in production code | `grep -rn "new HttpApiClient" src/ \| grep -v test` | Exactly 1 match: `index.ts:148` | PASS |
| Single `createConsoleLogger` call | `grep -n "createConsoleLogger(" src/index.ts` | 1 match at line 147 (call), 1 at line 30 (import) — 1 construction call | PASS |
| `END` exported from `runner.ts` | `grep -n "^export const END" src/runner.ts` | Line 49: `export const END = {` | PASS |
| Exit codes correct (0/1/2) | Code inspection `index.ts:153` and `index.ts:162` | 0 or 1 via `exitCodeForReason`; 2 in catch | PASS |
| No debt markers in phase 4 files | `grep -n "TBD\|FIXME\|XXX" src/logger.ts src/runner.ts src/index.ts` | 0 matches | PASS |

---

### Probe Execution

No `scripts/*/tests/probe-*.sh` files declared or found. Phase 04 is a manual-smoke phase; its integration proof is the recorded live run in 04-04-SUMMARY.md.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LOG-01 | 04-01, 04-02 | Each turn's decision and outcome logged in human-readable, leveled output | SATISFIED | `runner.ts` INFO/WARN/DEBUG taxonomy; `ConsoleLogger` behind `Logger` interface; 3 offline narration-level tests; T-04-01 structured-field mitigation applied throughout |
| LOG-02 | 04-03 | Clear final-score summary (score, turns, end reason) printed on game end; CLI exits with status code reflecting the run outcome | SATISFIED | `printBanner` outputs bordered block to stdout; 3-way `process.exitCode` (0/1/2); unit-tested helpers; `process.exit()` absent |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | All three phase-4 source files clean: no TODO/FIXME/XXX/placeholder, no `return null`/`return {}`/`return []` stubs, no hardcoded empty state that flows to output |

---

### Human Verification Required

#### 1. Live Smoke Evidence Acceptance

**Test:** Review the recorded results in `.planning/phases/04-logger-cli-live-smoke/04-04-SUMMARY.md` — the two live game runs and their outputs.

**Expected:**
- `npm start` exits 0, prints the FINAL SCORE banner with score 3768, turns 70, end reason "game over: lives reached 0"
- `LOG_LEVEL=debug npm start` exits 0, prints the FINAL SCORE banner with score 5838, turns 93, same end reason
- Both runs show one scannable INFO line per turn decision at default level, full DEBUG play-by-play at verbose level
- No truncation of the final banner (sync pretty stream + `process.exitCode` discipline held)

**Why human:** The live Dragons of Mugloar API cannot be called from an offline verifier. The recorded evidence in 04-04-SUMMARY.md was captured by the executor during phase execution. A human must confirm they accept this recorded evidence as authentic proof of SC-4.

---

### Gaps Summary

No technical gaps were found. The one open item is acceptance of the pre-recorded live-smoke evidence, which requires a human decision rather than a code fix. All automated criteria (SC-1, SC-2, SC-3) are fully verified in the codebase.

---

_Verified: 2026-06-11T00:30:00Z_
_Verifier: Claude (gsd-verifier)_
