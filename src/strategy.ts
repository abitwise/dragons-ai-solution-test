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
 * This file grows across plans 02-01..02-04 (D-01..D-12). Plan 02-01 landed the
 * first two responsibilities; Plan 02-02 added the selector; Plan 02-03 added the
 * shop decision; Plan 02-04 completes the core with the two state-merge helpers:
 *   - rankProbability (STRAT-01 / D-01): exact-string lookup, integer ranks
 *     0–10, unknown → 0, never throws.
 *   - filterEligibleAds (STRAT-02 / D-02 / D-03 / WR-01): drops expired,
 *     sub-floor (rank < PROBABILITY_FLOOR_RANK), still-encrypted, and
 *     non-finite-reward (`NaN`/`±Infinity`) ads in one place, returning a new
 *     array without mutating its input.
 *   - chooseAd (STRAT-03 / D-04..D-07): among the floor-eligible ads picks the
 *     highest expected value (`reward × rank`), tiebreaking on sooner expiry
 *     then higher reward; falls back to a least-bad gamble (relaxing ONLY the
 *     floor, still excluding expired/still-encrypted ads) when none clear the
 *     floor; returns `null` only for a truly empty/no-solvable board. Never
 *     throws, never mutates its input, never selects a still-encrypted ad.
 *   - chooseShopPurchase (STRAT-04 / STRAT-05 / D-08..D-11): heals (buys `hpot`,
 *     looked up by id with its LIVE cost) when `lives < MAX_LIVES_TO_KEEP` and
 *     gold allows; otherwise — only when lives are healthy — buys the priciest
 *     affordable non-`hpot` upgrade while reserving HEAL_BUFFER_GOLD. Costs are
 *     read live from the passed-in shop list (never hardcoded); returns `null`
 *     when nothing should be bought. Never throws, never mutates its inputs.
 *   - applySolveResult / applyBuyResult (STRAT-06 / D-12): fold a `SolveResult` /
 *     `BuyResult` into the prior `GameState` WITHOUT clobbering the field the
 *     response omits — a solve carries `level` forward (it has none), a buy
 *     carries `score`/`highScore` forward (it has neither). Both return a NEW
 *     `GameState` via spread and never mutate the prior one.
 */

import type { Ad, BuyResult, GameState, ShopItem, SolveResult } from "./types.js";

/** Probability floor: only attempt ads ranked `Hmmm....` (6) or safer (D-02). */
const PROBABILITY_FLOOR_RANK = 6;

/** Heal below a full life buffer: buy `hpot` when `lives` is under this (D-08). */
const MAX_LIVES_TO_KEEP = 3;

/** Reserve ~2 potions' worth of gold before any upgrade is allowed (D-10). */
const HEAL_BUFFER_GOLD = 100;

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
 *   - its `reward` is a FINITE number (WR-01): `Ad.reward` is coerced from a
 *     wire string in `api.ts`, and a failed coercion yields `NaN`. A non-finite
 *     reward makes its expected value `NaN`, which would silently fall through
 *     `preferAd` and corrupt selection — so it is dropped here (a finite
 *     negative reward is NOT excluded; only `NaN`/`±Infinity`).
 *
 * Pure: `Array.filter` returns a NEW array and never mutates the input array or
 * its ad objects. Never throws.
 */
export function filterEligibleAds(ads: Ad[]): Ad[] {
  return ads.filter(
    (ad) =>
      ad.expiresIn > 0 &&
      rankProbability(ad.probability) >= PROBABILITY_FLOOR_RANK &&
      !ad.encrypted &&
      Number.isFinite(ad.reward),
  );
}

/** Expected value of attempting an ad: `reward × rank` (D-04) — the selection metric. */
function expectedValue(ad: Ad): number {
  return ad.reward * rankProbability(ad.probability);
}

/**
 * Pick the better of two ads under the deterministic ordering (D-04 / D-05):
 *   1. higher expected value (`reward × rank`);
 *   2. on an EV tie, the sooner-expiring ad (lower `expiresIn`) — use-it-or-lose-it;
 *   3. on a further tie, the higher `reward`.
 *
 * A pure comparator returning the winning ad; `current` is kept on an exact tie,
 * so a stable single-pass reduce over the candidate list yields the best ad.
 */
function preferAd(current: Ad, candidate: Ad): Ad {
  const evDiff = expectedValue(candidate) - expectedValue(current);
  if (evDiff > 0) return candidate;
  if (evDiff < 0) return current;

  if (candidate.expiresIn < current.expiresIn) return candidate;
  if (candidate.expiresIn > current.expiresIn) return current;

  return candidate.reward > current.reward ? candidate : current;
}

/** The best ad in a non-empty candidate list by `preferAd`, or `null` if the list is empty. */
function bestOf(candidates: Ad[]): Ad | null {
  return candidates.length === 0 ? null : candidates.reduce(preferAd);
}

