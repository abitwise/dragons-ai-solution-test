import { describe, expect, it } from "vitest";
import {
  applyBuyResult,
  applySolveResult,
  chooseAd,
  chooseShopPurchase,
  filterEligibleAds,
  rankProbability,
} from "./strategy.js";
import type { Ad, BuyResult, GameState, ShopItem, SolveResult } from "./types.js";

/**
 * Pure-function suite for the strategy core (Plans 02-01, 02-02, 02-03).
 *
 * Proves the responsibilities of `strategy.ts`:
 *   - `rankProbability` (STRAT-01 / D-01): every one of the 11 verified labels
 *     maps to its exact integer rank 0–10, the exact four-dot `"Hmmm...."`
 *     maps to 6, and an unknown label ranks worst (0) without ever throwing.
 *   - `filterEligibleAds` (STRAT-02 / D-02 / D-03): drops expired, sub-floor
 *     (rank < 6), and still-encrypted ads in one place, returning a new array
 *     and never mutating its input.
 *   - `chooseAd` (STRAT-03 / D-04..D-07): among eligible ads picks the highest
 *     expected value (`reward × rank`), breaks ties by sooner expiry then higher
 *     reward, falls back to a least-bad gamble when none clear the floor, and
 *     returns `null` only for a truly empty/no-solvable board — never throwing,
 *     never selecting a still-encrypted ad, never mutating its input.
 *   - `chooseShopPurchase` (STRAT-04 / STRAT-05 / D-08..D-11): heals (buys
 *     `hpot`, looked up by id with its LIVE cost) when `lives < 3` and gold
 *     allows; otherwise — only when lives are healthy — buys the priciest
 *     affordable non-`hpot` upgrade while reserving a 100-gold healing buffer;
 *     returns `null` when nothing should be bought; never throws, never mutates.
 *   - `applySolveResult` / `applyBuyResult` (STRAT-06 / D-12): pure state-merge
 *     helpers that fold a `SolveResult` / `BuyResult` into the prior `GameState`
 *     WITHOUT clobbering the field each response omits — a solve carries `level`
 *     forward (it has none), a buy carries `score`/`highScore` forward (it has
 *     neither). Both return a NEW `GameState` and never mutate the prior one;
 *     the buy merge restores the `score:0`/`highScore:0` placeholder that
 *     `api.ts buy()` writes for its standalone shape.
 *
 * All fixtures are plain objects — no mocks, no FakeApiClient, no network
 * (TEST-01). The unit under test is `strategy.ts`, which imports only types.
 */

/** A complete, eligible (plaintext, non-expired, safe) baseline ad we mutate per case. */
function baseAd(overrides: Partial<Ad> = {}): Ad {
  return {
    adId: "abc123",
    message: "Help the villagers",
    reward: 100,
    expiresIn: 3,
    probability: "Sure thing",
    ...overrides,
  };
}

/** A complete, neutral `GameState` we spread-merge per shop-decision case. */
function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: "g1",
    lives: 3,
    gold: 0,
    level: 0,
    score: 0,
    highScore: 0,
    turn: 0,
    ...overrides,
  };
}

/** A single shop catalog item; cost is what the decision must read LIVE (never a hardcoded literal). */
function shopItem(id: string, cost: number, name = id): ShopItem {
  return { id, name, cost };
}

/**
 * A complete `SolveResult` we spread-merge per merge case. NOTE: a solve result
 * has NO `level` key — that is the half of the asymmetry `applySolveResult`
 * carries forward from the prior state (D-12). Defaults differ from `baseState`
 * so a merge that wrongly drops a field is caught.
 */
function baseSolve(overrides: Partial<SolveResult> = {}): SolveResult {
  return {
    success: true,
    lives: 5,
    gold: 250,
    score: 1200,
    highScore: 1500,
    turn: 9,
    message: "Quest cleared",
    ...overrides,
  };
}

