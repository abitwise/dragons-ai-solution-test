---
phase: 04-logger-cli-live-smoke
reviewed: 2026-06-11T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/logger.ts
  - src/runner.ts
  - src/index.ts
  - src/logger.test.ts
  - src/runner.test.ts
  - src/index.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues-found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-06-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues-found

## Summary

Reviewed the Phase 4 logger / CLI / narration surface: `src/logger.ts` (the only pino
importer), `src/runner.ts` (enriched INFO/WARN/DEBUG narration + exported `END`),
`src/index.ts` (composition root, log-level resolution, banner, exit codes), and their three
test files.

The code is well-structured and the core threat-model claims hold up under direct inspection:

- **T-04-01 (log forging) is genuinely mitigated.** Every untrusted live-API string — ad
  `probability` (`runner.ts:200`), shop item `name` (`runner.ts:122-127`, `131-136`), and the
  caught error `message` (`index.ts:159`) — rides as a STRUCTURED object field, never
  interpolated into the message headline. `foldArgs` (`logger.ts:45-58`) correctly keeps a
  single object as the merge object and the literal headline as the message. The DEBUG
  candidate view (`runner.ts:81-90`) deliberately omits the raw ad `message`/encrypted text.
- **Exit-code drain discipline is correct.** `index.ts` sets `process.exitCode` and returns;
  it never calls `process.exit()` (verified: the three `process.exit` greps are all comment
  text). `PRETTY_OPTIONS.sync = true` (`logger.ts:113`) makes the pretty stream synchronous so
  final lines flush. Exit mapping (0 game-over / 1 guard / 2 thrown) is wired via the exported
  `END` single source of truth.
- **Log-level resolution rejects bogus levels** against the closed `PINO_LEVELS` set
  (`index.ts:41`, `73`/`77`), so a bad value can never crash pino or silently disable output.
- **No accidental `console.*`** in any production module; all output flows through the `Logger`
  interface or the deliberate `process.stdout.write` banner/failure paths.

No Critical issues found. Two Warnings concern a stated-vs-actual behavior divergence around
bad-CLI-flag handling, and a dead `--help`/`-h` option. Three Info items cover minor
robustness/quality nits.

## Warnings

### WR-01: `safeResolveLogLevel` swallows the bad-flag throw, contradicting the documented exit-2 contract

**File:** `src/index.ts:120-126` (and the contradicted JSDoc at `src/index.ts:54-57`)
**Issue:** The JSDoc on `resolveLogLevel` states the bad-flag path explicitly: *"`parseArgs`
runs in `strict` mode, so an unknown FLAG (not value) THROWS; `main` calls this inside its
try/catch so a bad flag surfaces as a clean exit-2 failure rather than an uncaught crash (this
function does NOT swallow that throw)."* The plan's threat register (T-04-04) likewise asserts
the throw is *"caught by main's try/catch → clean exit 2 with a failure line."*

But `main` does **not** call `resolveLogLevel` inside the try — it calls `safeResolveLogLevel()`
(`index.ts:143`), which wraps the call in its own `try { ... } catch { return "info"; }`
(`index.ts:121-125`). So an unknown flag (e.g. `npm start -- --bogus-flag`) is silently
swallowed: the bot degrades to `info` and **plays a full real game**, never reaching the exit-2
path. The actual behavior is the opposite of what both the JSDoc and the threat model claim.

This is a divergence between documented/threat-modeled contract and runtime behavior, not a
crash. It was an intentional deviation (per 04-03-SUMMARY) to satisfy the single-construction-site
grep gate, but the contradicting JSDoc on `resolveLogLevel` (lines 54-57) was left stale and now
actively misleads a reader about the bad-flag outcome. The empty `catch {}` (line 123) also
discards the parse error entirely, so a typo'd flag produces zero diagnostic — the user just
sees a normal game run at the wrong verbosity.

**Fix:** Pick one and make code + docs agree. Either (a) keep the swallow but correct the
`resolveLogLevel` JSDoc and warn the user on a swallowed flag:
```ts
function safeResolveLogLevel(): string {
  try {
    return resolveLogLevel(process.argv.slice(2), process.env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`Ignoring invalid CLI flag (${msg}); defaulting to log level "info".\n`);
    return "info";
  }
}
```
and update the `resolveLogLevel` JSDoc to drop the "surfaces as a clean exit-2" claim. Or (b)
honor the documented contract by resolving the level inside `main`'s try and constructing the
logger lazily, so a bad flag actually drives exit 2. Whichever is chosen, the JSDoc at
`index.ts:54-57` and the T-04-04 threat note must match the code.

