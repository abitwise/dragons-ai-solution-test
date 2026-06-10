# Phase 4: Logger, CLI & Live Smoke - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 5 (2 new source, 1 modified source, 2 new test)
**Analogs found:** 5 / 5 (every new/modified file has a strong in-repo analog)

> All five new/modified files have close analogs already in `src/`. The codebase
> is six flat files, ESM, manual DI (one constructor/function arg), with a
> consistent house style the planner/executor MUST mirror. Prefer these concrete
> analogs over the RESEARCH.md generic shapes where they differ — RESEARCH gives
> the verified pino/parseArgs mechanics; the analogs give the house style.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/logger.ts` (NEW) | provider/adapter (imperative shell) | transform (message-first → pino object-first) | `src/api.ts` (class implementing an interface, constructor injection, the-only-module-touching-X) | role-match (both are the sole adapter to an external lib behind an interface) |
| `src/index.ts` (NEW) | composition root / CLI entrypoint | request-response (orchestrate: construct deps → `await playGame` → print → exit) | `src/runner.ts` (the existing imperative-shell orchestrator) + `src/api.ts` (error-class usage, env reads) | role-match (no entrypoint exists yet; runner is the closest orchestration analog) |
| `src/runner.ts` (MODIFY) | service (imperative shell, LOCKED loop) | event-driven narration via `Logger` interface | `src/runner.ts` itself (the 4 existing `logger.*` call sites at lines 123/143/152/158) | exact (enriching the file's own existing pattern) |
| `src/logger.test.ts` (NEW) | test | unit (spy over injected pino, offline) | `src/api.test.ts` (`vi.spyOn` over a global/instance, offline seam) + `src/runner.test.ts` (silent `Logger`, fixtures) | exact (same Vitest + spy convention) |
| `src/index.test.ts` (NEW) | test | unit (pure-function permutations: `resolveLogLevel`, `exitCodeForReason`) | `src/runner.test.ts` (describe blocks, `REASON` constant mirroring private `END`, permutation cases) | exact (same convention; mirrors the three END strings) |

---

## Shared Patterns (cross-cutting — apply to ALL files this phase)

These are house conventions verified across every existing `src/` file. Every new/modified file MUST honor them.

### House file header
**Source:** every file — e.g. `src/api.ts:1-26`, `src/runner.ts:1-24`, `src/types.ts:1-10`, `src/fake-api-client.ts:1-25`
**Apply to:** `logger.ts`, `index.ts` (and the test files, more briefly — see `src/runner.test.ts:7-17`)

Every source file opens with a block-comment JSDoc header naming the module, its single responsibility, and its boundaries (what it does NOT do / NOT import). Example shape from `src/runner.ts:1-24`:
```typescript
/**
 * `runner.ts` — the imperative shell (LOOP-01, LOOP-03).
 *
 * This is the ONLY module that sequences I/O ...
 *
 * Boundaries — what this module does NOT do:
 *   - It imports ONLY the `ApiClient`/`Logger` interfaces ... It NEVER imports
 *     `fetch`, `zod`, `pino`, `console`, `HttpApiClient`, or `FakeApiClient` ...
 */
