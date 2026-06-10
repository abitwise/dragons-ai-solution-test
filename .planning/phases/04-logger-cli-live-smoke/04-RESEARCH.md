# Phase 4: Logger, CLI & Live Smoke - Research

**Researched:** 2026-06-10
**Domain:** Pino + pino-pretty wiring under ESM/tsx, `node:util` parseArgs CLI, exit-code mapping, flush-safe short-lived CLI
**Confidence:** HIGH (every recommendation below was executed against the project's own installed `pino@10.3.1` / `pino-pretty@13.1.3` on Node v24.12.0 via `tsx`, not inferred from training data)

## Summary

Phase 4 is wiring and presentation over a locked, fully-tested core. The only genuinely-uncertain
mechanic — making pino-pretty render reliably under `tsx` and flush completely before a short-lived
CLI exits — was **empirically resolved**: use the **synchronous pretty-stream** form
`pino(opts, pretty({ ..., sync: true }))`, NOT the worker-thread `transport: { target: 'pino-pretty' }`
form. The sync form was verified to render all four levels with color, attach structured fields
readably, and survive an immediate `process.exit(0)` with **zero dropped lines** and correct ordering
relative to a direct-to-stdout banner. The worker-thread form introduces an async flush boundary that
is a documented "logs-lost-on-exit" risk; it happened to flush reliably on this exact version combo in
8/8 probe runs, but the sync form removes the entire risk class by construction, so it is the
recommendation.

The other four focus areas are low-risk and were each verified by running real code: the
message-first→object-first fold (`pino[level](mergeObj, message)`) renders correctly for all arg
shapes the runner produces; `node:util parseArgs` handles `--verbose`/`-v`/`--log-level`/`--help` in
strict mode with `allowPositionals: false`; the final-score banner via `process.stdout.write` bypasses
pino and stays visible at any level; and the 3-way exit-code split is a pure function of
`GameReport.reason` plus the catch path. The offline test seam is a `vi.spyOn` over an injected pino
instance — 3ms, no network, no pretty-output capture.

**Primary recommendation:** Construct the logger as `pino({ level }, pinoPretty({ colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname', sync: true }))`; print the banner with `process.stdout.write`; set `process.exitCode` and **return** (let natural exit drain the sync stream) rather than calling `process.exit()`; resolve the level with `flag > LOG_LEVEL env > 'info'` via `parseArgs`; map `reason` → exit code with a pure function and catch typed errors → exit 2.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `logger.ts` wraps Pino + pino-pretty behind the existing `Logger` interface. Class is `ConsoleLogger`. (Supersedes ARCHITECTURE.md's "tiny console wrapper" note.)
- **D-02:** Adapt the call shape. `Logger` is `method(message, ...args)`; pino is `method(mergingObject, message)`. `ConsoleLogger` folds variadic `...args` into one merge object and calls `pino[level](obj, message)`. Exact folding = Claude/planner discretion.
- **D-03:** Always-pretty transport (not NODE_ENV-gated). pino-pretty options (colorize, translateTime, `ignore: pid,hostname`) = Claude's discretion.
- **D-04:** Phase 4 enriches `runner.ts`'s `logger.*` calls inside the existing, locked loop (no mechanics change). Runner calls only the `Logger` interface — never `console`/`pino`/`pino-pretty`.
- **D-05:** Level taxonomy — INFO = decisions/outcomes (chosen ad + solve result with deltas, each shop buy, start line, guard/game-over stop line). WARN = skips/nothing-to-do (no eligible ad/empty board, skipped encrypted/unhandled ads, `shoppingSuccess:false` buy). ERROR = failures (thrown Transport/BoundaryError logged in context; runner MAY log before unwind, authoritative catch in `index.ts`). DEBUG = verbose play-by-play (candidate ads + EV ranking, shop catalog, fetch boundaries, raw API objects — never dump raw arrays above DEBUG).
- **D-06:** Verbose-but-scannable. Play-by-play lives at DEBUG; default `info` run stays one readable line per decision/outcome/skip; `LOG_LEVEL=debug`/`--verbose` reveals full reasoning. INFO must not bury the decision narrative.
- **D-07:** Distinct, always-visible final-score block printed to **stdout directly (not through pino)** — bordered `FINAL SCORE` banner with score/turns/end reason, visible regardless of log level. Banner art/format = Claude's discretion.
- **D-08:** 3-way exit-code split — `0` = `GAME_OVER`, `1` = guard stop (`TURN_CAP` or `NO_PROGRESS`), `2` = thrown `Transport/BoundaryError`. `index.ts` maps the three `END` reason strings → 0/1 and the catch path → 2.
- **D-09:** `index.ts` owns the error path — single `try/catch` around `await playGame(...)`. Typed error → failure message + outcome line + exit 2; normal return → final-score block + exit 0/1. `playGame` never catches.
- **D-10:** Verbosity via env var + flag, default `info`. Resolve from `LOG_LEVEL` env AND `--verbose`/`-v` flag (via `node:util parseArgs`; `--log-level <lvl>` and `--help` reasonable companions). **Precedence: explicit flag > `LOG_LEVEL` env > default `info`** (`--verbose` → `debug`). Resolved level passed into `ConsoleLogger` at construction.
- **D-11:** No positional args. Only inputs are the optional verbosity flag/env and the existing `MUGLOAR_BASE_URL` env (read in `api.ts`, default non-`www`).
- **D-12:** Live smoke = `npm start` (already `tsx src/index.ts`) against the real API; `LOG_LEVEL=debug npm start` exercises the play-by-play. The ONLY live network call in the project; automated suite stays offline.

### Claude's Discretion
- pino-pretty options and the exact `...args`→merge-object folding (D-02/D-03).
- Final-score block visual format and failure message wording (D-07/D-09).
- Exact flag set/aliases (`--verbose`/`-v`, `--log-level`, `--help`) and `parseArgs` config, as long as flag > env > `info` holds (D-10).
- Whether the runner emits `logger.error` itself before unwind vs letting `index.ts`'s catch be sole error logger (D-09 makes `index.ts` authoritative either way).
- Whether `index.ts` carries a `#!/usr/bin/env node` shebang / `bin` entry (optional).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within Phase 4 scope. RUN-01 (multi-game stats), STRAT-07 (adaptive probability memory), STRAT-08 (reputation weighting) remain parked in REQUIREMENTS.md v2. A `bin` entry / global install is optional polish under discretion, not a deferral.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOG-01 | Each turn's decision and outcome is logged in human-readable, leveled output | Focus #1 (sync pretty-stream wiring), Focus #2 (message-first→object-first fold so `runner`'s existing `logger.info("game started", {…})` calls render); D-05/D-06 level taxonomy applied to the narration enrichment in `runner.ts` |
| LOG-02 | A clear final-score summary (score, turns, end reason) is printed on game end, and the CLI exits with a status code reflecting the run outcome | Focus #4 (banner to stdout bypassing pino), Focus #5 (3-way exit-code mapping + typed-error catch), Focus #3 (verbosity resolution) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack:** TypeScript on Node 24, ESM (`"type": "module"`), native `fetch`. No new runtime deps beyond `pino@^10`/`pino-pretty@^13`/`zod@^4` already in `package.json`.
- **No frameworks / no DI container / no extra deps.** "DI" = passing one argument. No oclif/yargs (use `node:util parseArgs`), no winston, no nock/msw.
- **No TS `enum`/`namespace`/decorators** — use `const` objects / string-literal unions (tsx strips but doesn't transform; the existing `END` is already a `const` object).
- **TDD, tests offline:** new `logger.ts` coverage must not require a network; suite stays at zero live calls (TEST-01). Live smoke is manual (D-12).
- **Keep it simple:** six flat files under `src/`; `logger.ts` and `index.ts` are the two files this phase adds. `tsc --noEmit` must stay green; `biome check --write .` must pass.
- **GSD workflow in effect.**

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Leveled human-readable narration | `logger.ts` (imperative shell) | `runner.ts` (emits via `Logger` interface) | Only `logger.ts` touches pino/pino-pretty; runner depends on the `Logger` interface, never on the impl |
| Log-level resolution (flag/env/default) | `index.ts` (composition root) | — | The CLI surface is owned by the entrypoint; the resolved string is injected into `ConsoleLogger` |
| Dependency construction & injection | `index.ts` (composition root) | — | Only place `HttpApiClient` + `ConsoleLogger` are constructed (locked carry-forward) |
| Final-score banner (always-visible) | `index.ts` → `process.stdout` | — | Bypasses pino deliberately (D-07); presentation, not narration |
| Error catch + exit-code mapping | `index.ts` | — | Single try/catch around `playGame` (D-09); `GameReport.reason` → 0/1, thrown typed error → 2 (D-08) |
| Game loop & termination | `runner.ts` (LOCKED) | — | Out of scope to change; Phase 4 only ADDS `logger.*` calls inside it |
| HTTP transport / retry / errors | `api.ts` (LOCKED) | — | `index.ts` constructs `HttpApiClient` and catches its error classes; does not modify it |

## Standard Stack

### Core
| Library | Version (verified) | Purpose | Why Standard |
|---------|--------------------|---------|--------------|
| pino | 10.3.1 `[VERIFIED: node_modules/pino/package.json]` | Leveled logger | Already in `dependencies`; chosen in STACK.md/SUMMARY.md; D-01 locks it |
| pino-pretty | 13.1.3 `[VERIFIED: node_modules/pino-pretty/package.json]` | Human-readable colorized output | Already in `dependencies`; the pretty transport/stream for the reviewer-facing narration |
| `node:util` `parseArgs` | built into Node v24.12.0 `[VERIFIED: ran node -e]` | CLI flag parsing | Stdlib; D-10's chosen parser; no framework needed |

No new packages are installed in this phase. **Package Legitimacy Audit is N/A** (zero new dependencies; `pino`/`pino-pretty` were vetted and installed in prior phases).

### Module-shape facts (verified by inspecting installed files)
- Both `pino` and `pino-pretty` ship as `"type": "commonjs"` but interop cleanly under tsx/ESM. `[VERIFIED: package.json grep + executed under tsx]`
- `pino-pretty`'s default export is a **callable factory**: `module.exports = build`, typed `declare function PinoPretty(options?): PrettyStream` where `PrettyStream = Transform & OnUnknown`. So `import pretty from "pino-pretty"; pretty({...})` returns a writable Transform stream usable as pino's 2nd arg. `[VERIFIED: node_modules/pino-pretty/index.js + index.d.ts]`
- `pino` has a two-arg overload `pino(options, stream)` `[VERIFIED: pino.d.ts:874]` and `PrettyOptions` includes `sync?: boolean` ("Makes messaging synchronous", index.d.ts:147) and `destination` `[VERIFIED: node_modules/pino-pretty/index.d.ts]`.

## Architecture Patterns

### System Architecture Diagram (Phase 4 data flow)

```
   process.argv ─┐
   LOG_LEVEL env ─┼──▶ resolveLevel()  ──(string: 'info'|'debug'|…)──┐
   (default 'info')┘    [index.ts, pure]                              │
                                                                      ▼
                              new HttpApiClient()        new ConsoleLogger(pino(opts, prettyStream))
                                     │                            │
                                     └──────────┬─────────────────┘
                                                ▼  inject both
                                        await playGame(api, logger)   ──┐
                                                │                       │ logger.* (interface only)
                                                │ returns GameReport     ▼
                                                │                  pino[level](mergeObj, message)
                                                │                       │
                                                ▼                       ▼  pretty stream (sync)
              ┌── normal return ──▶ printBanner(report) ──▶ process.stdout.write (bypasses pino)
              │                     process.exitCode = exitCodeFor(report.reason)  // 0 or 1
   try/catch ─┤
              └── throws (Transport/BoundaryError) ──▶ logger.error + failure line
                                                        process.exitCode = 2
   (no process.exit() call → natural exit drains the synchronous pretty stream)
```

### Pattern 1: Synchronous pretty-stream logger (THE primary decision)
**What:** Build the pino instance with the pretty stream passed as the second argument, in synchronous mode.
**When to use:** Always, for this short-lived CLI. Avoids the worker-thread flush risk entirely.
**Verified code shape** (executed under `tsx` against the project's installed versions — rendered all 4 levels, survived immediate `process.exit(0)` with no dropped lines):
```typescript
// logger.ts — the ONLY module importing pino / pino-pretty (honors D-01 + dependency direction)
import pino from "pino";
import pinoPretty from "pino-pretty";
import type { Logger } from "./types.js";

type LevelMethod = "debug" | "info" | "warn" | "error";

/** Fold the message-first variadic args into pino's merge-object-first idiom (D-02). */
function foldArgs(args: unknown[]): Record<string, unknown> | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 1 && typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0])) {
    return args[0] as Record<string, unknown>;
  }
  return { args }; // multiple / mixed / primitive → wrap under one key so the message stays the headline
}

export class ConsoleLogger implements Logger {
  // Inject the pino instance so tests can spy on it offline (see Validation Architecture).
  constructor(private readonly p: pino.Logger) {}

  private emit(level: LevelMethod, message: string, args: unknown[]): void {
    const obj = foldArgs(args);
    if (obj === undefined) this.p[level](message);
    else this.p[level](obj, message);
  }

  debug(message: string, ...args: unknown[]): void { this.emit("debug", message, args); }
  info(message: string, ...args: unknown[]): void  { this.emit("info", message, args); }
  warn(message: string, ...args: unknown[]): void  { this.emit("warn", message, args); }
  error(message: string, ...args: unknown[]): void { this.emit("error", message, args); }
}

/** Factory used by index.ts (the composition root). level comes from D-10 resolution. */
export function createConsoleLogger(level: string): ConsoleLogger {
  const stream = pinoPretty({
    colorize: true,
    translateTime: "SYS:HH:MM:ss",
    ignore: "pid,hostname",
    sync: true,            // ← synchronous: no worker thread, deterministic flush on exit
  });
  return new ConsoleLogger(pino({ level }, stream));
}
```
> Note on imports under `verbatimModuleSyntax: true` (the project's tsconfig): `import pino from "pino"` and `import pinoPretty from "pino-pretty"` are value imports (correct). `import type { Logger }` stays type-only. The `pino.Logger` type annotation in the constructor is a type position and is erased — fine under `verbatimModuleSyntax`.

### Pattern 2: Message-first → object-first fold (D-02)
**What:** The `Logger` interface is `method(message, ...args)`; pino wants `method(mergeObj, message)`. The `foldArgs` helper above bridges this.
**Verified rendering** (each case executed; output confirmed readable):
| Runner call | Folded pino call | Renders as |
|-------------|------------------|------------|
| `logger.info("game started", { gameId, lives })` | `p.info({ gameId, lives }, "game started")` | `INFO: game started` + `gameId/lives` fields below — **this is the runner's actual idiom** |
| `logger.warn("no eligible ad")` (zero args) | `p.warn("no eligible ad")` | `WARN: no eligible ad` |
| `logger.warn("skipped ad", { adId }, "extra", 42)` | `p.warn({ args: [...] }, "skipped ad")` | message headline + an `args` array below (rare; only if a call passes mixed args) |
| `logger.debug("solved ad", { adId, lives, score })` | `p.debug({ adId, lives, score }, "solved ad")` | DEBUG headline + fields |

The runner's existing four call sites all pass either zero args or exactly one object arg, so they all hit the two clean branches. The mixed-arg branch is a defensive fallback, not a path the current runner exercises.

### Pattern 3: Verbosity resolution with `node:util parseArgs` (D-10)
**What:** Resolve level with precedence **flag > `LOG_LEVEL` env > `'info'`**.
**Verified config** (ran under Node v24.12.0 with `--verbose --log-level warn` → `{ verbose: true, "log-level": "warn" }`):
```typescript
// index.ts
import { parseArgs } from "node:util";

const PINO_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);

export function resolveLogLevel(argv: string[], env: NodeJS.ProcessEnv): string {
  const { values } = parseArgs({
    args: argv,
    options: {
      verbose:     { type: "boolean", short: "v" },
      "log-level": { type: "string" },
      help:        { type: "boolean", short: "h" },
    },
    allowPositionals: false, // D-11: no positional args
    strict: true,            // unknown flags throw a clear error (caught by index.ts's catch → exit 2, or handled before run)
  });

  if (values.help) { printHelpAndExit(); }            // optional companion (D-10)

  // Precedence: explicit flag wins, then env, then default.
  if (values["log-level"] && PINO_LEVELS.has(values["log-level"])) return values["log-level"];
  if (values.verbose) return "debug";                 // --verbose / -v → debug
  const envLevel = env.LOG_LEVEL?.toLowerCase();
  if (envLevel && PINO_LEVELS.has(envLevel)) return envLevel;
  return "info";                                      // default
}
// Call as: resolveLogLevel(process.argv.slice(2), process.env)
```
> Precedence subtlety: `--log-level <lvl>` is the most explicit flag and should win over `--verbose` when both are given (the snippet checks `log-level` first). If the planner prefers `--verbose` to win, swap the two `if` blocks — D-10 only mandates *flag > env > default*, not the ordering between the two flags. Document whichever is chosen with a one-line comment.

### Pattern 4: Final-score banner to stdout, bypassing pino (D-07)
**What:** Print a bordered banner with `process.stdout.write` (or `console.log`) so it is visible at any log level and never filtered by pino.
**Verified ordering:** With the **synchronous** stream, a `process.stdout.write` banner emitted after the pino lines appears *after* them in output (no interleaving). This is a direct consequence of choosing the sync stream — there is no async worker race to lose to.
```typescript
// index.ts — exact art is Claude's discretion; this shape verified to render after pino lines
function printBanner(report: GameReport): void {
  const lines = [
    `FINAL SCORE: ${report.score}`,
    `turns played: ${report.turns}`,
    `end reason:   ${report.reason}`,
  ];
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  const bar = "─".repeat(width);
  process.stdout.write(`\n┌${bar}┐\n`);
  for (const l of lines) process.stdout.write(`│ ${l.padEnd(width - 1)}│\n`);
  process.stdout.write(`└${bar}┘\n`);
}
```

### Pattern 5: Exit-code wiring + error catch (D-08/D-09)
**What:** Map `GameReport.reason` → 0/1 (pure function), thrown typed error → 2. Set `process.exitCode` and let `main` return; do **not** call `process.exit()`.
**Critical finding — `END` is NOT exported from `runner.ts`:** `const END = {...}` is module-private (`runner.ts:42`), and `GameReport.reason: string` is a plain string (`types.ts:104`). So `index.ts` cannot import `END` by reference. Two clean options:
  - **(a) Match on the `GAME_OVER` string** (re-declare the one constant `index.ts` needs). Simple, but couples `index.ts` to the exact string `"game over: lives reached 0"`.
  - **(b) Export `END` (or a `reasonToExitCode` map) from `runner.ts`** as a small one-line change, and import it in `index.ts`. This keeps the mapping DRY and greppable, and is the cleaner choice — but it is a (tiny) edit to a file CONTEXT.md flags as "only ADD `logger.*` calls." **Planner decision (see Open Questions Q1):** exporting `END` does not change loop mechanics/signature/taxonomy, so it stays within the "no mechanics change" spirit; recommend (b) for DRY-ness, but (a) is acceptable if the planner wants `runner.ts` byte-identical except for narration.

**Verified mapping + drain** (ran under tsx; `NO_PROGRESS` → exit code 1, banner drained):
```typescript
// index.ts
import { HttpApiClient, BoundaryError, TransportError } from "./api.js";
import { playGame } from "./runner.js";
import { createConsoleLogger } from "./logger.js";
import type { GameReport } from "./types.js";

// Option (a): the one reason string index.ts must recognize for exit 0.
const GAME_OVER_REASON = "game over: lives reached 0";

/** Pure, offline-testable. 0 = natural game-over, 1 = guard stop. (2 is the catch path, below.) */
export function exitCodeForReason(reason: string): 0 | 1 {
  return reason === GAME_OVER_REASON ? 0 : 1; // TURN_CAP / NO_PROGRESS → 1
}

async function main(): Promise<void> {
  const level = resolveLogLevel(process.argv.slice(2), process.env);
  const logger = createConsoleLogger(level);
  const api = new HttpApiClient(); // base URL resolved inside api.ts (non-www default, MUGLOAR_BASE_URL)

  try {
    const report: GameReport = await playGame(api, logger);
    printBanner(report);                              // D-07: always-visible
    process.exitCode = exitCodeForReason(report.reason); // D-08: 0 or 1
  } catch (err) {
    // D-09: index.ts is the authoritative catch. Typed Transport/BoundaryError → 2.
    logger.error("game crashed", { error: err instanceof Error ? err.message : String(err) });
    process.stdout.write(`\n✗ Run failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;                             // D-08: crashed-out
  }
  // No process.exit(): returning lets Node drain the synchronous pretty stream + stdout fully.
}

void main();
```
> `instanceof TransportError`/`BoundaryError` can refine the failure message if desired, but D-08 maps *any* thrown error to 2, so a plain catch suffices. Importing the classes is only needed if the planner wants class-specific wording.

> **Why `process.exitCode` not `process.exit()`:** `process.exit()` can truncate buffered output if any async stream hasn't drained. Setting `process.exitCode` and returning lets the event loop empty naturally — verified to flush every pino line + the banner. The sync pretty-stream makes this doubly safe (writes are synchronous), but the `process.exitCode` discipline is the belt-and-suspenders that the planner should make a hard rule in the task.

### Recommended Project Structure (unchanged — Phase 4 fills the last two files)
```
src/
├── types.ts          # Logger + GameReport already defined (LOCKED)
├── api.ts            # HttpApiClient + Transport/BoundaryError (LOCKED)
├── strategy.ts       # pure decisions (LOCKED)
├── runner.ts         # playGame — Phase 4 ADDS logger.* narration only (+ maybe export END)
├── logger.ts         # NEW: ConsoleLogger (pino + pino-pretty)  ← this phase
├── index.ts          # NEW: composition root (CLI)              ← this phase
└── logger.test.ts    # NEW: offline spy test (colocated, per existing convention)
```
> **Convention note:** tests are **colocated in `src/`** (`api.test.ts`, `runner.test.ts`, etc.), NOT in a `tests/` folder. `tsconfig.json` includes `"**/*.test.ts"` and `package.json` runs `vitest run`. New logger coverage goes in `src/logger.test.ts`. `[VERIFIED: ls src/]`

### Anti-Patterns to Avoid
- **Worker-thread transport for a short-lived CLI:** `pino({ transport: { target: "pino-pretty", options: {...} } })` spins a worker thread; its flush is async and can drop the tail on immediate exit. Use the sync stream form instead. (See State of the Art + Pitfall 1.)
- **Calling `process.exit()` with a non-drained stream:** can truncate the banner/last log lines. Use `process.exitCode` + return.
- **Re-implementing levels by hand / a second console wrapper:** D-01 locks pino; don't reinvent.
- **Logging raw arrays/objects above DEBUG** (PITFALLS UX table, D-05): keep INFO scannable.
- **Runner importing pino/console directly** (D-04): runner uses only the `Logger` interface.
- **Asserting on rendered log strings in tests** (PITFALLS TDD table): assert on the pino call shape via spy, not on pretty output.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Leveled colorized output | Custom ANSI/console level wrapper | `pino` + `pino-pretty` (D-01) | Already chosen, already installed; levels/coloring/field rendering for free |
| Synchronous flush-on-exit | Manual `drain`/`Promise` plumbing | `pinoPretty({ sync: true })` + `process.exitCode` | Sync stream + natural exit drains deterministically (verified) |
| CLI flag parsing | Hand-rolled `process.argv` loop | `node:util parseArgs` (D-10) | Stdlib, strict mode, short aliases, clear errors; verified on Node 24 |
| Arg→merge-object adaptation | Stringly-concatenating args into the message | `foldArgs` (one small pure fn) | Keeps fields structured + message readable; testable |

**Key insight:** Every "hard" mechanic in this phase is solved by a stdlib feature or an already-installed library used in its documented form. The only judgment call is *sync vs worker* — and that was settled empirically in favor of sync.

## Common Pitfalls

### Pitfall 1: pino-pretty worker transport drops the last lines on `process.exit()`
**What goes wrong:** With `transport: { target: "pino-pretty" }`, pino routes logs through a worker thread over a message port. A short-lived CLI that exits right after the final log can terminate before the worker flushes, silently dropping the tail (often the most important lines — the game-over/summary).
**Why it happens:** The worker boundary is asynchronous; `process.exit()` doesn't wait for it.
**How to avoid:** Use the **synchronous stream** form `pino(opts, pinoPretty({ sync: true }))`, and set `process.exitCode` + return instead of `process.exit()`.
**Warning signs:** "Works in dev, missing the last line in a piped run / CI"; output truncated mid-line.
**Evidence note:** On this exact combo (pino 10.3.1 / pino-pretty 13.1.3 / Node v24.12.0) the worker form flushed reliably in 8/8 probe runs — so this is a **known risk class, not a reproduced failure here**. The sync form is recommended because it removes the risk by construction at zero cost, not because the worker form was observed to fail. `[VERIFIED: probe runs]`

### Pitfall 2: `END` reason strings are private to `runner.ts`
**What goes wrong:** `index.ts` tries to `import { END }` to map reasons and finds it isn't exported; or it hardcodes a reason string that drifts from the runner's.
**Why it happens:** `END` is a module-private `const` (`runner.ts:42`); `GameReport.reason` is a plain `string`.
**How to avoid:** Either export `END`/a `reasonToExitCode` map from `runner.ts` (preferred, DRY) or re-declare only the `GAME_OVER` string in `index.ts` and match on it. Either way, add a test that exercises all three reasons → expected codes so a future string change is caught. `[VERIFIED: grep runner.ts / types.ts]`

### Pitfall 3: `verbatimModuleSyntax` + CJS-default imports
**What goes wrong:** Under the project's `verbatimModuleSyntax: true`, mixing type and value imports incorrectly errors; importing a CJS default the wrong way fails.
**Why it happens:** pino/pino-pretty are `type: commonjs`; their default exports are the callable factories.
**How to avoid:** `import pino from "pino"` and `import pinoPretty from "pino-pretty"` are correct value imports (verified to run under tsx and intended to typecheck with esModuleInterop, which `@tsconfig/node24` provides). Keep `import type { Logger }` type-only. `[VERIFIED: executed under tsx]` — planner should still confirm `tsc --noEmit` stays green as a task step.

### Pitfall 4: INFO becomes a wall of text (D-06 violation)
**What goes wrong:** Promoting the play-by-play (candidate ads + EV ranking, shop catalog) to INFO buries the one-line-per-decision narrative.
**How to avoid:** Keep candidate/ranking/catalog/fetch-boundary lines at DEBUG; INFO gets exactly: start line, chosen-ad + solve outcome (with lives/gold/score deltas), each shop buy, and the stop line. WARN for skips. This is the D-05/D-06 taxonomy applied to the `runner.ts` narration enrichment.

## Code Examples

All examples above (`createConsoleLogger`, `foldArgs`, `resolveLogLevel`, `printBanner`, `exitCodeForReason`, `main`) were executed against the project's installed `pino@10.3.1` / `pino-pretty@13.1.3` on Node v24.12.0 via `tsx` and produced the rendering / exit-code / flush behavior described. They are copy-pasteable shapes, not full files — the planner/executor adapts naming and the banner art (Claude's discretion).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `transport: { target: "pino-pretty" }` (worker thread) — the form most pino docs/tutorials show first | `pino(opts, pinoPretty({ sync: true }))` (synchronous stream) for short-lived CLIs | pino-pretty has supported the stream/`sync` form throughout v13 | Deterministic flush on exit; no worker race; simpler for a one-shot CLI |
| `process.exit(code)` to end a CLI | `process.exitCode = code` + natural return | Long-standing Node best practice | Avoids truncating buffered stdout/log output |

**Deprecated/outdated:** Nothing in scope is deprecated. Note pino-pretty's docs warn it is "not recommended for production *at scale*" — irrelevant here: this is a single short-lived demo run where pretty output IS the interface (D-03).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | esModuleInterop is on (via `@tsconfig/node24`) so `import pino from "pino"` typechecks, not just runs under tsx | Pitfall 3 | If off, default imports error in `tsc --noEmit`; fix is `import * as pino` or enabling interop. Low risk — base config provides it; planner verifies with `tsc --noEmit`. |
| A2 | pino-pretty's `sync: true` is honored as documented (synchronous writes) on this version | Pattern 1 | If async, the flush guarantee weakens — but `process.exitCode`+return is a second safeguard. Low risk — `sync` is a documented option and the immediate-exit probe lost zero lines. |

**All other claims in this research were verified by executing code against the installed versions or by reading the installed source/types — see the `[VERIFIED: …]` tags inline.**

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 `[VERIFIED: package.json + ran vitest]` |
| Config file | none — zero-config; `package.json` `"test": "vitest run"`, `"test:watch": "vitest"` |
| Quick run command | `npx vitest run src/logger.test.ts` |
| Full suite command | `npm test` (`vitest run`) |
| Test location | **colocated in `src/`** (e.g. `src/logger.test.ts`), NOT a `tests/` dir `[VERIFIED: ls src/]` |

### What is offline-unit-testable (the automated suite — MUST stay zero live network, TEST-01/D-12)
| Behavior | Test type | How | Automated command |
|----------|-----------|-----|-------------------|
| Logger level → pino method routing | unit | `vi.spyOn(pinoInstance, "info"/"warn"/"debug"/"error")` over an **injected** pino; assert which method fired | `npx vitest run src/logger.test.ts` |
| Logger call shape (D-02 fold) | unit | assert `info` called with `({ gameId, lives }, "game started")`; with `("msg")` when no args | same |
| Verbosity precedence (D-10) | unit | call `resolveLogLevel(argv, env)` with permutations; assert flag > env > `'info'` and `--verbose`→`'debug'` | `npx vitest run src/index.test.ts` (or wherever `resolveLogLevel` is exported) |
| Exit-code mapping (D-08) | unit | `exitCodeForReason(reason)` pure fn → assert GAME_OVER→0, TURN_CAP→1, NO_PROGRESS→1 | same |
| (optional) banner content | unit | call `printBanner` with a captured `process.stdout.write` spy; assert score/turns/reason present | same |

**Verified offline test seam** (ran under Vitest 4.1.8, 3 tests, 3ms, no network):
```typescript
// src/logger.test.ts
import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { ConsoleLogger } from "./logger.js";

function spyPino() {
  const p = pino({ level: "debug", enabled: false }); // silent: no stream, no pretty, no output
  return { p, info: vi.spyOn(p, "info"), warn: vi.spyOn(p, "warn"),
           debug: vi.spyOn(p, "debug"), error: vi.spyOn(p, "error") };
}

describe("ConsoleLogger", () => {
  it("routes info() to pino.info with (mergeObj, message)", () => {
    const s = spyPino();
    new ConsoleLogger(s.p).info("game started", { gameId: "g1", lives: 3 });
    expect(s.info).toHaveBeenCalledWith({ gameId: "g1", lives: 3 }, "game started");
  });
  it("passes message only when no args", () => {
    const s = spyPino();
    new ConsoleLogger(s.p).warn("no eligible ad");
    expect(s.warn).toHaveBeenCalledWith("no eligible ad");
  });
});
```
> **Design implication for testability:** `ConsoleLogger`'s constructor should accept the **pino instance** (injected), with a separate `createConsoleLogger(level)` factory that builds the real `pino(opts, prettyStream)` for production. This keeps the unit test free of pretty-stream/output-capture headaches and keeps `index.ts` as the place the real stream is wired. Mirrors the project's existing `ApiClient` injection discipline.

### What is ONLY provable by the manual live smoke (D-12) — NOT in the automated suite
- A full real game completes end-to-end, narrates decisions at INFO, prints the banner, exits 0/1.
- `npm start` (default `info`, scannable one-line-per-decision) and `LOG_LEVEL=debug npm start` (full play-by-play) — the ONLY live network calls in the project.
- This is **manual** and gated on the real API being reachable (non-`www` base URL). It must not be added to `vitest`.

### Sampling Rate
- **Per task commit:** `npx vitest run src/logger.test.ts` (or the new test file touched)
- **Per wave merge:** `npm test` (full suite) + `npm run typecheck` (`tsc --noEmit`) + `npm run lint` (`biome check --write .`)
- **Phase gate:** Full suite green + `tsc --noEmit` clean + one successful manual `npm start` live smoke (D-12) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/logger.test.ts` — covers LOG-01 logger routing + D-02 call shape (new file)
- [ ] Decide where `resolveLogLevel` / `exitCodeForReason` are exported so they're unit-testable (e.g. export from `index.ts`, or a tiny `cli.ts` helper — but the six-file ceiling means **export from `index.ts`** and test it, rather than adding a 7th file). Add `src/index.test.ts` (or fold into `logger.test.ts`) for these two pure functions.
- [ ] No framework install needed — Vitest already present.

*(No conftest/fixture file needed — Vitest is zero-config and fixtures here are trivial inline objects.)*

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥ 24 | runtime, `parseArgs`, native fetch | ✓ | v24.12.0 `[VERIFIED]` | — |
| pino | logger.ts | ✓ | 10.3.1 `[VERIFIED]` | — |
| pino-pretty | logger.ts | ✓ | 13.1.3 `[VERIFIED]` | — |
| tsx | `npm start` / `npm run dev` | ✓ | 4.22.x (in devDeps) | — |
| Vitest | offline tests | ✓ | 4.1.8 `[VERIFIED]` | — |
| Live Mugloar API (non-`www`) | manual smoke (D-12) ONLY | unverified from this env (sandbox returned nginx 404s historically — STATE.md blocker) | — | The smoke run is manual and run by the user on a network-capable machine; automated suite needs nothing live |

**Missing dependencies with no fallback:** None for the automated work.
**Missing dependencies with fallback:** The live API is only needed for the manual smoke (D-12), executed outside the test suite. Base URL defaults to non-`www` `https://dragonsofmugloar.com/api/v2` and is overridable via `MUGLOAR_BASE_URL` (read in `api.ts`). The smoke is the user's manual step.

## Open Questions / What the planner should decide

1. **Export `END` (or a `reasonToExitCode` map) from `runner.ts`, or match the `GAME_OVER` string in `index.ts`?** (Pitfall 2 / Pattern 5.) Recommended: export `END` for DRY mapping — it does not change loop mechanics/signature/taxonomy, so it respects the "only ADD narration" spirit. Acceptable alternative: re-declare the single `GAME_OVER` string in `index.ts`. Either way, add the three-reason→code test.
2. **When both `--log-level` and `--verbose` are given, which wins?** D-10 only mandates flag > env > default. Recommended: `--log-level <lvl>` (more explicit) wins over `--verbose`. Planner picks one and comments it.
3. **Shebang / `bin` entry on `index.ts`?** Claude's discretion (D-10/SUMMARY.md). Harmless; optional. Recommend skipping for v1 (run via `npm start`) unless the planner wants `npx`-style invocation.
4. **Where do `resolveLogLevel` / `exitCodeForReason` live so they're testable without a 7th file?** Recommended: export them from `index.ts` and test via `src/index.test.ts`, keeping the six-source-file ceiling.

## Sources

### Primary (HIGH confidence — executed/inspected this session)
- `node_modules/pino/package.json`, `node_modules/pino/pino.d.ts` — version 10.3.1, `pino(options, stream)` overload, `destination`, `type: commonjs`
- `node_modules/pino-pretty/package.json`, `index.js`, `index.d.ts` — version 13.1.3, callable default factory `PinoPretty(options?) => PrettyStream`, `PrettyOptions` (`sync`, `destination`, `colorize`, `translateTime`, `ignore`, `singleLine`, `messageFormat`)
- Live probes under `tsx`: sync-stream render + immediate-`process.exit(0)` no-drop; worker-transport flush behavior (8/8 runs); arg-fold rendering across 4 arg shapes; `parseArgs` config on Node v24.12.0; exit-code mapping + sync-stream drain on natural return
- Vitest 4.1.8 spy test (`vi.spyOn` over injected pino) — 3 tests green, offline, 3ms
- `src/runner.ts` (`END` private, three reason strings, existing `logger.*` call sites), `src/types.ts` (`Logger`, `GameReport.reason: string`), `src/api.ts` (`HttpApiClient`, `TransportError`, `BoundaryError`), `package.json`, `tsconfig.json`, `ls src/`

### Secondary (project research docs — already verified by prior phases)
- `.planning/phases/04-logger-cli-live-smoke/04-CONTEXT.md` (D-01..D-12, locked carry-forwards)
- `.planning/research/STACK.md`, `PITFALLS.md` (logging UX taxonomy), `SUMMARY.md` (Phase 4), `ARCHITECTURE.md` (six-file layout, dependency direction)
- `.planning/REQUIREMENTS.md` (LOG-01, LOG-02, TEST-01), `.planning/STATE.md` (non-`www` base-URL blocker)

## Metadata

**Confidence breakdown:**
- Sync pretty-stream wiring (Focus #1): HIGH — executed against installed versions; render + flush confirmed
- Arg fold / call shape (Focus #2): HIGH — all four arg shapes rendered + spy-asserted
- parseArgs verbosity (Focus #3): HIGH — config ran on Node v24.12.0
- Banner to stdout (Focus #4): HIGH — ordering with sync stream confirmed
- Exit-code wiring (Focus #5): HIGH — mapping + drain confirmed; `END`-not-exported caveat surfaced
- Validation architecture (Focus #6): HIGH — offline spy test runs green; live smoke correctly isolated as manual

**Research date:** 2026-06-10
**Valid until:** ~2026-07-10 (stable; pino/pino-pretty/Node 24 are settled. Re-verify only if pino major bumps to 11+ or pino-pretty to 14+.)