### WR-02: `--help` / `-h` flag is registered but never acted upon (dead behavior)

**File:** `src/index.ts:65`
**Issue:** `parseArgs` registers `help: { type: "boolean", short: "h" }`, but `values.help` is
never read anywhere in the module (confirmed by grep — `help` appears only at line 65). A user
running `npm start -- --help` or `-h` gets no usage text; instead the bot silently starts a
**live game** against the real Dragons of Mugloar API and plays it to completion. For a CLI,
`--help` triggering a full network-driven game run rather than printing usage is a surprising,
arguably harmful no-op (it hits the live external dependency). Registering the option but not
handling it is dead config that implies a feature that does not exist.

**Fix:** Either remove the `help` option (don't advertise what isn't implemented), or honor it
before constructing the client and playing — print usage and return without touching the
network:
```ts
async function main(): Promise<void> {
  const { values } = parseArgs({ /* ...same options... */ });
  if (values.help === true) {
    process.stdout.write(
      "Usage: npm start [-- --log-level <level> | --verbose] \n" +
      "Plays one game of Dragons of Mugloar and prints the final score.\n",
    );
    return;
  }
  // ...resolve level, construct, play...
}
```
Note this also interacts with WR-01: today `--help` is parsed by `resolveLogLevel`, succeeds
(it is a known flag, so no throw), and is then ignored.

## Info

### IN-01: `exitCodeForReason` collapses every non-game-over reason to 1, including unknown strings

**File:** `src/index.ts:89-91`
**Issue:** `exitCodeForReason(reason)` returns `reason === END.GAME_OVER ? 0 : 1`. Any string
that is not the exact `GAME_OVER` literal maps to `1` — including a hypothetical future `END`
reason, a typo, or an empty string. Today the only callers pass one of the three closed `END`
strings, so this is correct in practice, but the "else → 1" catch-all silently treats an
unrecognized reason as a guard-stop rather than signaling the mismatch. Low risk given the
closed `END` set; worth a defensive note.
**Fix:** Optionally make the guard-stop reasons explicit so an unrecognized reason is visible
rather than silently bucketed:
```ts
export function exitCodeForReason(reason: string): 0 | 1 {
  if (reason === END.GAME_OVER) return 0;
  if (reason === END.TURN_CAP || reason === END.NO_PROGRESS) return 1;
  // Unknown reason — keep returning 1 but the explicit branches document intent
  return 1;
}
```

### IN-02: `foldArgs` casts to `Record<string, unknown>` without narrowing the object's index signature

**File:** `src/logger.ts:55`
**Issue:** The single-object branch returns `args[0] as Record<string, unknown>`. The runtime
guard (`typeof === "object" && !== null && !Array.isArray`) is correct, but the `as` assertion
is a type-level escape hatch — a non-record object (e.g. a `Date`, `Map`, or class instance)
passed as the lone arg would be cast and handed to pino as a merge object. This matches pino's
own permissive contract and is exercised safely by all current call sites (which pass plain
object literals), so it is not a bug today; flagging only because the project's stack guidance
discourages loose type assertions. No functional change needed for current usage.
**Fix:** Acceptable as-is given pino's contract. If tightened, validate plain-object-ness or
keep the `as` but document why the runtime guard makes it sound.

### IN-03: Banner border width can desync if a row contains multibyte/zero-width characters

**File:** `src/index.ts:106-109`
**Issue:** `printBanner` computes `width` from `r.length` (UTF-16 code-unit count) and pads with
`padEnd(width)`. Because the printed rows are built **only** from typed `GameReport` numeric
fields (`score`, `turns`) and the closed `END` `reason` string (`index.ts:101-105`), no
untrusted or multibyte content reaches the banner — so the border and body stay aligned in
practice and there is no security exposure (T-04-05 holds). Noted only as a latent assumption:
if a future `reason` string ever carried wide/zero-width characters, `length`-based padding
would misalign the ASCII border. Purely cosmetic and currently unreachable.
**Fix:** No action required for v1. If the banner ever renders free-text in future, switch to a
display-width-aware measure instead of `.length`.

---

_Reviewed: 2026-06-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