```
For `logger.ts`: state "the ONLY module that imports `pino`/`pino-pretty`". For `index.ts`: state "the ONLY composition root — the only place `HttpApiClient` + `ConsoleLogger` are constructed".

### ESM + `verbatimModuleSyntax` import discipline
**Source:** `src/api.ts:28-30`, `src/runner.ts:26-27`, `src/types.ts` (all imports), `tsconfig.json:6` (`verbatimModuleSyntax: true`)
**Apply to:** all five files

- Relative imports carry the **`.js`** extension (NodeNext): `import { playGame } from "./runner.js"`, `import type { Logger } from "./types.js"`.
- **Type-only** imports use `import type` (erased): `src/api.ts:30` →
  ```typescript
  import type { Ad, ApiClient, BuyResult, GameState, ShopItem, SolveResult } from "./types.js";
  ```
- **Value** imports are plain (`pino`, `pino-pretty`, `node:util` are values): `import pino from "pino"`, `import pinoPretty from "pino-pretty"`, `import { parseArgs } from "node:util"`.
- A type used only in an annotation position (e.g. `pino.Logger` in the constructor) is fine even from a value import — it is erased. Run `npm run typecheck` (`tsc --noEmit`) as a hard task gate (RESEARCH Pitfall 3 / Assumption A1).

### Manual DI — inject the dependency, add a factory for production
**Source:** `src/api.ts:155-182` (`HttpApiClientOptions` + constructor with `??` defaults; injectable `delay`), `src/fake-api-client.ts:62` (`constructor(private readonly script ...)`)
**Apply to:** `logger.ts` (inject the pino instance; `createConsoleLogger(level)` factory builds the real stream), `index.ts` (constructs the real pair — the only place that does)

The codebase's DI idiom is exactly "pass one argument to a constructor" — never a container. `ConsoleLogger`'s constructor takes the **pino instance** so tests spy on it offline; a separate `createConsoleLogger(level)` factory wires the real `pino(opts, prettyStream)` (mirrors `HttpApiClient` taking injectable `delay`, defaulting to `realDelay`). See `src/api.ts:166-182`:
```typescript
/** The real sleep used in production; tests inject a no-op. */
function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(options: HttpApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.MUGLOAR_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.delay = options.delay ?? realDelay;
  }
}
```

### `const` object for closed vocabularies — NEVER a TS `enum`
**Source:** `src/runner.ts:42-46` (the `END` object), confirmed `CLAUDE.md` (no enum/namespace/decorators)
**Apply to:** `index.ts` (`PINO_LEVELS` set, any `GAME_OVER_REASON`/reason map), `logger.ts` (the `LevelMethod` union)
```typescript
const END = {
  GAME_OVER: "game over: lives reached 0",
  TURN_CAP: "stopped: max-turn cap reached",
  NO_PROGRESS: "stopped: no-progress guard tripped",
} as const;
```
Use `as const` objects / string-literal unions (`type LevelMethod = "debug" | "info" | "warn" | "error"`), never `enum`.

### Named module-level constants with explanatory comments
**Source:** `src/api.ts:32-42` (`DEFAULT_BASE_URL`, `MAX_READ_ATTEMPTS`, `BACKOFF_MS`, `REQUEST_TIMEOUT_MS`), `src/runner.ts:29-33`
**Apply to:** `index.ts` (`PINO_LEVELS`, `GAME_OVER_REASON`, exit-code comments), `logger.ts` (pretty-options object)
Magic values are hoisted to a named `const` with a one-line comment explaining WHY. Exit codes especially get a self-documenting comment (`0`=natural game-over, `1`=guard stop, `2`=crashed — D-08 / specifics).

### Formatting (Biome — `biome.json`)
**Source:** `biome.json`
**Apply to:** all five files
Double quotes, semicolons always, 2-space indent, line width **100**, organize-imports on. Run `npm run lint` (`biome check --write .`) as a task gate.

---

## Pattern Assignments

### `src/logger.ts` (NEW — provider/adapter, transform)

**Primary analog:** `src/api.ts` (the existing "sole module touching an external lib, behind an interface, via constructor injection" pattern).
**Mechanics reference:** RESEARCH.md Pattern 1/2 (verified pino sync-stream + `foldArgs`).

**Imports pattern** — mirror `src/api.ts:28-30` discipline; pino/pino-pretty are VALUE imports, `Logger` is type-only:
```typescript
import pino from "pino";
import pinoPretty from "pino-pretty";
import type { Logger } from "./types.js";
```

**Class-implements-interface + constructor injection** (mirror `src/api.ts:171-182`, `HttpApiClient implements ApiClient`):
```typescript
export class ConsoleLogger implements Logger {
  // Inject the pino instance so logger.test.ts can spy offline (mirrors api.ts injectable delay).
  constructor(private readonly p: pino.Logger) {}
  // ...
}
```
The interface to implement is `src/types.ts:131-136`:
```typescript
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
```

**Core transform pattern (D-02 fold)** — message-first variadic → pino's object-first idiom. The runner's actual call sites (`src/runner.ts:123,143,152,158`) pass either zero args or exactly one object arg, so the two clean branches cover every real call; the multi/mixed branch is a defensive fallback (RESEARCH Pattern 2). Verified shape:
```typescript
type LevelMethod = "debug" | "info" | "warn" | "error";

