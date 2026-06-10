/**
 * `index.ts` — the CLI composition root and the ONLY place the real
 * `HttpApiClient` + `ConsoleLogger` are constructed and injected into
 * `playGame` (success criterion #3, LOG-02).
 *
 * It is the entrypoint the `npm start` live smoke runs. Its job is purely
 * composition + edge concerns that the pure core deliberately omits:
 *   - resolve the log level from flag + env (D-10), `--log-level` > `--verbose`
 *     > `LOG_LEVEL` env > the `"info"` default (Open Question Q2);
 *   - construct the real client + logger pair (the ONLY construction site) and
 *     run the game inside the single authoritative try/catch (D-09) that
 *     `runner.ts` deliberately omits;
 *   - print the always-visible FINAL SCORE banner straight to stdout (D-07,
 *     bypassing pino so it shows at any level);
 *   - map the outcome to a 3-way exit code (D-08): 0 = natural game-over,
 *     1 = guard stop, 2 = a thrown Transport/BoundaryError.
 *
 * Boundaries — what this module does NOT do:
 *   - It does NOT read or duplicate `MUGLOAR_BASE_URL` — `api.ts` owns the base
 *     URL (env reads at the edge only); `index.ts` just `new HttpApiClient()`.
 *   - It does NOT call `process.exit()` — it sets `process.exitCode` and RETURNS
 *     so Node drains the synchronous pretty stream + the stdout banner fully.
 *   - The two pure helpers (`resolveLogLevel`, `exitCodeForReason`) are exported
 *     from HERE (not a 7th source file) so they stay unit-testable offline while
 *     preserving the flat source-file shape (Open Question Q4).
 */

import { parseArgs } from "node:util";
import { BoundaryError, HttpApiClient, TransportError } from "./api.js";
import { createConsoleLogger } from "./logger.js";
import { END, playGame } from "./runner.js";
import type { GameReport } from "./types.js";

/**
 * The closed set of valid pino levels (house `const`/Set style — a string-set
 * vocabulary, never a TS keyword-vocab). An untrusted `--log-level`/`LOG_LEVEL`
 * value is validated against THIS set; an unknown value is rejected and falls
 * through to env/default, so a bogus value can never crash the logger or
 * silently disable all output (security T-04-03).
 */
const PINO_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);

/**
 * Resolve the pino log level from CLI flags + env (D-10). Takes `argv`/`env` as
 * EXPLICIT params (never reads `process.argv`/`process.env` itself) so it stays
 * pure and offline-testable.
 *
 * Precedence (Open Question Q2 — `--log-level` WINS over `--verbose` as the more
 * explicit flag): valid `--log-level` > `--verbose`/`-v` (→ "debug") > a valid
 * `LOG_LEVEL` env value (lowercased) > the `"info"` default.
 *
 * An unknown/bogus level (flag or env) is REJECTED — it is not in
 * `PINO_LEVELS`, so it falls through rather than being passed raw into pino
 * (T-04-03). `parseArgs` runs in `strict` mode, so an unknown FLAG (not value)
 * THROWS; `main` calls this inside its try/catch so a bad flag surfaces as a
 * clean exit-2 failure rather than an uncaught crash (this function does NOT
 * swallow that throw).
 */
