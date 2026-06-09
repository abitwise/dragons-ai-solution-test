import { describe, expect, it } from "vitest";
import { decodeAd } from "./decode.js";
import type { Ad } from "./types.js";

/**
 * Test-only encoders used to BUILD fixtures (the inverse of what `decodeAd`
 * does). Keeping them here — not in `decode.ts` — proves `decodeAd` works
 * against independently-produced ciphertext rather than its own helper's output.
 */
function base64Encode(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function rot13(s: string): string {
  // ROT13 is its own inverse, so this same transform both encodes and decodes.
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/** A complete, plaintext baseline ad we mutate per case. */
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

describe("decodeAd", () => {
  describe("encrypted:1 (Base64)", () => {
    it("decodes adId, message, AND probability together and clears the flag", () => {
      // Verified live example from FEATURES.md line 105.
      const ad = baseAd({
        adId: base64Encode("ad-7/with+slash="),
        message: "SW5maWx0cmF0ZSBUaGUgSmFja2Fscy4uLg==",
        probability: "UmF0aGVyIGRldHJpbWVudGFs",
        encrypted: 1,
      });

      const decoded = decodeAd(ad);

      expect(decoded.adId).toBe("ad-7/with+slash=");
      expect(decoded.message).toBe("Infiltrate The Jackals...");
      expect(decoded.probability).toBe("Rather detrimental");
      // encrypted flag cleared on success (undefined or 0).
      expect(decoded.encrypted ?? 0).toBe(0);
      // Non-encoded fields are preserved unchanged.
      expect(decoded.reward).toBe(100);
      expect(decoded.expiresIn).toBe(3);
    });

    it("does not mutate the input ad", () => {
      const ad = baseAd({
        adId: base64Encode("xyz"),
        message: base64Encode("hello"),
        probability: base64Encode("world"),
        encrypted: 1,
      });
      const snapshot = { ...ad };

      decodeAd(ad);

      expect(ad).toEqual(snapshot);
    });
  });

  describe("encrypted:2 (ROT13)", () => {
    it("decodes all three fields together and clears the flag", () => {
      // Verified live example from FEATURES.md line 106.
      const ad = baseAd({
        adId: rot13("quest-42"),
        message: "Xvyy Frssben Cnefbaf...",
        probability: "Fhvpvqr zvffvba",
        encrypted: 2,
      });

      const decoded = decodeAd(ad);

      expect(decoded.adId).toBe("quest-42");
      expect(decoded.message).toBe("Kill Seffora Parsons...");
      expect(decoded.probability).toBe("Suicide mission");
      expect(decoded.encrypted ?? 0).toBe(0);
    });

    it("preserves case and leaves non-letters (spaces, dots, '...') untouched", () => {
      const ad = baseAd({
        adId: rot13("AbC-123"),
        message: rot13("Mix OF Case... 99!"),
        probability: rot13("Hmmm...."),
        encrypted: 2,
      });

      const decoded = decodeAd(ad);

      expect(decoded.adId).toBe("AbC-123");
      expect(decoded.message).toBe("Mix OF Case... 99!");
      expect(decoded.probability).toBe("Hmmm....");
    });
  });

  describe("plaintext ads", () => {
    it("returns an undefined-encrypted ad UNCHANGED", () => {
      const ad = baseAd();
      const decoded = decodeAd(ad);
      expect(decoded).toEqual(ad);
    });

    it("returns a null-encrypted ad UNCHANGED (wire sends null for plaintext)", () => {
      const ad = baseAd({ encrypted: null as unknown as number });
      const decoded = decodeAd(ad);
      expect(decoded.adId).toBe("abc123");
      expect(decoded.message).toBe("Help the villagers");
      expect(decoded.probability).toBe("Sure thing");
    });

    it("returns a zero-encrypted ad UNCHANGED", () => {
      const ad = baseAd({ encrypted: 0 });
      const decoded = decodeAd(ad);
      expect(decoded.adId).toBe("abc123");
      expect(decoded.message).toBe("Help the villagers");
      expect(decoded.probability).toBe("Sure thing");
    });
  });

  describe("unknown scheme (D-09 pass-through)", () => {
    it("returns encrypted:3 UNCHANGED with encrypted STILL 3", () => {
      const ad = baseAd({
        adId: "still-encoded",
        message: "do not touch",
        probability: "unknown",
        encrypted: 3,
      });

      const decoded = decodeAd(ad);

      expect(decoded).toEqual(ad);
      expect(decoded.encrypted).toBe(3);
    });
  });

  describe("corrupt input (D-09 no-throw, all-or-none)", () => {
    it("returns a non-base64 message UNCHANGED with encrypted STILL 1, no throw", () => {
      // '@@@@' is not valid Base64 — must be rejected by the regex guard.
      const ad = baseAd({
        adId: base64Encode("ok"),
        message: "@@@not-base64@@@",
        probability: base64Encode("fine"),
        encrypted: 1,
      });

      let decoded: Ad | undefined;
      expect(() => {
        decoded = decodeAd(ad);
      }).not.toThrow();

      // All-or-none: because ONE field failed, NONE are mutated.
      expect(decoded).toEqual(ad);
      expect(decoded?.encrypted).toBe(1);
      expect(decoded?.adId).toBe(base64Encode("ok"));
    });

    it("returns a corrupt adId UNCHANGED with encrypted STILL 1", () => {
      const ad = baseAd({
        adId: "not valid base64!",
        message: base64Encode("good"),
        probability: base64Encode("good"),
        encrypted: 1,
      });

      const decoded = decodeAd(ad);

      expect(decoded).toEqual(ad);
      expect(decoded.encrypted).toBe(1);
    });
  });

  describe("Hmmm.... round-trip (PITFALLS #6 string fragility)", () => {
    it("ROT13-decodes an encoded literal four-dot 'Hmmm....' back to exactly 'Hmmm....'", () => {
      const ad = baseAd({
        adId: rot13("id"),
        message: rot13("body"),
        probability: rot13("Hmmm...."),
        encrypted: 2,
      });

      const decoded = decodeAd(ad);

      expect(decoded.probability).toBe("Hmmm....");
    });
  });
});