function foldArgs(args: unknown[]): Record<string, unknown> | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 1 && typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0])) {
    return args[0] as Record<string, unknown>;
  }
  return { args }; // multiple/mixed/primitive → wrap so the message stays the headline
}
// emit(): const obj = foldArgs(args); obj === undefined ? this.p[level](message) : this.p[level](obj, message);
```

**Production factory** (mirror `realDelay`/options pattern in `src/api.ts:166-182`) — the ONLY place the real pretty stream is built; use the **synchronous** stream (RESEARCH Pattern 1 / Pitfall 1, NOT the worker-thread `transport:` form):
```typescript
export function createConsoleLogger(level: string): ConsoleLogger {
  const stream = pinoPretty({
    colorize: true,
    translateTime: "SYS:HH:MM:ss",
    ignore: "pid,hostname",
    sync: true, // synchronous: no worker thread, deterministic flush on exit
  });
  return new ConsoleLogger(pino({ level }, stream));
}
```

**Error handling:** none needed inside `logger.ts` — it does no I/O that throws (unlike `api.ts`). Do NOT add try/catch here; logging is fire-and-forget.

---

### `src/index.ts` (NEW — composition root / CLI, request-response)

**Primary analog:** `src/runner.ts` (the imperative-shell orchestrator: construct/sequence, await, return a report) + `src/api.ts` (typed-error classes + `process.env` reads).
**Mechanics reference:** RESEARCH.md Patterns 3/4/5 (verified `parseArgs`, banner, exit-code wiring).

**Imports pattern** — value imports of the two error classes + the entrypoints, `.js` extensions, type-only for `GameReport` (mirror `src/runner.ts:26-27`):
```typescript
import { parseArgs } from "node:util";
import { BoundaryError, HttpApiClient, TransportError } from "./api.js";
import { createConsoleLogger } from "./logger.js";
import { playGame } from "./runner.js";
import type { GameReport } from "./types.js";
```
> The error classes come from `src/api.ts:52-77` (`TransportError`, `BoundaryError`). Import them only if `index.ts` wants class-specific failure wording; D-08 maps ANY thrown error → 2, so a plain catch also suffices (RESEARCH Pattern 5).

**Verbosity resolution (D-10)** — pure, exported, offline-testable. Precedence flag > `LOG_LEVEL` env > `"info"`. `PINO_LEVELS` is a `const` set (house style). Verified config (RESEARCH Pattern 3):
```typescript
const PINO_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);

