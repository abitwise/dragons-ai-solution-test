/**
 * RED→GREEN tests for `ConsoleLogger` — the message-first→object-first bridge
 * over pino (LOG-01, D-02).
 *
 * Every test spies over an INJECTED, OUTPUT-DISABLED pino instance
 * (`pino({ level: "debug", enabled: false })` — no stream, no pretty, no
 * network) and asserts ONLY the CALL SHAPE pino receives, never the rendered
 * pretty string (asserting on pretty output is the documented anti-pattern).
 * This mirrors `api.test.ts`'s `vi.spyOn` offline seam and keeps the suite at
 * zero live network (TEST-01/D-12).
 *
 * Coverage (mirrors the plan's <behavior>):
 *   - routing: a one-object call folds to pino's (mergeObj, message) idiom
 *   - zero-args: a message-only call passes just the message (no merge object)
 *   - each level routes to the same-named pino method and no other
 *   - multi/mixed fold: extras wrap under one `args` key, message stays headline
 *   - array arg is WRAPPED under `args`, never treated as a merge object
 */

import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleLogger } from "./logger.js";

/**
 * Build an output-disabled pino and spy each level method. `enabled: false`
 * means pino emits nothing — no stream, no pretty, no output — so the test
 * exercises only the fold + routing, offline and instantly.
 */
function spyPino() {
  const p = pino({ level: "debug", enabled: false });
  return {
    p,
    debug: vi.spyOn(p, "debug"),
    info: vi.spyOn(p, "info"),
    warn: vi.spyOn(p, "warn"),
    error: vi.spyOn(p, "error"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConsoleLogger", () => {
  it("folds a one-object call to pino's (mergeObj, message) idiom", () => {
    const s = spyPino();
    new ConsoleLogger(s.p).info("game started", { gameId: "g1", lives: 3 });
    expect(s.info).toHaveBeenCalledWith({ gameId: "g1", lives: 3 }, "game started");
  });

  it("passes just the message when there are no args (no merge object)", () => {
    const s = spyPino();
    new ConsoleLogger(s.p).warn("no eligible ad");
    expect(s.warn).toHaveBeenCalledWith("no eligible ad");
  });

  it("routes each level to the same-named pino method and no other", () => {
    const s = spyPino();
    const logger = new ConsoleLogger(s.p);

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(s.debug).toHaveBeenCalledExactlyOnceWith("d");
    expect(s.info).toHaveBeenCalledExactlyOnceWith("i");
    expect(s.warn).toHaveBeenCalledExactlyOnceWith("w");
    expect(s.error).toHaveBeenCalledExactlyOnceWith("e");
  });

  it("wraps multi/mixed args under one `args` key, keeping the message as headline", () => {
    const s = spyPino();
    new ConsoleLogger(s.p).warn("skipped ad", { adId: "x" }, "extra", 42);
    expect(s.warn).toHaveBeenCalledWith({ args: [{ adId: "x" }, "extra", 42] }, "skipped ad");
  });

  it("wraps a single array arg under `args` rather than treating it as a merge object", () => {
    const s = spyPino();
    const adA = { adId: "a" };
    const adB = { adId: "b" };
    new ConsoleLogger(s.p).debug("candidates", [adA, adB]);
    expect(s.debug).toHaveBeenCalledWith({ args: [[adA, adB]] }, "candidates");
  });
});
