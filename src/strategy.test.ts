import { describe, expect, it } from "vitest";
import { chooseAd, filterEligibleAds, rankProbability } from "./strategy.js";
import type { Ad } from "./types.js";

/**
 * Pure-function suite for the strategy core (Plans 02-01, 02-02).
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