/**
 * A complete `BuyResult` we spread-merge per merge case. NOTE: a buy result has
 * NO `score`/`highScore` keys but DOES carry `level` — the mirror image of
 * `SolveResult`. `applyBuyResult` carries `score`/`highScore` forward from the
 * prior state (D-12), restoring the `score:0` placeholder `api.ts buy()` writes.
 */
function baseBuy(overrides: Partial<BuyResult> = {}): BuyResult {
  return {
    shoppingSuccess: true,
    gold: 80,
    lives: 4,
    level: 7,
    turn: 11,
    ...overrides,
  };
}

describe("rankProbability", () => {
  describe("known labels (D-01)", () => {
    // The 11 verified labels and their integer ranks (FEATURES.md lines 74–86).
    // Integer rank — NOT the MEDIUM-confidence percentages — is the weighting (D-01).
    const cases: ReadonlyArray<readonly [string, number]> = [
      ["Sure thing", 10],
      ["Piece of cake", 9],
      ["Walk in the park", 8],
      ["Quite likely", 7],
      ["Hmmm....", 6],
      ["Gamble", 5],
      ["Risky", 4],
      ["Rather detrimental", 3],
      ["Playing with fire", 2],
      ["Suicide mission", 1],
      ["Impossible", 0],
    ];

    it.each(cases)("maps %j to rank %i", (label, expectedRank) => {
      expect(rankProbability(label)).toBe(expectedRank);
    });

    it("maps the exact four-dot 'Hmmm....' to rank 6", () => {
      // Exactly four dots — not three, not a trailing space (PITFALLS #6).
      expect(rankProbability("Hmmm....")).toBe(6);
    });
  });

  describe("unknown label (D-01 worst-and-never-throw)", () => {
    it("ranks an unseen plain label 0", () => {
      expect(rankProbability("some new label")).toBe(0);
    });

    it("ranks the empty string 0", () => {
      expect(rankProbability("")).toBe(0);
    });

    it("ranks a base64-looking label 0 (a near-miss must not crash the loop)", () => {
      expect(rankProbability("U3VyZSB0aGluZw==")).toBe(0);
    });

    it("never throws for any string input", () => {
      expect(() => rankProbability("anything")).not.toThrow();
      expect(() => rankProbability("")).not.toThrow();
      expect(() => rankProbability("Hmmm...")).not.toThrow();
    });
  });
});

