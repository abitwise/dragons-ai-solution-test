import { describe, expect, it } from "vitest";
import { FakeApiClient } from "./fake-api-client.js";
import type { Ad, BuyResult, GameState, ShopItem, SolveResult } from "./types.js";

/**
 * Mechanical-contract tests for `FakeApiClient`. The double has NO game logic to
 * test (D-07) — these prove ONLY its plumbing:
 *   1. queued responses are returned in FIFO order across calls,
 *   2. a `lives: 0` SolveResult can be scripted and is returned by `solve`
 *      (the game-over script Phase 3 relies on — D-07 / PITFALLS),
 *   3. startGame / getShop / buy each return their scripted value,
 *   4. an exhausted / absent queue throws an Error NAMING the method (T-01-06),
 *   5. function sources receive the call args, and calls are recorded so a test
 *      can assert e.g. `solve` got the right adId.
 *
 * Every fixture is a plain typed object — zero network, zero real HTTP. There is
 * no `fetch` and no log-string assertion anywhere.
 */

const baseGameState: GameState = {
  gameId: "g1",
  lives: 3,
  gold: 0,
  level: 0,
  score: 0,
  highScore: 0,
  turn: 0,
};

const adFixture = (adId: string): Ad => ({
  adId,
  message: `do ${adId}`,
  reward: 10,
  expiresIn: 3,
  probability: "Sure thing",
});

const solveFixture = (overrides: Partial<SolveResult> = {}): SolveResult => ({
  success: true,
  lives: 3,
  gold: 10,
  score: 10,
  highScore: 10,
  turn: 1,
  message: "ok",
  ...overrides,
});

describe("FakeApiClient", () => {
  it("returns queued getMessages responses in FIFO order across calls", async () => {
    const first: Ad[] = [adFixture("a1")];
    const second: Ad[] = [adFixture("a2"), adFixture("a3")];
    const client = new FakeApiClient({ getMessages: [first, second] });

    await expect(client.getMessages("g1")).resolves.toEqual(first);
    await expect(client.getMessages("g1")).resolves.toEqual(second);
  });

  it("returns a scripted lives:0 SolveResult — the Phase 3 game-over script (D-07)", async () => {
    const gameOver = solveFixture({ success: false, lives: 0, message: "You died" });
    const client = new FakeApiClient({ solve: [gameOver] });

    const result = await client.solve("g1", "ad-1");

    expect(result.lives).toBe(0);
    expect(result.success).toBe(false);
    expect(result).toEqual(gameOver);
  });

  it("returns scripted values for startGame, getShop, and buy", async () => {
    const shop: ShopItem[] = [{ id: "hpot", name: "Healing potion", cost: 50 }];
    // WR-02: buy() now returns a raw BuyResult (symmetric with solve()), NOT a
    // pre-merged GameState — the runner folds it via applyBuyResult.
    const boughtResult: BuyResult = { shoppingSuccess: true, gold: 0, lives: 4, level: 0, turn: 1 };
    const client = new FakeApiClient({
      startGame: [baseGameState],
      getShop: [shop],
      buy: [boughtResult],
    });

    await expect(client.startGame()).resolves.toEqual(baseGameState);
    await expect(client.getShop("g1")).resolves.toEqual(shop);
    await expect(client.buy("g1", "hpot")).resolves.toEqual(boughtResult);
  });

  it("throws an Error naming the method when its queue is exhausted (T-01-06)", async () => {
    const client = new FakeApiClient({ solve: [solveFixture()] });

    await expect(client.solve("g1", "ad-1")).resolves.toBeDefined(); // drains the queue

    await expect(client.solve("g1", "ad-2")).rejects.toThrow(/FakeApiClient.*solve/);
  });

  it("throws an Error naming the method when it was never scripted (T-01-06)", async () => {
    const client = new FakeApiClient({});

    await expect(client.getMessages("g1")).rejects.toThrow(/FakeApiClient.*getMessages/);
  });

  it("supports a function source that receives the call arguments", async () => {
    const client = new FakeApiClient({
      solve: (_gameId, adId) => solveFixture({ message: `solved ${adId}` }),
    });

    const result = await client.solve("g1", "ad-42");

    expect(result.message).toBe("solved ad-42");
  });

  it("records each call with its method name and arguments", async () => {
    const client = new FakeApiClient({
      startGame: [baseGameState],
      solve: [solveFixture()],
    });

    await client.startGame();
    await client.solve("g1", "ad-7");

    expect(client.calls).toEqual([
      { method: "startGame", args: [] },
      { method: "solve", args: ["g1", "ad-7"] },
    ]);
  });
});