export function resolveLogLevel(argv: string[], env: NodeJS.ProcessEnv): string {
  const { values } = parseArgs({
    args: argv,
    options: {
      verbose: { type: "boolean", short: "v" },
      "log-level": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false, // D-11: the CLI takes no positional args.
    strict: true,
  });

  // Q2 precedence: an explicit, valid --log-level beats --verbose and env.
  const flagLevel = values["log-level"];
  if (flagLevel !== undefined && PINO_LEVELS.has(flagLevel)) return flagLevel;
  if (values.verbose === true) return "debug";

  const envLevel = env.LOG_LEVEL?.toLowerCase();
  if (envLevel !== undefined && PINO_LEVELS.has(envLevel)) return envLevel;

  return "info";
}

/**
 * Map a `GameReport.reason` to the natural-vs-guard exit code (D-08), consuming
 * the EXPORTED `END` from `runner.ts` so the mapping has ONE source of truth
 * (DRY, Open Question Q1 option b). 0 = natural game-over; 1 = a guard stop
 * (`TURN_CAP`/`NO_PROGRESS`). The third code — 2 = a thrown error — is set by
 * `main`'s catch (this pure helper never sees a thrown error).
 */
export function exitCodeForReason(reason: string): 0 | 1 {
  return reason === END.GAME_OVER ? 0 : 1;
}

/**
 * The short usage block printed when `--help`/`-h` is passed (WR-02). It
 * documents the only real flags (verbosity) so the declared help flag is no
 * longer dead code that silently plays a full game.
 */
export const USAGE = `Dragons of Mugloar autoplay bot

Usage: npm start [-- <options>]

Options:
  -v, --verbose         Set log level to "debug" (verbose play-by-play).
      --log-level <lvl> Set the pino log level explicitly (wins over --verbose).
                        One of: trace, debug, info, warn, error, fatal, silent.
  -h, --help            Print this help and exit without starting a game.

Environment:
  LOG_LEVEL             Fallback log level when no flag is given (default: info).
  MUGLOAR_BASE_URL      Override the API base URL (owned by api.ts).
`;

/**
 * Detect whether the user asked for usage (WR-02). Takes `argv` as an EXPLICIT
 * param (never reads `process.argv` itself) so it stays pure and offline-
 * testable, mirroring `resolveLogLevel`. Parsed in non-strict mode with the same
 * option vocabulary so an UNKNOWN flag never makes help-detection throw — a help
 * request must always be honored even alongside a typo'd flag.
 */
export function isHelpRequested(argv: string[]): boolean {
  const { values } = parseArgs({
    args: argv,
    options: {
      verbose: { type: "boolean", short: "v" },
      "log-level": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });
  return values.help === true;
}

/**
 * Print the always-visible FINAL SCORE summary (D-07). It writes a bordered
 * block straight to `process.stdout` — deliberately BYPASSING pino — so the
 * final score is shown regardless of the resolved log level (even at `silent`).
 * Only the typed `GameReport` fields (`score`/`turns`/`reason`) are printed; no
 * untrusted API string and no secret reaches this banner (T-04-05).
 */
function printBanner(report: GameReport): void {
  const rows = [
    `  FINAL SCORE : ${report.score}`,
    `  TURNS PLAYED: ${report.turns}`,
    `  END REASON  : ${report.reason}`,
  ];
  const width = Math.max(...rows.map((r) => r.length)) + 2;
  const border = `+${"-".repeat(width)}+`;
  const body = rows.map((r) => `|${r.padEnd(width)}|`).join("\n");
  process.stdout.write(`\n${border}\n${body}\n${border}\n`);
}

/**
 * Resolve the log level WITHOUT letting a bad CLI flag crash the process. In
 * `strict` mode `parseArgs` THROWS on an unknown flag (T-04-04); we catch that
 * here and degrade to the default `info` level so the logger can always be
 * constructed exactly ONCE below. A flag error is non-fatal for verbosity — the
 * run still proceeds and any REAL failure (transport/boundary) is what drives
 * the exit-2 path in `main`'s catch.
 */
function safeResolveLogLevel(): string {
  try {
    return resolveLogLevel(process.argv.slice(2), process.env);
  } catch {
    return "info";
  }
}

/**
 * The composition root: construct the real pair, run one game, print the
 * banner, and map the outcome to an exit code. This is the ONLY place
 * `HttpApiClient` + `ConsoleLogger` are constructed (success criterion #3) and
 * the SINGLE authoritative try/catch (D-09) that `runner.ts` deliberately omits.
 *
 * The level is resolved (degrading on a bad flag) BEFORE the try so the logger
 * is built exactly once and is available to the catch's `logger.error`.
 *
 * Exit codes (D-08): 0 = natural game-over, 1 = guard stop (TURN_CAP /
 * NO_PROGRESS), 2 = ANY thrown Transport/BoundaryError. It sets
 * `process.exitCode` and RETURNS — it NEVER calls `process.exit()` — so Node
 * drains the synchronous pretty stream + the stdout banner fully before exiting.
 */
async function main(): Promise<void> {
  // Honor --help/-h BEFORE constructing anything or starting a game (WR-02):
  // print usage straight to stdout (bypassing pino, like the banner) and return
  // with exit 0 so no live game runs.
  if (isHelpRequested(process.argv.slice(2))) {
    process.stdout.write(USAGE);
    process.exitCode = 0;
    return;
  }

  const level = safeResolveLogLevel();
  // The ONLY place the real pair is constructed (success criterion #3). The base
  // URL is owned by api.ts (non-www default + MUGLOAR_BASE_URL); index.ts never
  // re-reads or duplicates it.
  // The logger must be built OUTSIDE the try so the catch can use it; its
  // construction is guarded by the launch-site `.catch` (WR-01) below.
  const logger = createConsoleLogger(level);

  try {
    // Construct the client INSIDE the try so a constructor throw (it reads
    // process.env and runs a regex .replace) is caught by the existing handler
    // and mapped to a deterministic exit, rather than escaping as an unhandled
    // rejection that bypasses the D-08 exit-code contract (WR-01).
    const api = new HttpApiClient();
    const report: GameReport = await playGame(api, logger);
    printBanner(report);
    process.exitCode = exitCodeForReason(report.reason); // 0 = game-over, 1 = guard stop.
  } catch (err) {
    // ANY thrown value → exit 2 (D-08), but BRANCH the reporting by type (WR-05)
    // so a genuine bug is not silently reported as an expected network failure:
    //   - TransportError → a retryable transport failure (the retries exhausted),
    //   - BoundaryError  → a terminal boundary/schema-drift failure,
    //   - anything else  → an UNEXPECTED internal error (e.g. a real TypeError),
    //     which must stand out during the live smoke rather than be masked.
    // The untrusted message ALWAYS rides as a STRUCTURED field, never
    // concatenated into the headline (T-04-01).
    const message = err instanceof Error ? err.message : String(err);
    const kind =
      err instanceof TransportError
        ? "transport error"
        : err instanceof BoundaryError
          ? "boundary error"
          : "unexpected internal error";
    // Single channel for the human-readable line (WR-05): the always-visible
    // stdout write (mirrors the banner path, shown even at `silent`). The
    // logger.error carries only the STRUCTURED diagnostic fields — it does NOT
    // repeat the human headline, so the failure is not double-printed across two
    // streams under pretty rendering.
    logger.error("game crashed", { kind, error: message });
    process.stdout.write(`\nRun failed (${kind}): ${message}\n`);
    process.exitCode = 2;
  }
  // No process.exit(): returning drains the sync pretty stream + stdout fully.
}

// Launch with a rejection handler so ANY escape from `main` — most notably a
// throw during `createConsoleLogger` (built OUTSIDE main's try so the catch can
// use it) — maps to a deterministic exit 2 instead of an unhandled rejection
// with a non-deterministic exit code, preserving the D-08 contract (WR-01).
void main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(`\nRun failed during startup: ${message}\n`);
  process.exitCode = 2;
});