describe("filterEligibleAds (STRAT-02)", () => {
  it("keeps a 'Sure thing', non-expired, plaintext ad", () => {
    const ad = baseAd();
    expect(filterEligibleAds([ad])).toEqual([ad]);
  });

  it("keeps a 'Hmmm....' ad — the exact floor (rank 6) is eligible (D-02)", () => {
    const ad = baseAd({ probability: "Hmmm...." });
    expect(filterEligibleAds([ad])).toEqual([ad]);
  });

  it("drops a 'Gamble' (rank 5) ad — just below the floor (D-02)", () => {
    const ad = baseAd({ probability: "Gamble" });
    expect(filterEligibleAds([ad])).toEqual([]);
  });

  it("drops a 'Risky' (rank 4) ad (D-02)", () => {
    const ad = baseAd({ probability: "Risky" });
    expect(filterEligibleAds([ad])).toEqual([]);
  });

  it("drops an unknown-label (rank 0) ad (D-01/D-02)", () => {
    const ad = baseAd({ probability: "some new label" });
    expect(filterEligibleAds([ad])).toEqual([]);
  });

  it("drops an expired ad (expiresIn: 0) even when safe (D-03)", () => {
    const ad = baseAd({ expiresIn: 0 });
    expect(filterEligibleAds([ad])).toEqual([]);
  });

  it("drops a negative-expiry ad (expiresIn: -1) (D-03)", () => {
    const ad = baseAd({ expiresIn: -1 });
    expect(filterEligibleAds([ad])).toEqual([]);
  });

  it("drops a still-encrypted ad (encrypted: 1) the client could not decode (D-03/D-09)", () => {
    const ad = baseAd({ encrypted: 1 });
    expect(filterEligibleAds([ad])).toEqual([]);
  });

  it("drops a still-encrypted ad (encrypted: 2) (D-03/D-09)", () => {
    const ad = baseAd({ encrypted: 2 });
    expect(filterEligibleAds([ad])).toEqual([]);
  });

  it("keeps a decoded ad whose flag was cleared to 0 (decode.ts pass-through)", () => {
    const ad = baseAd({ encrypted: 0 });
    expect(filterEligibleAds([ad])).toEqual([ad]);
  });

  it("keeps eligible ads and drops ineligible ones from a mixed board", () => {
    const keepSure = baseAd({ adId: "keep-sure", probability: "Sure thing" });
    const keepFloor = baseAd({ adId: "keep-floor", probability: "Hmmm...." });
    const dropGamble = baseAd({ adId: "drop-gamble", probability: "Gamble" });
    const dropExpired = baseAd({ adId: "drop-expired", expiresIn: 0 });
    const dropEncrypted = baseAd({ adId: "drop-enc", encrypted: 1 });

    const result = filterEligibleAds([keepSure, dropGamble, keepFloor, dropExpired, dropEncrypted]);

    expect(result).toEqual([keepSure, keepFloor]);
  });

  it("does not mutate the input array or its ad objects", () => {
    const ads = [
      baseAd({ adId: "a", probability: "Sure thing" }),
      baseAd({ adId: "b", probability: "Gamble" }),
    ];
    const snapshot = ads.map((ad) => ({ ...ad }));

    filterEligibleAds(ads);

    expect(ads).toEqual(snapshot);
  });

  it("returns a new array, not the input reference", () => {
    const ads = [baseAd()];
    expect(filterEligibleAds(ads)).not.toBe(ads);
  });

  it("never throws on an empty board", () => {
    expect(() => filterEligibleAds([])).not.toThrow();
    expect(filterEligibleAds([])).toEqual([]);
  });
});

