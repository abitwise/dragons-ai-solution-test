---
phase: 04-logger-cli-live-smoke
reviewed: 2026-06-11T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/index.test.ts
  - src/index.ts
  - src/logger.test.ts
  - src/logger.ts
  - src/runner.test.ts
  - src/runner.ts
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-06-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the Phase 4 composition root (`index.ts`), the Pino-backed `ConsoleLogger`
(`logger.ts`), and the enriched runner narration (`runner.ts`), plus their three offline
test suites. The code is unusually well-documented and the pure helpers are cleanly
unit-tested. No security vulnerabilities or data-loss/crash-with-corruption defects were
found — untrusted API strings are consistently passed as structured fields and never
interpolated into log headlines, path segments are encoded upstream, and the base URL is
not derived from API responses.

The defects that remain are robustness and correctness-of-contract issues, concentrated
in the composition root's error/exit-code handling and in the runner's progress heuristic:

- The single most important one (WR-01) is that `main()` is launched with `void main()`
  and **no `.catch()`**, while the logger/client are constructed **outside** the
  authoritative try/catch — so a failure during construction (or any rejection not caught
  inside `main`) becomes an unhandled promise rejection that bypasses the entire D-08
  exit-code contract.
- A declared-but-dead `--help`/`-h` flag (WR-02) silently runs a full game instead of
  printing usage.
- The no-progress guard (WR-03) treats the API's `turn` counter as the *only* progress
  signal, so a turn that advances score/gold/lives without bumping `turn` is miscounted
  as a stall.

No source files were modified — this review is read-only.

## Warnings

### WR-01: `void main()` has no rejection handler and construction runs outside the try/catch — a construction failure bypasses the exit-code contract

**File:** `src/index.ts:142-167`
**Issue:** `main()` is invoked as `void main()` (line 167) with no `.catch(...)`. Inside
`main()`, `safeResolveLogLevel()` is internally guarded, but the two construction calls

```ts
const logger = createConsoleLogger(level);   // line 147 — OUTSIDE the try
const api = new HttpApiClient();              // line 148 — OUTSIDE the try
```

run **before** the `try` block (lines 150-163). If `createConsoleLogger` throws — e.g.
`pinoPretty(PRETTY_OPTIONS)` fails to construct its stream, or `pino(...)` rejects an
option — or if `new HttpApiClient()` throws (it reads `process.env` and runs a regex
`.replace`), the rejection escapes `main()`. Because `void main()` discards the promise
and there is no global `unhandledRejection` handler anywhere in the codebase (verified),
Node terminates with its default unhandled-rejection behavior and a **non-deterministic
exit code** — defeating the explicit D-08 contract (0 = game-over, 1 = guard stop,
2 = thrown Transport/BoundaryError). The module header (lines 12-16) promises "the single
authoritative try/catch," but it does not cover the construction site it depends on.

**Fix:** Wrap the launch so any escape maps to a deterministic exit, and move client
construction inside the try (logger must stay out so the catch can use it, but guard its
construction too):
```ts
void main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(`\nRun failed during startup: ${message}\n`);
  process.exitCode = 2;
});
```
And/or construct `api` inside the `try` block so a constructor throw is caught by the
existing handler rather than escaping.

### WR-02: `--help` / `-h` flag is parsed but never acted on — `npm start --help` silently plays a full game

**File:** `src/index.ts:65` (declaration) and `:142-165` (`main` never reads `values.help`)
**Issue:** `resolveLogLevel` declares the option `help: { type: "boolean", short: "h" }`
in `parseArgs` (line 65), but the parsed `values.help` is never returned, surfaced, or
checked. `main()` never inspects a help flag. The practical result: a user running
`npm start --help` (or `-h`) does **not** get usage text — the flag parses successfully,
falls through to the `"info"` default level, and the bot starts a real game against the
live API. The flag is effectively dead code that actively misleads (it looks supported).
This is a usability/correctness defect for a CLI whose only real flags are verbosity-
related.

**Fix:** Either remove the `help` option entirely (it does nothing), or honor it — e.g.
have `main` parse args once, and if help is set, print a short usage block to stdout and
return with `process.exitCode = 0` before constructing the client/logger. If kept, add a
test asserting the help path prints usage and does not start a game.

### WR-03: No-progress guard equates "turn did not advance" with "no progress" — a real-but-turn-flat advance is miscounted as a stall

**File:** `src/runner.ts:228` (and the guard at `:67-71`)
**Issue:** The stall counter is driven **solely** by the API turn counter:
```ts
stalls = state.turn > turnBefore ? 0 : stalls + 1;
```
`turn` is the only progress signal. But an iteration can make genuine progress without
`turn` increasing as the runner observes it — e.g. a buy or solve that changes
`gold`/`score`/`lives` while the server's `turn` value stays equal to `turnBefore` for
that observation, or any API behavior where `turn` is not strictly monotonic per solve.
In that case the loop is doing real work (and `lives` may still be `> 0`), yet `stalls`
increments and the game is aborted with `END.NO_PROGRESS` after only
`NO_PROGRESS_LIMIT` (3) such iterations — prematurely ending a winnable game and
under-reporting the score. The guard's intent (catch a *flat* loop) is sound, but tying
"progress" exclusively to `turn` is narrower than "the game state changed." The existing
tests only cover the all-empty-board case (turn genuinely flat) and never exercise a
"score/gold advanced but turn did not" iteration, so this gap is untested.

