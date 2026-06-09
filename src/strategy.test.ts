import { describe, expect, it } from "vitest";
import { filterEligibleAds, rankProbability } from "./strategy.js";
import type { Ad } from "./types.js";

/**
 * Pure-function suite for the strategy core (Plan 02-01).
 *
 * Proves the first two responsibilities of `strategy.ts`:
 *   - `rankProbability` (STRAT-01 / D-01): every one of the 11 verified labels
 *     maps to its exact integer rank 0–10, the exact four-dot `"Hmmm...."`
 *     maps to 6, and an unknown label ranks worst (0) without ever throwing.
 *   - `filterEligibleAds` (STRAT-02 / D-02 / D-03): drops expired, sub-floor
 *     (rank < 6), and still-encrypted ads in one place, returning a new array
 *     and never mutating its input.
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
