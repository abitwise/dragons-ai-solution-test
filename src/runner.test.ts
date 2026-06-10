import { describe, expect, it } from "vitest";
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
