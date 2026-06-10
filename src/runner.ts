/**
 * `runner.ts` — the imperative shell (LOOP-01, LOOP-03).
 *
 * This is the ONLY module that sequences I/O and threads game progression. Each
 * outer iteration is fetch → decide → act → update → log: read the shop/ads via
 * the injected `ApiClient`, ask the pure `strategy.ts` functions what to do, call
 * the client to do it, and fold every result back into the threaded `GameState`
 * via the merge helpers (never assigning a raw result to state).
 *
 * Boundaries — what this module does NOT do:
 *   - It imports ONLY the `ApiClient`/`Logger` interfaces (from `types.js`) and
 *     the pure strategy functions (from `strategy.js`). It NEVER imports `fetch`,
 *     `zod`, `pino`, `console`, `HttpApiClient`, or `FakeApiClient` — production
 *     wires the real client in `index.ts` (Phase 4); tests wire `FakeApiClient`.
 *   - It adds NO retry and NO try/catch around the API calls: Phase 1 already
 *     retries reads and never retries solve/buy, so a thrown `TransportError` /
 *     `BoundaryError` propagates unchanged. `index.ts` (Phase 4) owns the catch.
 *
 * Plan 03-01 delivers the happy-path game-over, the shop-phase drain, the
 * fresh-ads-before-solve ordering, and the state-threading discipline. The two
 * termination guards (MAX_TURN cap + no-progress) and the error-propagation
 * assertions are Plan 03-02 — their constants are declared here so 03-02 only
 * adds the checks.
 */

import { applyBuyResult, applySolveResult, chooseAd, chooseShopPurchase } from "./strategy.js";
import type { ApiClient, GameReport, GameState, Logger } from "./types.js";

// MAX_TURN / NO_PROGRESS_LIMIT are declared here (per the 03-01 plan) but only
// WIRED in plan 03-02, where the turn-cap and no-progress guards are added.
// Suppress the unused-variable lint until then so the declaration can land now.
/** Generous backstop; the turn-based cap (D-05). Declared here, wired in 03-02. */
// biome-ignore lint/correctness/noUnusedVariables: wired by the turn-cap guard in plan 03-02
const MAX_TURN = 2000;

/** Abort after this many consecutive iterations with no turn advance (D-06). Wired in 03-02. */
// biome-ignore lint/correctness/noUnusedVariables: wired by the no-progress guard in plan 03-02
const NO_PROGRESS_LIMIT = 3;

/**
 * The closed, greppable end-reason vocabulary returned verbatim in `GameReport`
 * (D-08). A `const` object — NOT a TS `enum` (CLAUDE.md forbids enum/namespace).
 * `TURN_CAP`/`NO_PROGRESS` are declared now; 03-02 returns them when it wires the
 * guards.
 */
const END = {
  GAME_OVER: "game over: lives reached 0",
  TURN_CAP: "stopped: max-turn cap reached",
  NO_PROGRESS: "stopped: no-progress guard tripped",
} as const;

/**
 * Drain the shop phase for one iteration (D-01/D-02), returning the updated
 * `GameState`. Repeatedly: ask `chooseShopPurchase` what to buy; if it returns an
 * item, `buy` it and fold the raw `BuyResult` via `applyBuyResult`; stop when the
 * strategy returns `null` (nothing worth buying) OR a buy reports
 * `shoppingSuccess:false` (can't actually afford it — the guard against an
 * infinite re-buy of an unaffordable-but-recommended item). The shop is
 * re-fetched after each successful buy so the next decision sees current costs.
 */
async function drainShop(api: ApiClient, state: GameState): Promise<GameState> {
  let shop = await api.getShop(state.gameId);
  let item = chooseShopPurchase(state, shop);

  while (item !== null) {
    const result = await api.buy(state.gameId, item.id);
    // Fold the RAW BuyResult — applyBuyResult carries score/highScore forward so
    // a buy can never silently zero the reported score. Never `state = result`.
    state = applyBuyResult(state, result);

    if (!result.shoppingSuccess) break; // D-02: can't afford → stop re-buying.

    shop = await api.getShop(state.gameId); // re-fetch after the turn-consuming buy
    item = chooseShopPurchase(state, shop);
  }

  return state;
}

/**
 * Play a single full game to game-over and return a `GameReport` (LOOP-01).
 *
 * Seeds the threaded `GameState` from `startGame`, then loops while `lives > 0`:
 * a shop phase first (D-01), then fresh ads + one solve (D-03). State advances
 * ONLY through the merge helpers (D-04) — there is no get-state endpoint. A solve
 * with `success:false` but `lives > 0` is NORMAL play (D-13): the merge drops
 * lives and the loop continues; the runner never branches on `success`. When
 * `chooseAd` returns `null` (a truly empty/no-solvable board) the iteration runs
 * no solve and does not crash (D-14).
 *
 * On exit (`lives` reached 0) the report is
 * `{ score: state.score, turns: state.turn, reason: END.GAME_OVER }` — `turns`
 * is the API's own turn counter, not a private loop counter (D-08/D-09).
 */
export async function playGame(api: ApiClient, logger: Logger): Promise<GameReport> {
  let state: GameState = await api.startGame();
  logger.info("game started", { gameId: state.gameId, lives: state.lives });

  while (state.lives > 0) {
    // SHOP PHASE (D-01/D-02): drain sensible buys before the solve.
    state = await drainShop(api, state);

    // FRESH ADS THEN SOLVE (D-03/LOOP-03): re-fetch after the turn-consuming shop
    // phase so expiresIn is current at decision time.
    const ads = await api.getMessages(state.gameId);
    const ad = chooseAd(ads);
    if (ad !== null) {
      // Fold the RAW SolveResult — applySolveResult carries level forward. A
      // success:false body is normal play; the merge drops lives and we loop.
      state = applySolveResult(state, await api.solve(state.gameId, ad.adId));
      logger.debug("solved ad", { adId: ad.adId, lives: state.lives, score: state.score });
    }
  }

  const report: GameReport = { score: state.score, turns: state.turn, reason: END.GAME_OVER };
  logger.info("game over", report);
  return report;
}
