---
status: complete
phase: 04-logger-cli-live-smoke
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md]
started: 2026-06-11T06:27:37Z
updated: 2026-06-11T06:45:00Z
tester: claude (operator-delegated — ran live CLI and recorded evidence)
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: From a clean checkout, `npm start` boots with no errors, plays one full game against the live API to a natural game-over, and the node process exits 0.
result: pass
evidence: "`npm start` booted clean, played 88 turns against the live API (gameId bQoSGyoL), reached natural game-over (lives → 0), printed the banner, exit code 0. /tmp/uat-test1.log (652 lines)."

### 2. Scannable INFO Narration (default level)
expected: A default `npm start` narrates one readable line per decision — `game started`, `chose ad`, `solve outcome` carrying lives/gold/score — NOT a wall of raw JSON objects, and with no DEBUG play-by-play noise at default level.
result: pass
evidence: "137 INFO entries, 0 DEBUG, 0 WARN, 0 ERROR at default level. Each decision is a colorized headline (`game started` / `chose ad` / `solve outcome`) with a few indented structured fields (gameId, adId, reward, lives, gold, score). Untrusted API strings (e.g. probability \"Piece of cake\") ride as structured fields, never interpolated into the message (T-04-01). Not raw JSON."
note: "Each decision is a headline line PLUS a handful of indented key:value fields beneath it — readable/scannable, but not literally a single physical line. This matches the design intent (pretty structured fields, not a JSON wall)."

### 3. FINAL SCORE Banner
expected: When the game ends, a bordered block prints to the terminal showing FINAL SCORE, TURNS PLAYED, and END REASON — intact, visible regardless of log level.
result: pass
evidence: "Bordered `+---+` banner printed intact at the end of all three completed games — default (FINAL SCORE 5365 / TURNS 88), debug (4161 / 92), and warn (6207 / 100). Shown even at warn level, where all INFO is suppressed — confirms it bypasses pino (T-04-05)."

### 4. Exit Code Reflects Outcome (success)
expected: After a natural game-over from `npm start`, the node process exits with status code 0 (game-over → 0).
result: pass
evidence: "Captured `EXIT:0` for the default, debug, and warn runs — all three ended on natural game-over (lives → 0)."

### 5. Verbose DEBUG Play-by-Play
expected: `LOG_LEVEL=debug npm start` adds verbose play-by-play below the INFO lines — `fetched ads` with a structured candidates view, `fetched shop catalog`, re-fetch after buy — detail that is suppressed at default level.
result: pass
evidence: "Debug run: 188 DEBUG + 142 INFO (vs 0 DEBUG at default). DEBUG headlines: `fetched ads` (48, each with `candidates: [...]` structured view), `fetched shop catalog` (48), `re-fetched shop catalog after buy` (44), `solved ad` (48). Banner intact, exit 0. /tmp/uat-test5.log (9274 lines)."

### 6. Error Path → Exit 2
expected: Pointing the CLI at an unreachable host logs a clear error line plus a `Run failed:` line and the process exits with status code 2 — no stack-trace crash, no hang.
result: pass
evidence: "`MUGLOAR_BASE_URL=http://localhost:1 npm start` → structured `ERROR: game crashed` (kind: \"transport error\", error: \"Network error calling POST /game/start\") + stdout `Run failed (transport error): Network error calling POST /game/start`, exit code 2. Clean failure, no stack dump, no hang."

### 7. Verbosity Flag Control
expected: `npm start -- --log-level warn` shows only warn-and-above lines (INFO suppressed). With both flags, `--log-level` wins. A bogus level falls back rather than crashing.
result: pass
evidence: "Live: `--log-level warn` produced 0 INFO lines (vs 137 at default) — full game still played (100 turns), banner intact, exit 0. Precedence + bogus-fallback confirmed by 13/13 passing index.test.ts cases: `--log-level` beats `--verbose` (Q2), flag > env, unknown --log-level/env falls through (T-04-03). Bonus: `--help`/`-h` prints USAGE and exits 0 without playing (WR-02)."

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none — all tests passed]
