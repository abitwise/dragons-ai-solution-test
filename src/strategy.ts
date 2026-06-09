/**
 * `strategy.ts` — the pure functional-core decision module (STRAT-01..06).
 *
 * This is "what should the bot do" logic, expressed as deterministic pure
 * functions over plain objects (`Ad`, `GameState`, `ShopItem`, `SolveResult`,
 * `BuyResult` from `types.js`). It performs NO I/O: it never imports `fetch`,
 * `zod`, `pino`, the `ApiClient`, or anything from `api.js`/`fake-api-client.js`,
 * and it never touches the network. The runner (Phase 3) wires this module to
 * the API client; strategy never calls the client itself.
 *
 * Total functions, never throws: an unknown probability label ranks worst (0),
 * and the eligibility filter silently drops bad ads — so one malformed or
 * adversarial ad can never crash the decision loop.
 *
 * This file grows across plans 02-01..02-04 (D-01..D-12). Plan 02-01 lands the
 * first two responsibilities:
 *   - rankProbability (STRAT-01 / D-01): exact-string lookup, integer ranks
 *     0–10, unknown → 0, never throws.
 *   - filterEligibleAds (STRAT-02 / D-02 / D-03): drops expired, sub-floor
 *     (rank < PROBABILITY_FLOOR_RANK), and still-encrypted ads in one place,
 *     returning a new array without mutating its input.
 */

import type { Ad } from "./types.js";

/** Probability floor: only attempt ads ranked `Hmmm....` (6) or safer (D-02). */
const PROBABILITY_FLOOR_RANK = 6;

/**
 * Exact-string-keyed rank table over the 11 verified probability labels
 * (FEATURES.md lines 74–86). Higher = safer. The integer rank — NOT the
 * MEDIUM-confidence approximate percentages — is the EV weighting (D-01).
 *
 * `"Hmmm...."` has exactly FOUR dots (PITFALLS #6): match the literal string.
 */
const RANK: Record<string, number> = {
  "Sure thing": 10,
  "Piece of cake": 9,
  "Walk in the park": 8,
  "Quite likely": 7,
  "Hmmm....": 6,
  Gamble: 5,
  Risky: 4,
  "Rather detrimental": 3,
  "Playing with fire": 2,
  "Suicide mission": 1,
  Impossible: 0,
};

/**
 * Rank a free-text probability label to an integer 0–10 (higher = safer).
 *
 * A known label returns its table rank; an unknown/new label ranks worst (0).
 * Under `noUncheckedIndexedAccess` the lookup is `number | undefined`, so the
 * `?? 0` is the entire unknown→worst rule (D-01) — total, no `if`, never throws.
 */
export function rankProbability(probability: string): number {
  return RANK[probability] ?? 0;
}

/**
 * Filter a board of ads down to the ones worth attempting (STRAT-02), in one
 * place (D-03). Keeps an ad only when ALL hold:
 *   - it has not expired (`expiresIn > 0`);
 *   - its probability ranks at or above the floor (`>= PROBABILITY_FLOOR_RANK`),
 *     dropping `Gamble` (5) and riskier (D-02);
 *   - it is NOT still-encrypted — a truthy, non-zero `encrypted` flag means the
 *     API client could not decode it (Phase 1 D-09), so solving it would 400
 *     (PITFALLS #2). A decoded/plaintext ad has `encrypted` cleared to
 *     `0`/`undefined` (see `decode.ts`), which is falsy and therefore kept.
 *
 * Pure: `Array.filter` returns a NEW array and never mutates the input array or
 * its ad objects. Never throws.
 */
export function filterEligibleAds(ads: Ad[]): Ad[] {
  return ads.filter(
    (ad) =>
      ad.expiresIn > 0 &&
      rankProbability(ad.probability) >= PROBABILITY_FLOOR_RANK &&
      !ad.encrypted,
  );
}
