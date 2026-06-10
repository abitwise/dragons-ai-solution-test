/**
 * `logger.ts` — `ConsoleLogger`, the concrete `Logger` (LOG-01) backed by
 * Pino + pino-pretty (D-01), plus the `createConsoleLogger(level)` factory.
 *
 * This is the ONLY module in the codebase that imports `pino`/`pino-pretty`;
 * every other module (runner, index) depends on the `Logger` INTERFACE
 * (`types.ts`), never on this implementation. That keeps the logging library a
 * single, swappable edge — mirroring how `api.ts` is the only `fetch` caller.
 *
 * The interface speaks message-first (`method(message, ...args)`); pino speaks
 * object-first (`method(mergeObj, message)`). The pure `foldArgs` helper bridges
 * the two (D-02): caller-supplied values ride as STRUCTURED pino fields (the
 * merge object), never concatenated into the message string, so embedded
 * ANSI/newline sequences in untrusted API strings cannot forge new log lines
 * (T-04-01) — the message is always the caller's literal headline.
 *
 * Boundaries — what this module does NOT do:
 *   - It logs NOTHING on its own; callers drive every line.
 *   - It does no throwing I/O, so it has NO try/catch — logging is
 *     fire-and-forget (the real stream is synchronous; flush is the CLI's job).
 *   - It is the only place the real pretty stream is constructed
 *     (`createConsoleLogger`); the class takes an INJECTED pino instance so
 *     `logger.test.ts` can spy on it offline (mirrors `api.ts`'s injectable
 *     `delay`/factory split).
 */

import pino from "pino";
import pinoPretty from "pino-pretty";
import type { Logger } from "./types.js";

/** The four leveled methods — a string-literal union, never a TS `const`-vocab. */
type LevelMethod = "debug" | "info" | "warn" | "error";

/**
 * Fold the message-first variadic `...args` into pino's merge-object-first
 * idiom (D-02). Three branches:
 *   - zero args            → `undefined` (the caller passes just the message)
 *   - exactly one non-null,
 *     non-array object      → that object IS the merge object
 *   - anything else         → `{ args }` (multiple / mixed / primitive / a lone
 *                             array is WRAPPED, not spread, so the message stays
 *                             the headline and an array is never mistaken for a
 *                             merge object)
 */
function foldArgs(args: unknown[]): Record<string, unknown> | undefined {
  if (args.length === 0) {
    return undefined;
  }
  if (args.length === 1 && typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0])) {
    return args[0] as Record<string, unknown>;
  }
  return { args };
}

/**
 * The concrete leveled logger: implements the `Logger` interface by delegating
 * to an injected pino instance, folding each call's args into pino's
 * object-first shape.
 */
export class ConsoleLogger implements Logger {
  // Inject the pino instance so logger.test.ts can spy on it offline (mirrors
  // api.ts's injectable `delay`). The real instance is built by the factory.
  constructor(private readonly p: pino.Logger) {}

  /**
   * Route one call to the same-named pino method, folding args first: when the
   * fold yields no merge object, pass only the message; otherwise pass the
   * object FIRST, then the message (pino's idiom).
   */
  private emit(level: LevelMethod, message: string, args: unknown[]): void {
    const obj = foldArgs(args);
    if (obj === undefined) {
      this.p[level](message);
    } else {
      this.p[level](obj, message);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.emit("debug", message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.emit("info", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.emit("warn", message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.emit("error", message, args);
  }
}