describe("chooseAd (STRAT-03)", () => {
  describe("EV selection (D-04)", () => {
    it("prefers the higher-EV safe ad over a higher-raw-reward risky ad", () => {
      // A: reward 200 × rank 10 (Sure thing) = EV 2000 — the safe, lower-reward ad.
      // B: reward 300 × rank 6 (Hmmm....)   = EV 1800 — bigger reward, worse odds.
      // EV must beat raw reward (PITFALLS #4): A wins despite B's larger reward.
      const safeWinner = baseAd({ adId: "A-safe", reward: 200, probability: "Sure thing" });
      const richRisky = baseAd({ adId: "B-rich", reward: 300, probability: "Hmmm...." });

      expect(chooseAd([richRisky, safeWinner])?.adId).toBe("A-safe");
    });

    it("never chooses a sub-floor ad even when its raw reward is huge (filtered before EV)", () => {
      // A monster-reward 'Risky' (rank 4 < floor) is dropped before EV ranking,
      // so the modest safe ad wins despite a far smaller reward × rank product.
      const safeWinner = baseAd({ adId: "A-safe", reward: 100, probability: "Sure thing" }); // EV 1000
      const subFloorMonster = baseAd({ adId: "B-monster", reward: 5000, probability: "Risky" }); // rank 4: dropped

      expect(chooseAd([subFloorMonster, safeWinner])?.adId).toBe("A-safe");
    });

    it("returns the single eligible ad when only one clears the floor", () => {
      const only = baseAd({ adId: "only", reward: 100, probability: "Sure thing" });
      const dropped = baseAd({ adId: "drop", reward: 9000, probability: "Gamble" }); // rank 5: dropped

      expect(chooseAd([only, dropped])?.adId).toBe("only");
    });
  });

  describe("expiry-aware tiebreak (D-05)", () => {
    it("on an EV tie, prefers the sooner-expiring ad (lowest expiresIn)", () => {
      // Both EV 1000; lower expiresIn wins (use-it-or-lose-it).
      const later = baseAd({
        adId: "later",
        reward: 100,
        probability: "Sure thing", // 100 × 10 = 1000
        expiresIn: 5,
      });
      const sooner = baseAd({
        adId: "sooner",
        reward: 125,
        probability: "Walk in the park", // 125 × 8 = 1000
        expiresIn: 2,
      });

      expect(chooseAd([later, sooner])?.adId).toBe("sooner");
    });

    it("on an EV tie AND an expiry tie, prefers the higher-reward ad", () => {
      // Both EV 1000 AND both expiresIn 3; higher reward wins the secondary tiebreak.
      const lowerReward = baseAd({
        adId: "low-reward",
        reward: 100,
        probability: "Sure thing", // 100 × 10 = 1000
        expiresIn: 3,
      });
      const higherReward = baseAd({
        adId: "high-reward",
        reward: 125,
        probability: "Walk in the park", // 125 × 8 = 1000
        expiresIn: 3,
      });

      expect(chooseAd([lowerReward, higherReward])?.adId).toBe("high-reward");
    });
  });

  describe("least-bad-gamble fallback (D-06)", () => {
    it("returns the highest-EV ad among an all-sub-floor (but decoded, non-expired) board", () => {
      // No ad clears the floor; relax it and return the best EV among the gambles.
      // gamble: 100 × 5 = 500; risky: 100 × 4 = 400  → the 'Gamble' wins.
      const gamble = baseAd({ adId: "gamble", reward: 100, probability: "Gamble" });
      const risky = baseAd({ adId: "risky", reward: 100, probability: "Risky" });

      expect(chooseAd([risky, gamble])?.adId).toBe("gamble");
    });

    it("does not return null when the board is all-sub-floor but solvable", () => {
      const gamble = baseAd({ adId: "gamble", reward: 100, probability: "Gamble" });

      expect(chooseAd([gamble])).not.toBeNull();
      expect(chooseAd([gamble])?.adId).toBe("gamble");
    });

    it("never relaxes onto a still-encrypted ad in the fallback (it would 400 on solve)", () => {
      // Both sub-floor; the still-encrypted one must be excluded even in fallback,
      // so the decoded gamble is chosen despite the encrypted ad's higher EV.
      const encryptedRich = baseAd({
        adId: "enc-rich",
        reward: 9000,
        probability: "Gamble", // EV 45000 but still-encrypted → excluded
        encrypted: 1,
      });
      const decodedGamble = baseAd({ adId: "dec-gamble", reward: 100, probability: "Gamble" });

      expect(chooseAd([encryptedRich, decodedGamble])?.adId).toBe("dec-gamble");
    });

    it("never relaxes onto an expired ad in the fallback", () => {
      // Both sub-floor; the expired one is excluded even in fallback.
      const expiredRich = baseAd({
        adId: "exp-rich",
        reward: 9000,
        probability: "Gamble",
        expiresIn: 0,
      });
      const liveRisky = baseAd({ adId: "live-risky", reward: 100, probability: "Risky" });

      expect(chooseAd([expiredRich, liveRisky])?.adId).toBe("live-risky");
    });
  });

  describe("empty / no-solvable board (D-07)", () => {
    it("returns null for an empty board", () => {
      expect(chooseAd([])).toBeNull();
    });

    it("returns null for a board of only expired ads", () => {
      const allExpired = [
        baseAd({ adId: "e1", probability: "Sure thing", expiresIn: 0 }),
        baseAd({ adId: "e2", probability: "Gamble", expiresIn: -1 }),
      ];
      expect(chooseAd(allExpired)).toBeNull();
    });

    it("returns null for a board of only still-encrypted ads", () => {
      const allEncrypted = [
        baseAd({ adId: "x1", probability: "Sure thing", encrypted: 1 }),
        baseAd({ adId: "x2", probability: "Gamble", encrypted: 2 }),
      ];
      expect(chooseAd(allEncrypted)).toBeNull();
    });

    it("never throws on empty / all-expired / all-still-encrypted boards", () => {
      expect(() => chooseAd([])).not.toThrow();
      expect(() => chooseAd([baseAd({ expiresIn: 0 })])).not.toThrow();
      expect(() => chooseAd([baseAd({ encrypted: 1 })])).not.toThrow();
    });
  });

  describe("purity (D-04..D-07)", () => {
    it("does not mutate the input array or its ad objects", () => {
      const board = [
        baseAd({ adId: "a", reward: 200, probability: "Sure thing" }),
        baseAd({ adId: "b", reward: 300, probability: "Hmmm...." }),
        baseAd({ adId: "c", reward: 5000, probability: "Risky" }),
      ];
      const snapshot = board.map((ad) => ({ ...ad }));

      chooseAd(board);

      expect(board).toEqual(snapshot);
    });
  });
});

