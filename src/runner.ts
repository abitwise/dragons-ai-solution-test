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
import type { Ad, ApiClient, GameReport, GameState, Logger } from "./types.js";

/** Generous backstop; the turn-based cap (D-05). A flat turn never reaches it. */
const MAX_TURN = 2000;

/** Abort after this many consecutive iterations with no turn advance (D-06). */
const NO_PROGRESS_LIMIT = 3;

/**
 * The closed, greppable end-reason vocabulary returned verbatim in `GameReport`
 * (D-08). A `const` object — NOT a TS `enum` (CLAUDE.md forbids enum/namespace).
 * Exactly THREE game-terminal reasons; there is deliberately NO `API_ERROR`
 * reason (D-10) — a thrown ApiClient error propagates as a rejected promise and
 * produces no `GameReport` at all (D-11).
 *
 * EXPORTED (Phase 4 Q1 → option b) so `index.ts` maps each `GameReport.reason`
 * string to an exit code from this single source of truth (DRY/greppable),
 * rather than re-declaring the strings. This is an additive change only — the
 * `as const` object and its three exact strings are byte-identical, and nothing
 * about the loop mechanics, the `playGame` signature, the guards, or the
 * taxonomy changes.
 */
export const END = {
  GAME_OVER: "game over: lives reached 0",
  TURN_CAP: "stopped: max-turn cap reached",
  NO_PROGRESS: "stopped: no-progress guard tripped",
} as const;

/** A non-game-over stop reason, or `null` to keep playing. The closed `END` set. */
type StopReason = typeof END.TURN_CAP | typeof END.NO_PROGRESS | null;

/**
 * The two safety guards that make non-termination impossible (D-05/D-06/D-07),
 * evaluated AFTER each iteration's work so the just-played turn is reflected:
 *   - the max-turn cap catches a turn that keeps CLIMBING (`turn > MAX_TURN`),
 *   - the no-progress guard catches a turn that goes FLAT (`stalls` reaches the
 *     `NO_PROGRESS_LIMIT` consecutive non-advancing iterations).
 * Together they bound the loop whether `turn` climbs or stalls. Returns the
 * matching `END` reason, or `null` when neither guard fires (keep playing).
 */
function shouldStop(turn: number, stalls: number): StopReason {
  if (turn > MAX_TURN) return END.TURN_CAP;
  if (stalls >= NO_PROGRESS_LIMIT) return END.NO_PROGRESS;
  return null;
}

/**
 * A compact, structured DEBUG view of the candidate ads considered this turn —
 * each ad's id, reward, probability label, and expiry. Derived ONLY from the
 * already-fetched `ads` array (no new `strategy.ts` export, no rank-table
 * duplication — `strategy.ts` is LOCKED). The untrusted ad `message`/encrypted
 * text is deliberately NOT included: candidate detail rides at DEBUG and never
 * interpolates raw API strings into the log message (T-04-01/T-04-02).
 */
function candidateView(
  ads: Ad[],
): Array<Pick<Ad, "adId" | "reward" | "probability" | "expiresIn">> {
  return ads.map((ad) => ({
    adId: ad.adId,
    reward: ad.reward,
    probability: ad.probability,
    expiresIn: ad.expiresIn,
  }));
}

/**
 * Drain the shop phase for one iteration (D-01/D-02), returning the updated
 * `GameState`. Repeatedly: ask `chooseShopPurchase` what to buy; if it returns an
 * item, `buy` it and fold the raw `BuyResult` via `applyBuyResult`; stop when the
 * strategy returns `null` (nothing worth buying) OR a buy reports
 * `shoppingSuccess:false` (can't actually afford it — the guard against an
 * infinite re-buy of an unaffordable-but-recommended item). The shop is
 * re-fetched after each successful buy so the next decision sees current costs.
 *
 * Narration (D-05/D-06, Phase 4): the shop catalog and each fetch boundary ride
 * at DEBUG (verbose play-by-play / never above DEBUG); a SUCCESSFUL buy narrates
 * at INFO (a decision/outcome) and a `shoppingSuccess:false` buy at WARN (a
 * nothing-to-do skip). Untrusted shop strings (item `name`) are passed as
 * STRUCTURED fields, never interpolated into the message text (T-04-01).
 */
