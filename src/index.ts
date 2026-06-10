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
import { END } from "./runner.js";

/**
 * The closed set of valid pino levels (house `const`/Set style — a string-set
 * vocabulary, never a TS keyword-vocab). An untrusted `--log-level`/`LOG_LEVEL`
 * value is validated against THIS set; an unknown value is rejected and falls
 * through to env/default, so a
 * bogus value can never crash the logger or silently disable all output
 * (security T-04-03).
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