describe("chooseShopPurchase (STRAT-04 / STRAT-05)", () => {
  // The live shop catalog tiers from FEATURES.md: hpot=50, 100-gold and 300-gold
  // upgrades. These costs are FIXTURE values; the decision must read them LIVE
  // from the passed-in list, never hardcode them (REQUIREMENTS Out of Scope).
  const hpot = shopItem("hpot", 50, "Healing potion");
  const cs = shopItem("cs", 100, "Claw Sharpening");
  const ch = shopItem("ch", 300, "Claw Honing");

  describe("heal policy (D-08)", () => {
    it("buys hpot when lives < 3 and gold >= the live hpot cost", () => {
      // lives 2 (< MAX_LIVES_TO_KEEP=3), gold 60 >= hpot cost 50 -> heal.
      const decision = chooseShopPurchase(baseState({ lives: 2, gold: 60 }), [hpot, cs, ch]);
      expect(decision?.id).toBe("hpot");
    });

    it("buys hpot at the exact affordable boundary (gold === live hpot cost)", () => {
      const decision = chooseShopPurchase(baseState({ lives: 1, gold: 50 }), [hpot, cs]);
      expect(decision?.id).toBe("hpot");
    });

    it("heals at lives 2 even with a large surplus (heal takes priority over upgrade)", () => {
      // Low lives + plenty of gold for `ch`(300): heal still wins (D-09 ordering).
      const decision = chooseShopPurchase(baseState({ lives: 2, gold: 500 }), [hpot, cs, ch]);
      expect(decision?.id).toBe("hpot");
    });

    it("reads the hpot cost LIVE: a 70-cost hpot does NOT fire heal at gold 60", () => {
      // CRITICAL live-cost proof: gold 60 is between the documented 50 and the
      // passed-in 70. A hardcoded-50 decision would (wrongly) heal; reading the
      // live cost (70) means heal cannot afford it. Lives are unhealthy (2), so
      // the upgrade branch must NOT fire either -> nothing bought.
      const pricierHpot = shopItem("hpot", 70, "Healing potion");
      const decision = chooseShopPurchase(baseState({ lives: 2, gold: 60 }), [pricierHpot, cs, ch]);
      expect(decision).toBeNull();
    });

    it("returns null when heal is needed but the live hpot cost is unaffordable", () => {
      // lives 1 (unhealthy), gold 30 < hpot cost 50 -> heal cannot fire; upgrade
      // is gated on healthy lives (D-09), which fails here -> nothing bought.
      const decision = chooseShopPurchase(baseState({ lives: 1, gold: 30 }), [hpot, cs, ch]);
      expect(decision).toBeNull();
    });

    it("returns null when no hpot exists in the shop and lives are low", () => {
      // Robustness (T-02-05): a shop with no `hpot` cannot heal; lives unhealthy
      // gates the upgrade branch off -> null, never throws.
      const decision = chooseShopPurchase(baseState({ lives: 1, gold: 500 }), [cs, ch]);
      expect(decision).toBeNull();
    });
  });

  describe("decision ordering heal > upgrade (D-09)", () => {
    it("considers an upgrade only when lives are healthy (heal condition not met)", () => {
      // lives 3 (full) -> heal does not fire; upgrade path runs and buys an item.
      const decision = chooseShopPurchase(baseState({ lives: 3, gold: 500 }), [hpot, cs, ch]);
      expect(decision).not.toBeNull();
      expect(decision?.id).not.toBe("hpot");
    });

    it("does NOT buy an upgrade when lives are low even with ample gold", () => {
      // lives 1 (unhealthy) but hpot unaffordable (gold 30 < 50): the upgrade
      // branch is gated on healthy lives, not merely on heal-not-purchased ->
      // null, NOT an upgrade bought with the survival reserve.
      const decision = chooseShopPurchase(baseState({ lives: 1, gold: 30 }), [hpot, cs, ch]);
      expect(decision).toBeNull();
    });
  });

  describe("upgrade buffer reserved (D-10)", () => {
    it("buys cs(100) when gold 200 leaves exactly the 100-gold buffer", () => {
      // 200 - 100 = 100 >= HEAL_BUFFER_GOLD (allowed); ch(300) is unaffordable.
      const decision = chooseShopPurchase(baseState({ lives: 3, gold: 200 }), [hpot, cs, ch]);
      expect(decision?.id).toBe("cs");
    });

    it("returns null when buying the cheapest upgrade would breach the buffer", () => {
      // gold 150: buying cs(100) leaves 50 (< 100 buffer) -> NO upgrade allowed.
      const decision = chooseShopPurchase(baseState({ lives: 3, gold: 150 }), [hpot, cs, ch]);
      expect(decision).toBeNull();
    });
  });

  describe("priciest affordable non-hpot (D-11)", () => {
    it("buys the priciest affordable upgrade (ch over cs) when surplus allows", () => {
      // gold 500: ch(300) leaves 200 (>= 100 buffer) and is priciest affordable.
      const decision = chooseShopPurchase(baseState({ lives: 3, gold: 500 }), [hpot, cs, ch]);
      expect(decision?.id).toBe("ch");
    });

    it("never selects hpot as an upgrade even when healthy and flush with gold", () => {
      const decision = chooseShopPurchase(baseState({ lives: 3, gold: 1000 }), [hpot, cs, ch]);
      expect(decision?.id).not.toBe("hpot");
      expect(decision?.id).toBe("ch");
    });
  });

  describe("nothing to buy", () => {
    it("returns null at full lives with zero gold", () => {
      expect(chooseShopPurchase(baseState({ lives: 3, gold: 0 }), [hpot, cs, ch])).toBeNull();
    });

    it("returns null when the only upgrade is unaffordable past the buffer (heal not needed)", () => {
      // lives 3 (no heal), gold 80: cs(100) > 80, so no upgrade clears even before
      // the buffer; hpot is never bought as an upgrade -> null.
      expect(chooseShopPurchase(baseState({ lives: 3, gold: 80 }), [hpot, cs])).toBeNull();
    });

    it("returns null on an empty shop list (never throws)", () => {
      expect(() => chooseShopPurchase(baseState({ lives: 1, gold: 500 }), [])).not.toThrow();
      expect(chooseShopPurchase(baseState({ lives: 1, gold: 500 }), [])).toBeNull();
    });
  });

  describe("purity (D-08..D-11)", () => {
    it("does not throw and does not mutate the state or the shop list", () => {
      const state = baseState({ lives: 3, gold: 500 });
      const shop = [hpot, cs, ch];
      const stateSnapshot = { ...state };
      const shopSnapshot = shop.map((item) => ({ ...item }));

      expect(() => chooseShopPurchase(state, shop)).not.toThrow();

      expect(state).toEqual(stateSnapshot);
      expect(shop).toEqual(shopSnapshot);
    });
  });
});

