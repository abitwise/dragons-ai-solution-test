import { describe, expect, it } from "vitest";
import { BoundaryError, TransportError } from "./api.js";
import { FakeApiClient } from "./fake-api-client.js";
import { playGame } from "./runner.js";
import type { Ad, GameState, Logger, SolveResult } from "./types.js";

/**
 * Offline `playGame` tests (Plan 03-01) — the happy-path game-over, the
 * shop-phase drain, score preservation across a buy, the fresh-ads-before-solve
 * ordering (LOOP-03), and the empty-board no-crash case. Every case is driven by
 * the scripted `FakeApiClient` (zero live network) and asserts ONLY on the
 * returned `GameReport` and the recorded `.calls` — never on log strings (the
 * Logger is a silent spy; narration wording is Phase 4).
 *
 * The two termination guards (MAX_TURN / NO_PROGRESS) and the error-propagation
 * behavior are Plan 03-02's concern and are NOT asserted here.
 */

const baseState = (o: Partial<GameState> = {}): GameState => ({
  gameId: "g1",
  lives: 3,
  gold: 0,
  level: 0,
  score: 0,
  highScore: 0,
  turn: 0,
  ...o,
});

const solveFixture = (o: Partial<SolveResult> = {}): SolveResult => ({
  success: true,
  lives: 3,
  gold: 10,
  score: 10,
  highScore: 10,
  turn: 1,
  message: "ok",
  ...o,
});

const adFixture = (adId: string): Ad => ({
  adId,
  message: `do ${adId}`,
  reward: 10,
  expiresIn: 3,
  probability: "Sure thing",
});