**Fix:** Define progress as "any tracked state field advanced," not just `turn`. For
example reset the stall counter when `turn`, `score`, or `gold` changed:
```ts
const scoreBefore = state.score;
const goldBefore = state.gold;        // capture at line 184 alongside turnBefore
// ...after the iteration's work:
const progressed =
  state.turn > turnBefore ||
  state.score !== scoreBefore ||
  state.gold !== goldBefore;
stalls = progressed ? 0 : stalls + 1;
```
Add a runner test for a solve that bumps score but not `turn`.

### WR-04: `printBanner` width is computed from `String.length`, so a multi-code-unit `reason` mis-borders the banner

**File:** `src/index.ts:106-109`
**Issue:** Width is `Math.max(...rows.map((r) => r.length)) + 2` and each row is padded
with `r.padEnd(width)`. Both `String.length` and `padEnd` count UTF-16 code units, not
visual columns. `report.reason` is typed as a plain `string` (`GameReport.reason` in
`types.ts:104`), and while today it comes from the closed `END` set, the type contract
does not guarantee that. Any value containing astral characters, combining marks, or wide
glyphs (or a future non-ASCII end reason) makes the closing `|` and the bottom border
misalign. This is a cosmetic-but-real robustness gap in the one piece of always-visible
output (the FINAL SCORE banner the live smoke depends on). Lower severity because the
current `END` strings are all ASCII.

**Fix:** Narrow `GameReport.reason` to the `END` union at the type level so the banner
only ever sees known ASCII strings, or add an inline comment documenting the ASCII
assumption. If non-ASCII reasons become possible, measure display width via code points
(`[...r].length`) instead of `.length`.

### WR-05: The exit-2 catch collapses all throw types and double-emits the failure on two channels

**File:** `src/index.ts:154-163`
**Issue:** The catch maps **any** thrown value to exit 2 and emits the failure twice:
`logger.error("game crashed", { error: message })` (line 159, to pino/stderr) **and** a
raw `process.stdout.write("\nRun failed: ...")` (line 161, to stdout). Two issues:
(1) the same failure is written via two different streams, which interleaves confusingly
under pretty rendering and during the live smoke; (2) `api.ts` deliberately distinguishes
`TransportError` (retryable transport) from `BoundaryError` (terminal boundary/schema
drift), yet the catch collapses both — **and** any unexpected non-typed throw (e.g. a
`TypeError` from a real bug) — into one exit-2 path with identical wording. The header
asserts the message "originates from our own typed Error classes" (line 157), but nothing
enforces that; an arbitrary throw lands here too and is reported as if it were an expected
network failure, masking genuine defects during the smoke.

**Fix:** Keep the single exit-2 mapping but branch the *reporting*: `instanceof`-check
`TransportError`/`BoundaryError` (cheap import from `api.js`) and label anything else as
an unexpected internal error so a real bug is visible during smoke. Emit the human-
readable line on exactly one channel to avoid the double-print.

## Info

### IN-01: `safeResolveLogLevel` swallows the parse error with no diagnostic

**File:** `src/index.ts:120-126`
**Issue:** A bad CLI flag makes `parseArgs` throw; `safeResolveLogLevel` catches it with
an empty `catch {}` and silently degrades to `"info"`, discarding the error. The run then
proceeds as if the flag were valid, giving the user no feedback that their flag was
ignored (e.g. a typo'd `--lvel debug`). This is an intentional "non-fatal verbosity"
design (documented at lines 112-118), but a one-line note would turn a silent no-op into
an actionable message without changing exit behavior.
**Fix:** In the catch, `process.stderr.write` a brief "ignored unknown flag, using info"
note before returning `"info"`. The logger is not yet built here, so write directly.

### IN-02: `printBanner` is untested

**File:** `src/index.ts:100-110`; `src/index.test.ts` (no coverage)
**Issue:** `index.test.ts` covers only the two pure helpers (`resolveLogLevel`,
`exitCodeForReason`). `printBanner` — the always-visible FINAL SCORE output the live
smoke relies on, and the locus of WR-04 — has no unit test. It is pure and easily tested
by capturing `process.stdout.write` or by extracting the string-building into a testable
helper.
**Fix:** Extract the banner-string construction into a pure function returning the string,
and assert its shape (border length matches content, all three rows present) in
`index.test.ts`.

### IN-03: `candidateView` duplicates the `Pick` projection inline rather than reusing a named type

**File:** `src/runner.ts:81-90`
**Issue:** The return type `Array<Pick<Ad, "adId" | "reward" | "probability" | "expiresIn">>`
is spelled out and the object literal re-lists the same four fields. Minor duplication; if
`Ad` gains a field that should appear in the DEBUG candidate view, two places must change
in lock-step. Purely a maintainability nit — behavior is correct.
**Fix:** Optionally name the projection (`type AdSummary = Pick<Ad, ...>`) and return
`AdSummary[]`, or leave as-is given the small surface.

---

_Reviewed: 2026-06-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