describe("applySolveResult (STRAT-06 / D-12)", () => {
  describe("merge carries `level` forward (a solve result omits it)", () => {
    it("keeps the prior state's `level` while adopting the solve result's fields", () => {
      // Prior state has a distinctive level (4) that the SolveResult cannot
      // carry (it has no `level` key). Every other field in the result differs
      // from the prior state, so a merge that drops one is caught.
      const prior = baseState({
        gameId: "g-merge",
        lives: 1,
        gold: 10,
        level: 4,
        score: 0,
        highScore: 0,
        turn: 2,
      });
      const result = baseSolve({
        lives: 5,
        gold: 250,
        score: 1200,
        highScore: 1500,
        turn: 9,
      });

      const merged = applySolveResult(prior, result);

      expect(merged.level).toBe(4); // carried forward from prior — SolveResult has no level
      expect(merged.lives).toBe(5);
      expect(merged.gold).toBe(250);
      expect(merged.score).toBe(1200);
      expect(merged.highScore).toBe(1500);
      expect(merged.turn).toBe(9);
      expect(merged.gameId).toBe("g-merge"); // gameId carried forward from prior
    });

    it("preserves any prior `level`, not just a fixed one", () => {
      const merged = applySolveResult(baseState({ level: 12 }), baseSolve());
      expect(merged.level).toBe(12);
    });
  });

  describe("purity (D-12)", () => {
    it("returns a NEW object, not the prior state reference", () => {
      const prior = baseState({ level: 4 });
      expect(applySolveResult(prior, baseSolve())).not.toBe(prior);
    });

    it("does not mutate the prior state object", () => {
      const prior = baseState({ level: 4, gold: 10, turn: 2 });
      const snapshot = { ...prior };

      applySolveResult(prior, baseSolve());

      expect(prior).toEqual(snapshot); // pure: prior state object never mutated
    });
  });
});