// The runner depends on the Logger INTERFACE, not on `console`; a silent spy
// keeps the suite quiet and proves no log STRING is load-bearing.
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("playGame", () => {
  it("plays a full game to lives:0 and returns a GAME_OVER GameReport", async () => {
    const fake = new FakeApiClient({
      startGame: [baseState()],
      getShop: [[], []], // each iteration's shop phase buys nothing
      getMessages: [[adFixture("a1")], [adFixture("a2")]],
      solve: [
        solveFixture({ turn: 1 }),
        solveFixture({ success: false, lives: 0, score: 10, turn: 2 }),
      ],
    });

    const report = await playGame(fake, logger);

    expect(report).toEqual({
      score: 10,
      turns: 2,
      reason: "game over: lives reached 0",
    });
  });

  it("drains the shop phase folding buys via applyBuyResult, preserving score, stopping on null", async () => {
    // lives:2 (< MAX_LIVES_TO_KEEP) + gold:50 → chooseShopPurchase picks hpot.
    // The buy is a RAW BuyResult with NO score — if the runner assigned it raw to
    // state, the final report's score would be undefined/zeroed. Folding via
    // applyBuyResult must carry score/highScore (30) forward, then the later
    // solve overrides score to 40 — proving the buy did not zero it.
    const fake = new FakeApiClient({
      startGame: [baseState({ lives: 2, gold: 50, score: 30, highScore: 30 })],
      getShop: [
        [{ id: "hpot", name: "Healing potion", cost: 10 }], // first: heal is affordable
        [], // re-fetch after the buy: nothing left to buy → drain stops (null)
        [], // iteration 2 shop phase: buys nothing
      ],
      buy: [{ shoppingSuccess: true, gold: 40, lives: 3, level: 0, turn: 1 }],
      getMessages: [[adFixture("a1")], [adFixture("a2")]],
      solve: [
        solveFixture({ lives: 3, score: 40, highScore: 40, turn: 2 }),
        solveFixture({ success: false, lives: 0, score: 40, highScore: 40, turn: 3 }),
      ],
    });

    const report = await playGame(fake, logger);

    // Score came from the threaded state (carried 30 across the buy, then 40 from
    // the solve) — NOT zeroed by the raw BuyResult.
    expect(report.score).toBe(40);
    expect(report.reason).toBe("game over: lives reached 0");
    // Exactly one buy: chooseShopPurchase returned null on the re-fetched empty shop.
    expect(fake.calls.filter((c) => c.method === "buy")).toHaveLength(1);
  });

  it("stops the shop drain when a buy reports shoppingSuccess:false", async () => {
    // hpot stays in the shop on the re-fetch, so chooseShopPurchase would keep
    // recommending it; the shoppingSuccess:false break is what prevents an
    // infinite re-buy of an unaffordable-but-recommended item.
    const fake = new FakeApiClient({
      startGame: [baseState({ lives: 2, gold: 50, score: 0, highScore: 0 })],
      getShop: [
        [{ id: "hpot", name: "Healing potion", cost: 10 }], // iter1: heal recommended
        [], // iter2 shop phase
      ],
      buy: [{ shoppingSuccess: false, gold: 50, lives: 2, level: 0, turn: 0 }],
      getMessages: [[adFixture("a1")], [adFixture("a2")]],
      solve: [
        solveFixture({ lives: 2, turn: 1 }),
        solveFixture({ success: false, lives: 0, turn: 2 }),
      ],
    });

    const report = await playGame(fake, logger);

    expect(report.reason).toBe("game over: lives reached 0");
    // The drain made exactly ONE buy then broke on shoppingSuccess:false — it did
    // NOT re-fetch and re-buy the still-present hpot forever.
    expect(fake.calls.filter((c) => c.method === "buy")).toHaveLength(1);
  });

  it("fetches getMessages fresh after the shop phase, before each solve (LOOP-03)", async () => {
    const fake = new FakeApiClient({
      startGame: [baseState({ lives: 2, gold: 50 })],
      getShop: [
        [{ id: "hpot", name: "Healing potion", cost: 10 }],
        [], // re-fetch after buy → drain stops
      ],
      buy: [{ shoppingSuccess: true, gold: 40, lives: 3, level: 0, turn: 1 }],
      getMessages: [[adFixture("a1")]],
      solve: [solveFixture({ success: false, lives: 0, turn: 2 })],
    });

    await playGame(fake, logger);

    const methods = fake.calls.map((c) => c.method);
    const lastShopPhaseIndex = Math.max(methods.lastIndexOf("getShop"), methods.lastIndexOf("buy"));
    const messagesIndex = methods.indexOf("getMessages");
    const solveIndex = methods.indexOf("solve");

    // The turn-consuming shop phase (getShop/buy) precedes the fresh getMessages,
    // which precedes the solve — proving expiresIn is current at decision time.
    expect(lastShopPhaseIndex).toBeLessThan(messagesIndex);
    expect(messagesIndex).toBeLessThan(solveIndex);
  });

  it("does not crash and consumes no turn when chooseAd returns null (empty board)", async () => {
    const fake = new FakeApiClient({
      startGame: [baseState()],
      getShop: [[], []], // shop buys nothing both iterations
      getMessages: [
        [], // iter1: empty board → chooseAd returns null → no solve this iteration
        [adFixture("a2")], // iter2: a solvable ad drives to lives:0
      ],
      solve: [solveFixture({ success: false, lives: 0, turn: 1 })],
    });

    const report = await playGame(fake, logger);

    expect(report.reason).toBe("game over: lives reached 0");
    // Only ONE solve ran — the empty-board iteration consumed no turn-solving call.
    expect(fake.calls.filter((c) => c.method === "solve")).toHaveLength(1);
  });
});

/**
 * Plan 03-02 — the two termination guards (TURN_CAP + NO_PROGRESS) and the
 * verified error pass-through (D-05/D-06/D-07/D-10/D-11/D-12/D-13/D-14). Every
 * case is offline (`FakeApiClient`, zero live network) and asserts ONLY on the
 * returned `GameReport` / recorded `.calls` / the rejected promise's typed error.
 *
 * The three end-reason strings are the closed `END` vocabulary from `runner.ts`
 * (D-08), asserted verbatim here so a wording drift is caught.
 */
const REASON = {
  GAME_OVER: "game over: lives reached 0",
  TURN_CAP: "stopped: max-turn cap reached",
  NO_PROGRESS: "stopped: no-progress guard tripped",
} as const;

/** Mirrors `MAX_TURN` in runner.ts so the climbing-turn case can script `turn > MAX_TURN`. */
const MAX_TURN = 2000;