export function resolveLogLevel(argv: string[], env: NodeJS.ProcessEnv): string {
  const { values } = parseArgs({
    args: argv,
    options: {
      verbose: { type: "boolean", short: "v" },
      "log-level": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false, // D-11: no positional args
    strict: true,
  });
  if (values["log-level"] && PINO_LEVELS.has(values["log-level"])) return values["log-level"];
  if (values.verbose) return "debug"; // --verbose / -v → debug
  const envLevel = env.LOG_LEVEL?.toLowerCase();
  if (envLevel && PINO_LEVELS.has(envLevel)) return envLevel;
  return "info";
}
// call: resolveLogLevel(process.argv.slice(2), process.env)
```

**Exit-code mapping (D-08)** — pure, exported. **Critical (RESEARCH Pitfall 2 / Open Q1):** `END` is module-PRIVATE in `runner.ts:42` and `GameReport.reason` is a plain `string` (`types.ts:104`), so `index.ts` CANNOT `import { END }`. Two options:
- **(a)** re-declare the one `GAME_OVER` string as a `const` in `index.ts` and match it (byte-identical `runner.ts` except narration).
- **(b) PREFERRED:** export `END` (or a `reasonToExitCode` map) from `runner.ts` — a tiny additive change that does NOT touch loop mechanics/signature/taxonomy, keeping the mapping DRY/greppable. The planner picks; either way add the three-reason→code test.
```typescript
const GAME_OVER_REASON = "game over: lives reached 0"; // option (a); or import END.GAME_OVER under (b)

/** Pure, offline-testable. 0 = natural game-over, 1 = guard stop (TURN_CAP/NO_PROGRESS). 2 is the catch path. */
export function exitCodeForReason(reason: string): 0 | 1 {
  return reason === GAME_OVER_REASON ? 0 : 1;
}
```

**Final-score banner (D-07)** — `process.stdout.write` (bypasses pino, visible at any level). Exact art is discretion; verified shape (RESEARCH Pattern 4) consumes `GameReport` (`types.ts:101-105`):
```typescript
function printBanner(report: GameReport): void {
  const lines = [`FINAL SCORE: ${report.score}`, `turns played: ${report.turns}`, `end reason:   ${report.reason}`];
  // ... border with process.stdout.write(...) ...
}
```

**Orchestration + single error catch (D-09)** — the composition root mirrors `runner.ts`'s "construct deps → await → return report" shape, but adds the ONE try/catch (which `runner.ts:121-160` deliberately omits). Set `process.exitCode` and RETURN — do NOT call `process.exit()` (RESEARCH Pattern 5 / Anti-Patterns; sync stream + natural exit drains cleanly):
```typescript
async function main(): Promise<void> {
  const level = resolveLogLevel(process.argv.slice(2), process.env);
  const logger = createConsoleLogger(level);
  const api = new HttpApiClient(); // base URL resolved inside api.ts (non-www default, MUGLOAR_BASE_URL)
  try {
    const report: GameReport = await playGame(api, logger);
    printBanner(report);
    process.exitCode = exitCodeForReason(report.reason); // 0 or 1
  } catch (err) {
    logger.error("game crashed", { error: err instanceof Error ? err.message : String(err) });
    process.stdout.write(`\n✗ Run failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2; // crashed-out (any thrown Transport/BoundaryError)
  }
  // No process.exit(): returning lets Node drain the synchronous pretty stream + stdout fully.
}
void main();
```
> Shebang `#!/usr/bin/env node` / `bin` entry is optional (discretion); recommend skipping for v1 (run via `npm start`).

---

### `src/runner.ts` (MODIFY — enrich narration ONLY; loop mechanics LOCKED)

**Analog:** the file's OWN existing `logger.*` call sites — the exact lines Phase 4 enriches. **Do NOT change loop mechanics, the `playGame` signature, the two guards, or the `END` vocabulary** (`src/runner.ts:42-46` / 60-64 / 121-160). ADD only `logger.*` calls; the runner keeps calling ONLY the `Logger` interface — never `console`/`pino`/`pino-pretty` (boundary stated in its header `runner.ts:11-14`).

**Existing call sites to enrich (current `logger.*` calls):**
- `runner.ts:123` — `logger.info("game started", { gameId: state.gameId, lives: state.lives })` — KEEP as INFO (start line, D-05).
- `runner.ts:143` — `logger.debug("solved ad", { adId, lives, score })` — **PROMOTE the decision/outcome to INFO** (chosen ad + solve result with lives/gold/score deltas, D-05); keep the verbose candidate/EV detail at DEBUG (D-06).
- `runner.ts:152` — `logger.info("game stopped by guard", report)` — KEEP INFO (guard stop line).
- `runner.ts:158` — `logger.info("game over", report)` — KEEP INFO (game-over line).

**Level taxonomy to apply (D-05/D-06 — apply WITHOUT touching control flow):**
- **INFO** = decisions/outcomes — chosen ad + solve result (deltas), each shop buy (`drainShop`, `runner.ts:75-92`), the start line, the guard/game-over stop line.
- **WARN** = skips / nothing-to-do — the `chooseAd` returns `null` / empty-board path (`runner.ts:139` the no-`ad` branch), skipped encrypted/unhandled ads, a `shoppingSuccess:false` buy (`runner.ts:85`).
- **ERROR** = failures — the runner MAY `logger.error` before a thrown `Transport/BoundaryError` unwinds (discretion; `index.ts` is authoritative regardless, D-09).
- **DEBUG** = verbose play-by-play — candidate ads + EV ranking, the shop catalog seen, fetch boundaries, raw API objects. **Never dump raw arrays above DEBUG** (PITFALLS / Anti-Pattern). Default `info` run stays one scannable line per decision (D-06 / RESEARCH Pitfall 4).

**Call-shape convention to mirror (do NOT reorder to pino's idiom):** message FIRST, single structured object SECOND — exactly `logger.info("game started", { gameId, lives })`. `logger.ts`'s `foldArgs` bridges this to pino; the runner's ordering stays message-first (D-02 subtlety, CONTEXT `code_context`).

---

### `src/logger.test.ts` (NEW — unit, offline spy)

**Analog:** `src/api.test.ts:19-57` (`vi.spyOn` offline seam, `beforeEach`/`afterEach` cleanup) + `src/runner.test.ts:51-56` (the silent `Logger`).
**Mechanics reference:** RESEARCH Validation Architecture (verified spy seam, 3 tests, 3ms, offline).

**Convention:** colocated `src/logger.test.ts` (NOT a `tests/` dir — `tsconfig.json:12` includes `**/*.test.ts`); Vitest imports from `vitest`; file-level JSDoc header (like `src/runner.test.ts:7-17`). Spy over an INJECTED, output-disabled pino instance — assert the CALL SHAPE, never the rendered pretty string (Anti-Pattern):
```typescript
import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { ConsoleLogger } from "./logger.js";

function spyPino() {
  const p = pino({ level: "debug", enabled: false }); // silent: no stream/pretty/output
  return { p, info: vi.spyOn(p, "info"), warn: vi.spyOn(p, "warn"), debug: vi.spyOn(p, "debug"), error: vi.spyOn(p, "error") };
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
Cover: level→method routing (debug/info/warn/error), the D-02 fold (one object → `(obj, msg)`; zero args → `(msg)`; multi/mixed → `({ args }, msg)`).

---

### `src/index.test.ts` (NEW — unit, pure functions)

**Analog:** `src/runner.test.ts:189-196` — the `REASON` constant **mirroring the private `END` strings verbatim** so a wording drift is caught, plus the permutation-style `describe`/`it` cases.
**Mechanics reference:** RESEARCH Validation Architecture + Wave 0 Gaps (export `resolveLogLevel`/`exitCodeForReason` from `index.ts` and test them — keeps the six-source-file ceiling; no 7th file).

**Convention:** colocated `src/index.test.ts`, imports from `vitest`, imports the two pure exported functions from `./index.js`. Mirror `runner.test.ts:189-196`'s "re-declare the closed vocabulary to catch drift":
```typescript
import { describe, expect, it } from "vitest";
import { exitCodeForReason, resolveLogLevel } from "./index.js";

// Mirrors the three private END strings in runner.ts (drift catcher, like runner.test.ts REASON).
const REASON = {
  GAME_OVER: "game over: lives reached 0",
  TURN_CAP: "stopped: max-turn cap reached",
  NO_PROGRESS: "stopped: no-progress guard tripped",
} as const;

describe("exitCodeForReason", () => {
  it("maps GAME_OVER → 0, guard stops → 1", () => {
    expect(exitCodeForReason(REASON.GAME_OVER)).toBe(0);
    expect(exitCodeForReason(REASON.TURN_CAP)).toBe(1);
    expect(exitCodeForReason(REASON.NO_PROGRESS)).toBe(1);
  });
});

describe("resolveLogLevel", () => {
  it("applies precedence flag > LOG_LEVEL env > 'info'", () => {
    expect(resolveLogLevel(["--verbose"], {})).toBe("debug");
    expect(resolveLogLevel([], { LOG_LEVEL: "warn" })).toBe("warn");
    expect(resolveLogLevel([], {})).toBe("info");
    expect(resolveLogLevel(["--log-level", "error"], { LOG_LEVEL: "warn" })).toBe("error");
  });
});
```
> `resolveLogLevel` takes `(argv, env)` as params (NOT reading `process.argv`/`process.env` internally) precisely so this test stays pure and offline — the same injection discipline `api.test.ts` uses for `delay`/`fetch`.

---

## Shared Patterns (specific cross-cutting concerns)

### Error classes (for `index.ts`'s catch)
**Source:** `src/api.ts:52-77` (`TransportError`, `BoundaryError` — each `extends Error`, sets `this.name`, optional `status` + `{ cause }`)
**Apply to:** `index.ts` catch block (exit 2). Note these are the ONLY two thrown types; `runner.ts` re-throws them verbatim (`runner.ts:113-115` — adds no try/catch). D-08 maps ANY thrown error → 2, so `index.ts` may catch broadly and only `instanceof`-refine for nicer wording.

### `process.env` reads happen at the edge only
**Source:** `src/api.ts:177` (`process.env.MUGLOAR_BASE_URL` read ONCE in the constructor)
**Apply to:** `index.ts` reads `process.env.LOG_LEVEL` (via the injected `env` param to `resolveLogLevel`) and lets `api.ts` keep owning `MUGLOAR_BASE_URL`. `index.ts` does NOT re-read or duplicate the base URL — it just `new HttpApiClient()` (D-11 / locked carry-forward).

### Offline test seam (`vi.spyOn`, no network, restore after)
**Source:** `src/api.test.ts:44-57` (`vi.spyOn(globalThis, "fetch")`, `afterEach(() => vi.restoreAllMocks())`)
**Apply to:** `logger.test.ts` (spy over injected pino). Suite stays 100% offline (TEST-01/D-12); the live smoke is manual (`npm start`) and never enters Vitest.

---

## No Analog Found

None. Every new/modified file maps to an existing in-repo pattern. The only genuinely-new external mechanics (pino sync-stream wiring, `parseArgs`, stdout banner) are NOT in the repo yet but are fully specified with verified copy-pasteable shapes in `04-RESEARCH.md` (Patterns 1-5) — the planner should pair the house-style analogs above with those RESEARCH mechanics.

## Metadata

**Analog search scope:** `src/` (all six source files + their colocated tests), `package.json`, `tsconfig.json`, `biome.json`
**Files scanned:** `src/api.ts`, `src/runner.ts`, `src/types.ts`, `src/fake-api-client.ts`, `src/runner.test.ts`, `src/api.test.ts` (head), `package.json`, `tsconfig.json`, `biome.json`
**Pattern extraction date:** 2026-06-10
</content>
</invoke>