describe("applyBuyResult (STRAT-06 / D-12)", () => {
  describe("merge carries `score`/`highScore` forward (a buy result omits both)", () => {
    it("keeps the prior state's `score`/`highScore` while adopting the buy result's fields", () => {
      // Prior state has a distinctive score (700) and highScore (900) the
      // BuyResult cannot carry (it has neither key). gold/lives/level/turn all
      // differ, so a merge that drops one is caught.
      const prior = baseState({
        gameId: "g-buy",
        lives: 2,
        gold: 500,
        level: 1,
        score: 700,
        highScore: 900,
        turn: 3,
      });
      const result = baseBuy({
        gold: 80,
        lives: 4,
        level: 7,
        turn: 11,
      });

      const merged = applyBuyResult(prior, result);

      expect(merged.score).toBe(700); // carried forward — BuyResult has no score
      expect(merged.highScore).toBe(900); // carried forward — BuyResult has no highScore
      expect(merged.gold).toBe(80);
      expect(merged.lives).toBe(4);
      expect(merged.level).toBe(7);
      expect(merged.turn).toBe(11);
      expect(merged.gameId).toBe("g-buy"); // gameId carried forward from prior
    });

    it("restores the score the api.ts buy() placeholder zeroed (the STRAT-06 subtlety)", () => {
      // The threaded `score` lives only in the prior state; the BuyResult never
      // carries it. Merging into a prior state with score 700 must yield 700,
      // NOT the 0 that api.ts buy() writes for its standalone GameState shape —
      // otherwise the final reported score would be silently corrupted each buy.
      const merged = applyBuyResult(baseState({ score: 700, highScore: 900 }), baseBuy());
      expect(merged.score).toBe(700);
      expect(merged.highScore).toBe(900);
    });
  });

  describe("purity (D-12)", () => {
    it("returns a NEW object, not the prior state reference", () => {
      const prior = baseState({ score: 700, highScore: 900 });
      expect(applyBuyResult(prior, baseBuy())).not.toBe(prior);
    });

    it("does not mutate the prior state object", () => {
      const prior = baseState({ score: 700, highScore: 900, gold: 500, turn: 3 });
      const snapshot = { ...prior };

      applyBuyResult(prior, baseBuy());

      expect(prior).toEqual(snapshot); // pure: prior state object never mutated
    });
  });
});
