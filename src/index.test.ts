/**
 * `index.test.ts` — offline unit coverage for the two PURE helpers exported by
 * the CLI composition root (`index.ts`): `resolveLogLevel` and
 * `exitCodeForReason`. Keeping these helpers exported (rather than in a 7th
 * source file) preserves the flat six-source-file shape (Open Question Q4).
 *
 * Both helpers are pure and take their inputs as EXPLICIT params — `argv`/`env`
 * for `resolveLogLevel`, the reason string for `exitCodeForReason` — so this
 * suite never touches `process.argv`/`process.env` and runs fully offline (the
 * same injection discipline `api.test.ts` uses for `delay`/`fetch`).
 *
 * `REASON` re-declares the three closed `END` strings from `runner.ts`
 * VERBATIM, mirroring `runner.test.ts:213-217` — if a runner wording drifts,
 * the exit-code mapping test breaks here (drift catcher).
 */

import { describe, expect, it } from "vitest";
import { USAGE, exitCodeForReason, isHelpRequested, resolveLogLevel } from "./index.js";

// Mirrors the three `END` strings in runner.ts (drift catcher, like
// runner.test.ts:213-217). A wording change in runner.ts must break this.
const REASON = {
  GAME_OVER: "game over: lives reached 0",
  TURN_CAP: "stopped: max-turn cap reached",
  NO_PROGRESS: "stopped: no-progress guard tripped",
} as const;

describe("resolveLogLevel", () => {
  it("resolves --verbose / -v to 'debug'", () => {
    expect(resolveLogLevel(["--verbose"], {})).toBe("debug");
    expect(resolveLogLevel(["-v"], {})).toBe("debug");
  });

  it("reads LOG_LEVEL from env when no flag is set", () => {
    expect(resolveLogLevel([], { LOG_LEVEL: "warn" })).toBe("warn");
  });

  it("defaults to 'info' with no flag and no env", () => {
    expect(resolveLogLevel([], {})).toBe("info");
  });

  it("lets an explicit --log-level beat the LOG_LEVEL env (flag > env)", () => {
    expect(resolveLogLevel(["--log-level", "error"], { LOG_LEVEL: "warn" })).toBe("error");
  });

  it("lets --log-level win over --verbose when both are passed (Q2)", () => {
    expect(resolveLogLevel(["--log-level", "warn", "--verbose"], {})).toBe("warn");
  });

  it("lowercases the env value before validating it", () => {
    expect(resolveLogLevel([], { LOG_LEVEL: "WARN" })).toBe("warn");
  });

  it("rejects an unknown env level and falls through to the default (T-04-03)", () => {
    expect(resolveLogLevel([], { LOG_LEVEL: "bogus" })).toBe("info");
  });

  it("rejects an unknown --log-level value and falls through to env (T-04-03)", () => {
    expect(resolveLogLevel(["--log-level", "nonsense"], { LOG_LEVEL: "warn" })).toBe("warn");
  });
});

describe("exitCodeForReason", () => {
  it("maps a natural game-over to 0 and every guard stop to 1 (D-08)", () => {
    expect(exitCodeForReason(REASON.GAME_OVER)).toBe(0);
    expect(exitCodeForReason(REASON.TURN_CAP)).toBe(1);
    expect(exitCodeForReason(REASON.NO_PROGRESS)).toBe(1);
  });
});

describe("isHelpRequested", () => {
  it("detects --help and -h (WR-02)", () => {
    expect(isHelpRequested(["--help"])).toBe(true);
    expect(isHelpRequested(["-h"])).toBe(true);
  });

  it("returns false when no help flag is present", () => {
    expect(isHelpRequested([])).toBe(false);
    expect(isHelpRequested(["--verbose"])).toBe(false);
  });

  it("honors help even alongside an unknown flag (non-strict parse)", () => {
    expect(isHelpRequested(["--lvel", "debug", "--help"])).toBe(true);
  });

  it("exposes a non-empty USAGE block for the help path to print", () => {
    expect(USAGE).toContain("Usage:");
    expect(USAGE).toContain("--help");
  });
});