async function drainShop(api: ApiClient, state: GameState, logger: Logger): Promise<GameState> {
  let shop = await api.getShop(state.gameId);
  // Verbose play-by-play: the raw catalog rides ONLY at DEBUG (PITFALLS rule).
  logger.debug("fetched shop catalog", { items: shop });
  let item = chooseShopPurchase(state, shop);

  while (item !== null) {
    const result = await api.buy(state.gameId, item.id);
    // Fold the RAW BuyResult — applyBuyResult carries score/highScore forward so
    // a buy can never silently zero the reported score. Never `state = result`.
    state = applyBuyResult(state, result);

    if (result.shoppingSuccess) {
      // INFO decision/outcome: one scannable line per buy. `name` is untrusted
      // API text — pass it as a structured field, never in the message (T-04-01).
      logger.info("bought item", {
        itemId: item.id,
        name: item.name,
        cost: item.cost,
        gold: state.gold,
      });
    } else {
      // WARN skip: the recommended item could not actually be afforded; the
      // drain stops here rather than re-buying it forever (D-02).
      logger.warn("buy not completed (insufficient gold)", {
        itemId: item.id,
        name: item.name,
        cost: item.cost,
        gold: state.gold,
      });
      break; // D-02: can't afford → stop re-buying.
    }

    shop = await api.getShop(state.gameId); // re-fetch after the turn-consuming buy
    logger.debug("re-fetched shop catalog after buy", { items: shop });
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
 * The loop can NEVER run forever (D-07): besides the `lives === 0` exit
 * (`END.GAME_OVER`), two guards bound it after each iteration's work — the
 * max-turn cap (climbing `turn` → `END.TURN_CAP`, D-05) and the no-progress
 * stall counter (flat `turn` for `NO_PROGRESS_LIMIT` consecutive iterations →
 * `END.NO_PROGRESS`, D-06). An empty board (`chooseAd` null) with no buys
 * advances nothing and so rides into the no-progress guard (D-14) — one unified
 * stall-termination, no separate empty-board reason.
 *
 * It adds NO try/catch around the API calls (D-11): a thrown `TransportError` /
 * `BoundaryError` propagates verbatim as a rejected promise (this function never
 * imports those classes); `index.ts` (Phase 4) owns the catch.
 *
 * On exit the report is `{ score: state.score, turns: state.turn, reason }` where
 * `reason` is one of the three `END` constants — `turns` is the API's own turn
 * counter, not a private loop counter (D-08/D-09).
 */
export async function playGame(api: ApiClient, logger: Logger): Promise<GameReport> {
  let state: GameState = await api.startGame();
  logger.info("game started", { gameId: state.gameId, lives: state.lives });

  // No-progress tracking (D-06): `stalls` counts CONSECUTIVE iterations whose
  // work did not advance `state.turn`; it resets to 0 the moment a turn advances.
  let stalls = 0;

  while (state.lives > 0) {
    const turnBefore = state.turn;
    // Capture the other tracked progress fields alongside `turn` (WR-03): a buy
    // or solve can make genuine progress (score/gold change) without the API's
    // `turn` advancing for this observation, and tying "progress" exclusively to
    // `turn` would miscount that real work as a stall and abort a winnable game.
    const scoreBefore = state.score;
    const goldBefore = state.gold;

    // SHOP PHASE (D-01/D-02): drain sensible buys before the solve.
    state = await drainShop(api, state, logger);

    // FRESH ADS THEN SOLVE (D-03/LOOP-03): re-fetch after the turn-consuming shop
    // phase so expiresIn is current at decision time.
    const ads = await api.getMessages(state.gameId);
    // Verbose play-by-play: the candidate ads considered this turn ride at DEBUG
    // (never above DEBUG — keeps the default INFO run scannable, RESEARCH Pitfall 4).
    logger.debug("fetched ads", { count: ads.length, candidates: candidateView(ads) });
    const ad = chooseAd(ads);
    if (ad !== null) {
      // INFO decision: the chosen ad (its reward + probability) before solving.
      // `probability` is a free-text API label — pass it as a structured field,
      // never interpolated into the message text (T-04-01).
      logger.info("chose ad", { adId: ad.adId, reward: ad.reward, probability: ad.probability });

      // Capture the RAW SolveResult so the outcome line can report the body's
      // `success` boolean (the source of truth, NOT the HTTP status), then fold
      // it. applySolveResult carries level forward — a success:false body is
      // normal play; the merge drops lives and we loop (never branch on success).
      const result = await api.solve(state.gameId, ad.adId);
      state = applySolveResult(state, result);

      // INFO outcome: the human-readable result of the solve (the body's success
      // flag + the lives/gold/score deltas). Raw per-field detail stays at DEBUG.
      logger.info("solve outcome", {
        adId: ad.adId,
        success: result.success,
        lives: state.lives,
        gold: state.gold,
        score: state.score,
      });
      logger.debug("solved ad", { adId: ad.adId, lives: state.lives, score: state.score });
    } else {
      // WARN skip: no eligible/solvable ad this turn (empty or all-filtered
      // board). Nothing turn-consuming happens, so this rides into the
      // no-progress guard (D-14) — one unified stall-termination.
      logger.warn("no eligible ad this turn (nothing to do)", { adsSeen: ads.length });
    }

    // After the iteration's work: reset the stall counter when ANY tracked state
    // field advanced — `turn` climbed, OR `score`/`gold` changed (WR-03) — else
    // accumulate; then check both guards on the just-played state. Defining
    // progress as "the game state changed" (not just `turn`) keeps the guard's
    // intent (catch a truly FLAT loop) while no longer aborting a turn-flat-but-
    // real-progress iteration.
    const progressed =
      state.turn > turnBefore || state.score !== scoreBefore || state.gold !== goldBefore;
    stalls = progressed ? 0 : stalls + 1;
    const stop = shouldStop(state.turn, stalls);
    if (stop !== null) {
      const report: GameReport = { score: state.score, turns: state.turn, reason: stop };
      logger.info("game stopped by guard", report);
      return report;
    }
  }

  const report: GameReport = { score: state.score, turns: state.turn, reason: END.GAME_OVER };
  logger.info("game over", report);
  return report;
}
