---
phase: 04-logger-cli-live-smoke
plan: 04
subsystem: integration
tags: [live-smoke, integration-proof, manual-checkpoint, log-01, log-02, d-12]

# Dependency graph
requires:
  - phase: 04-logger-cli-live-smoke (04-01)
    provides: createConsoleLogger(level) — the real pino/pino-pretty sync stream
  - phase: 04-logger-cli-live-smoke (04-02)
    provides: enriched INFO/WARN/DEBUG narration inside playGame + exported END
  - phase: 04-logger-cli-live-smoke (04-03)
    provides: src/index.ts composition root — npm start entrypoint, banner, 0/1/2 exit codes
  - phase: 03-game-loop
    provides: playGame(api, logger) imperative shell returning a GameReport
  - phase: 01-foundation
    provides: HttpApiClient (only fetch caller) + non-www DEFAULT_BASE_URL
provides:
  - "Manual integration evidence that LOG-01 + LOG-02 hold end-to-end against the REAL Dragons of Mugloar API"
  - "Recorded live-run outcomes (score, end reason, exit code) at default and debug levels"
  - "Offline-gate proof: full suite green and verified network-free (D-12 / TEST-01)"
affects: [milestone-close]

# Tech tracking
tech-stack:
  added: []  # verification-only plan — no code, no dependencies
  patterns:
    - "Single live network call in the whole project, invoked manually via npm start (never in CI/test suite)"

# Metrics
metrics:
  tasks: 2
  files_changed: 0  # this SUMMARY only
  commits: 1

# Phase 4 Plan 04: Manual Live Smoke Summary

## Performance

- Duration: ~1 min (two live games)
- Tasks: 2/2 (Task 1 automated offline gate; Task 2 human-verify live smoke — APPROVED)
- Live network calls: 2 full games (the only live calls in the project)

## Accomplishments

Closed Phase 4 with the manual integration proof (D-12, success criterion #4). The CLI wired
in Plans 01–03 was run against the live API and observed to satisfy LOG-01 (leveled,
scannable human-readable narration) and LOG-02 (outcome-reflecting exit code) end-to-end. The
automated suite was re-proven complete and network-free.

## Live Smoke Results

| Run | Command | Exit | Final Score | Turns | End reason | Banner |
|-----|---------|------|-------------|-------|------------|--------|
| Default | `npm start` | 0 | 3768 | 70 | game over: lives reached 0 | intact to stdout |
| Verbose | `LOG_LEVEL=debug npm start` | 0 | 5838 | 93 | game over: lives reached 0 | intact to stdout |

- **Narration (default):** 107 INFO lines — one scannable line per decision/outcome
  (`game started`, `chose ad`, `solve outcome` with lives/gold/score). 0 DEBUG lines at
  default level (raw arrays correctly suppressed). NOT a wall of raw objects.
- **Narration (debug):** 189 DEBUG lines adding the play-by-play — `fetched ads` (with the
  structured `candidates: [...]` view), `fetched shop catalog`, `re-fetched shop catalog after
  buy`, `solved ad`. Fetch boundaries and shop catalog visible.
- **Banner:** the bordered `FINAL SCORE / TURNS PLAYED / END REASON` block printed intact at
  the end of BOTH runs — no truncation, no mid-line flush loss (sync pretty stream +
  `process.exitCode`-not-`process.exit()` discipline held against real output volume).
- **Exit code:** `0` on both natural game-overs, matching the printed end reason (LOG-02).
- **Host:** default non-www `https://dragonsofmugloar.com/api/v2` was reachable
  (`POST /game/start` → HTTP 200); no `MUGLOAR_BASE_URL` override needed this run.

## Offline Gate Results (Task 1)

- `npm test` → exit 0 (146 tests, 7 files)
- `npm run typecheck` (`tsc --noEmit`) → exit 0
- `npm run lint` (`biome check --write .`) → exit 0
- Zero live network calls in the suite: **verified**. The plan's acceptance grep
  (`grep -rE "https?://|nock|msw" src --include=*.test.ts`) matches only URL **string
  literals** asserting base-URL construction plus one comment ("no nock/msw, no real HTTP"). A
  stricter check for an actual network primitive
  (`fetch(` / `undici` / `http.request` / `new Request(`) finds **nothing** in any test file.
  The D-12 / TEST-01 offline guarantee holds; the naive grep is a false positive.

## Task Commits

- (verification-only) — no production code; this SUMMARY is the sole artifact.

## Files Created/Modified

- `.planning/phases/04-logger-cli-live-smoke/04-04-SUMMARY.md` (this file)

## Decisions Made

- Since the live API was reachable from the execution host, the orchestrator ran the smoke and
  captured real evidence; the human-verify checkpoint was then approved by the operator on that
  evidence (rather than asking the operator to run it blind).

## Deviations from Plan

None. The plan anticipated the operator running the smoke manually because the sandbox
historically returned nginx 404s; this run the non-www host was reachable, so the run was
captured directly. The verification content is identical to what the plan specified.

## Issues Encountered

None. Both games completed naturally (lives → 0); no truncation, no unreachable-host fallback
needed, no wrong exit code.

## User Setup Required

None. `npm start` works out of the box against the public API (no auth, no secrets, no env).

## Next Phase Readiness

Phase 4 is complete — all four plans shipped and the live integration is proven. LOG-01 and
LOG-02 are satisfied end-to-end. The milestone (v1.0) is ready to close: the bot autonomously
plays a full Dragons of Mugloar game to completion and reports its final score.

## Threat Surface

- T-04-06 (live host integrity): accepted — fixed non-www HTTPS base URL read once at
  construction; observed HTTP 200, no SSRF vector.
- T-04-01 (untrusted strings in narration): mitigation observed holding against REAL data —
  ad `probability` / shop `name` rode as structured pino fields, never forged log lines.
- T-04-02 (DEBUG dump of raw live objects): accepted — appeared only under the operator's
  deliberate `LOG_LEVEL=debug`.

## Known Stubs

None.

## Self-Check: PASSED