describe("playGame termination & errors", () => {
  it("trips the max-turn cap when turn climbs past MAX_TURN (D-05)", async () => {
    // A solvable board + a solve whose `turn` climbs every call while lives stay
    // at 3. lives NEVER reach 0, so ONLY the turn-cap can stop this — proving the
    // climbing-turn branch terminates. Function sources never exhaust, so without
    // the cap wired this would spin forever; the `solveCalls` throw-guard (set far
    // above MAX_TURN) turns that would-be infinite RED spin into a fast rejection.
    let solveCalls = 0;
    const fake = new FakeApiClient({
      startGame: [baseState({ lives: 3, turn: 0 })],
      getShop: () => [], // no buys: the shop never consumes a turn
      getMessages: () => [adFixture("a1")], // always one solvable ad
      solve: () => {
        solveCalls += 1;
        // Safety throw far above the cap so an UNWIRED guard (RED) rejects fast
        // instead of hanging; the wired cap (GREEN) fires at turn 2001, well before.
        if (solveCalls > MAX_TURN + 50) {
          throw new Error("runaway: cap should have fired by now");
        }
        // turn climbs 1,2,3,... → crosses MAX_TURN; lives stay > 0 forever.
        return solveFixture({ success: true, lives: 3, turn: solveCalls });
      },
    });

    const report = await playGame(fake, logger);

    expect(report.reason).toBe(REASON.TURN_CAP);
    expect(report.turns).toBeGreaterThan(MAX_TURN);
  });

  it("trips the no-progress guard after 3 consecutive stalls (D-06)", async () => {
    // Empty board every iteration + no buys → no turn-consuming action → state.turn
    // stays flat at 0. With no solve scripted at all, an over-run would reject via
    // chooseAd→(no solve) so the guard MUST stop it. Function sources never exhaust,
    // so without the guard this spins forever; with it, it ends after exactly 3 stalls.
    // The throw-guard (well above the 3-stall limit) makes an UNWIRED-guard RED fail
    // FAST as a rejection instead of spinning until OOM.
    let boards = 0;
    const fake = new FakeApiClient({
      startGame: [baseState({ turn: 0 })],
      getShop: () => [], // buys nothing
      getMessages: () => {
        boards += 1;
        if (boards > 50) throw new Error("runaway: no-progress guard should have fired by now");
        return []; // empty board → chooseAd null → no solve → turn flat
      },
    });

    const report = await playGame(fake, logger);

    expect(report.reason).toBe(REASON.NO_PROGRESS);
    // Exactly 3 stall iterations: getMessages fetched once per flat iteration.
    expect(fake.calls.filter((c) => c.method === "getMessages")).toHaveLength(3);
  });

  it("resets the stall counter when turn advances (D-06)", async () => {
    // Script: stall, stall (turn flat at 0), ADVANCE (a solvable ad whose solve
    // bumps turn to 1, lives still > 0), then stall, stall, stall. If the counter
    // did NOT reset on the advance, the run would trip at the 3rd TOTAL stall
    // (the one right after the advance). Because it resets, it only trips after 3
    // CONSECUTIVE post-advance stalls — proving reset-on-advance semantics.
    let iteration = 0;
    const fake = new FakeApiClient({
      startGame: [baseState({ lives: 3, turn: 0 })],
      getShop: () => [], // never buys
      getMessages: () => {
        iteration += 1;
        // Throw-guard: an UNWIRED guard (RED) spins forever; fail FAST as a rejection.
        if (iteration > 50) throw new Error("runaway: no-progress guard should have fired by now");
        // iterations 1,2 = empty (stall); iteration 3 = solvable (advance);
        // iterations 4,5,6 = empty (stall x3 → trips here).
        return iteration === 3 ? [adFixture("adv")] : [];
      },
      // The single advancing solve: turn 0 → 1, lives stay > 0 (resets the counter).
      solve: [solveFixture({ success: true, lives: 3, turn: 1 })],
    });

    const report = await playGame(fake, logger);

    expect(report.reason).toBe(REASON.NO_PROGRESS);
    // 6 board fetches total: 2 pre-advance stalls + 1 advance + 3 post-advance stalls.
    // (Had the counter NOT reset, it would have tripped at fetch #3, before the advance.)
    expect(fake.calls.filter((c) => c.method === "getMessages")).toHaveLength(6);
    // Exactly one solve fired (the advance) — the stalls ran no solve.
    expect(fake.calls.filter((c) => c.method === "solve")).toHaveLength(1);
  });

  it("empty board rides into the no-progress guard — no separate empty-board reason (D-14)", async () => {
    // chooseAd returns null every iteration AND the shop buys nothing → nothing
    // turn-consuming → state.turn flat → unified stall-termination with NO_PROGRESS.
    // There is NO separate empty-board reason constant: report.reason must be one of
    // exactly the three END strings, and specifically NO_PROGRESS here.
    let boards = 0;
    const fake = new FakeApiClient({
      startGame: [baseState({ turn: 0 })],
      getShop: () => [],
      getMessages: () => {
        boards += 1;
        // Throw-guard: an UNWIRED guard (RED) spins forever; fail FAST as a rejection.
        if (boards > 50) throw new Error("runaway: no-progress guard should have fired by now");
        return []; // truly empty board
      },
    });

    const report = await playGame(fake, logger);

    expect(report.reason).toBe(REASON.NO_PROGRESS);
    // Greppable proof: the reason is one of EXACTLY the three END constants.
    expect([REASON.GAME_OVER, REASON.TURN_CAP, REASON.NO_PROGRESS]).toContain(report.reason);
  });

  it("propagates a thrown BoundaryError as a rejected promise without wrapping (D-11/D-12)", async () => {
    // A valid startGame + empty shop, then getMessages THROWS a BoundaryError
    // mid-game. The runner adds no try/catch, so the ORIGINAL typed error rejects
    // the promise verbatim — the offline equivalent of "ends cleanly" (Phase 4 catches).
    const fake = new FakeApiClient({
      startGame: [baseState()],
      getShop: () => [],
      getMessages: () => {
        throw new BoundaryError("boom", 400);
      },
    });

    await expect(playGame(fake, logger)).rejects.toBeInstanceOf(BoundaryError);
  });

  it("propagates a thrown TransportError as a rejected promise without wrapping (D-11/D-12)", async () => {
    const fake = new FakeApiClient({
      startGame: [baseState()],
      getShop: () => [],
      getMessages: () => {
        throw new TransportError("net", 503);
      },
    });

    await expect(playGame(fake, logger)).rejects.toBeInstanceOf(TransportError);
  });

  it("a solve success:false with lives > 0 is NORMAL play and does NOT reject (D-13)", async () => {
    // First solve fails (success:false) but lives stay at 2 — that is ordinary
    // gameplay, NOT an error: the run must continue, not reject. A later lives:0
    // solve then drives a clean GAME_OVER.
    const fake = new FakeApiClient({
      startGame: [baseState({ lives: 2, turn: 0 })],
      getShop: [[], []],
      getMessages: [[adFixture("a1")], [adFixture("a2")]],
      solve: [
        solveFixture({ success: false, lives: 2, turn: 1 }), // failure body, lives > 0 → keep playing
        solveFixture({ success: false, lives: 0, turn: 2 }), // now lives:0 → GAME_OVER
      ],
    });

    const report = await playGame(fake, logger);

    expect(report.reason).toBe(REASON.GAME_OVER);
    // Two solves ran: the success:false body did not abort the run.
    expect(fake.calls.filter((c) => c.method === "solve")).toHaveLength(2);
  });

  it("a buy shoppingSuccess:false does NOT reject — the run continues to GAME_OVER (D-13)", async () => {
    // A buy reporting shoppingSuccess:false ends the shop drain (D-02) but is NORMAL
    // play — it must NOT reject. The run proceeds to a fresh solve and a lives:0 end.
    const fake = new FakeApiClient({
      startGame: [baseState({ lives: 2, gold: 50, turn: 0 })],
      getShop: [
        [{ id: "hpot", name: "Healing potion", cost: 10 }], // heal recommended
        [], // iter2 shop phase buys nothing
      ],
      buy: [{ shoppingSuccess: false, gold: 50, lives: 2, level: 0, turn: 0 }],
      getMessages: [[adFixture("a1")], [adFixture("a2")]],
      solve: [
        solveFixture({ success: true, lives: 2, turn: 1 }),
        solveFixture({ success: false, lives: 0, turn: 2 }),
      ],
    });

    const report = await playGame(fake, logger);

    expect(report.reason).toBe(REASON.GAME_OVER);
    // Exactly one buy (the shoppingSuccess:false break stopped the drain), then play continued.
    expect(fake.calls.filter((c) => c.method === "buy")).toHaveLength(1);
  });
});