/**
 * Choose which ad to solve this turn (STRAT-03), or `null` when there is nothing
 * worth solving (D-07).
 *
 * Primary path (D-04 / D-05): among the floor-eligible ads (reuse
 * `filterEligibleAds`), return the one maximizing `reward × rankProbability`,
 * tiebreaking on sooner expiry then higher reward.
 *
 * Least-bad-gamble fallback (D-06): if NO ad clears the floor, relax ONLY the
 * floor — the "solvable set" is the present ads that are non-expired
 * (`expiresIn > 0`), NOT still-encrypted (`!encrypted`), and have a FINITE
 * `reward` (WR-01). Return the best of that set by the SAME ordering. The floor
 * is the only relaxed constraint: a still-encrypted ad would 400 on `/solve`
 * (PITFALLS #2), an expired ad is gone, and a non-finite-reward ad would corrupt
 * EV selection — so none is ever selected even in the fallback (the fallback
 * stays in lock-step with the primary filter on every constraint but the floor).
 *
 * No-ad signal (D-07): if even the solvable set is empty (empty board, or all
 * ads expired/still-encrypted), return `null`. The runner (Phase 3) branches on
 * `null` to shop or end cleanly.
 *
 * Pure: reads the input array, never mutates it or its ads, and never throws.
 */
export function chooseAd(ads: Ad[]): Ad | null {
  const eligible = filterEligibleAds(ads);
  if (eligible.length > 0) {
    return bestOf(eligible);
  }

  // Fallback: relax ONLY the floor; still exclude expired, still-encrypted, and
  // non-finite-reward ads (lock-step with filterEligibleAds, WR-01).
  const solvable = ads.filter(
    (ad) => ad.expiresIn > 0 && !ad.encrypted && Number.isFinite(ad.reward),
  );
  return bestOf(solvable);
}

/**
 * Decide what — if anything — to buy from the shop this turn (STRAT-04 /
 * STRAT-05), reading every cost LIVE from the passed-in `shop` list.
 *
 * Heal branch (D-08): if `state.lives < MAX_LIVES_TO_KEEP`, look up the `hpot`
 * item by `id`; if present and its live `cost <= state.gold`, return it.
 * Survival is the scoring lever (the game ends at `lives === 0`), so a full life
 * buffer is restored before anything else.
 *
 * Ordering (D-09): the upgrade branch runs ONLY when lives are healthy
 * (`state.lives >= MAX_LIVES_TO_KEEP`) — gated on healthy lives, NOT merely on
 * "heal not purchased". A low-lives-but-broke state therefore returns `null`
 * rather than spending the survival reserve on an upgrade.
 *
 * Upgrade branch (D-10 / D-11): among the non-`hpot` items still affordable
 * while reserving `HEAL_BUFFER_GOLD` (`cost <= state.gold - HEAL_BUFFER_GOLD`),
 * return the priciest (highest live `cost`) — a bigger level jump per turn is
 * more turn-efficient. If none qualify, return `null`.
 *
 * Pure: reads `state` and `shop`, never mutates either or their items, and
 * never throws — a missing `hpot` or an empty shop simply degrades to `null`.
 */
export function chooseShopPurchase(state: GameState, shop: ShopItem[]): ShopItem | null {
  if (state.lives < MAX_LIVES_TO_KEEP) {
    // Heal takes priority; the upgrade branch is gated on healthy lives, so an
    // unhealthy-but-unaffordable state stops here rather than buying an upgrade.
    const healingPotion = shop.find((item) => item.id === "hpot");
    if (healingPotion && healingPotion.cost <= state.gold) {
      return healingPotion;
    }
    return null;
  }

  // Lives are healthy: consider an upgrade, reserving the healing buffer.
  const affordableUpgrades = shop.filter(
    (item) => item.id !== "hpot" && item.cost <= state.gold - HEAL_BUFFER_GOLD,
  );
  if (affordableUpgrades.length === 0) {
    return null;
  }

  return affordableUpgrades.reduce((priciest, candidate) =>
    candidate.cost > priciest.cost ? candidate : priciest,
  );
}

/**
 * Fold a `SolveResult` into the prior `GameState` (STRAT-06 / D-12).
 *
 * The solve/buy responses are intentionally asymmetric: a `SolveResult` has NO
 * `level` field (see `types.ts`). A naive "replace state with the response"
 * would therefore reset `level` to undefined every turn. Instead, spread the
 * prior `state` first and override ONLY the fields the result carries — so
 * `level` (and `gameId`) are preserved from the prior state.
 *
 * Pure: spreads into a NEW object and never mutates the prior `state`.
 */
export function applySolveResult(state: GameState, result: SolveResult): GameState {
  return {
    ...state, // gameId + level carried forward (SolveResult has no level)
    lives: result.lives,
    gold: result.gold,
    score: result.score,
    highScore: result.highScore,
    turn: result.turn,
  };
}

/**
 * Fold a `BuyResult` into the prior `GameState` (STRAT-06 / D-12).
 *
 * Mirror image of the solve merge: a `BuyResult` has NO `score`/`highScore`
 * (see `types.ts`) but DOES carry `level`. Spread the prior `state` first and
 * override ONLY the fields the result carries — so `score`/`highScore` (and
 * `gameId`) are preserved from the prior state.
 *
 * This is the load-bearing half: `api.ts buy()` returns a standalone `GameState`
 * with `score: 0`/`highScore: 0` placeholders (it has no prior state to merge).
 * Consuming the RAW `BuyResult` here means those placeholders are irrelevant —
 * the threaded `score`/`highScore` come from the prior `state`, never the
 * result — so the final reported score is never silently corrupted by a buy.
 *
 * Pure: spreads into a NEW object and never mutates the prior `state`.
 */
export function applyBuyResult(state: GameState, result: BuyResult): GameState {
  return {
    ...state, // gameId + score + highScore carried forward (BuyResult has none)
    lives: result.lives,
    gold: result.gold,
    level: result.level,
    turn: result.turn,
  };
}
