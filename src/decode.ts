/**
 * `decodeAd` — the pure, cross-field encryption-decode step (D-03).
 *
 * One `encrypted` flag governs THREE string fields (`adId`, `message`,
 * `probability`), so decoding is a cross-field operation kept SEPARATE from the
 * per-field zod validation in `api.ts`. This module is the cleanest place to
 * unit-test that logic in isolation.
 *
 * Contract (D-08 / D-09):
 *   - KNOWN scheme (`encrypted: 1` = Base64, `encrypted: 2` = ROT13): decode all
 *     three fields TOGETHER and CLEAR the `encrypted` flag.
 *   - UNKNOWN scheme (e.g. `3`), plaintext (`null`/`undefined`/`0`), or a decode
 *     FAILURE (corrupt Base64): return the ad UNCHANGED — never drop, never
 *     throw, never partially decode (all-three-fields-or-none, PITFALLS #1).
 *
 * Security (T-01-02 / T-01-03 / T-01-04): the decoded text is pure DATA — it is
 * never `eval`'d, never interpolated into a shell/template/URL here. Base64 is
 * regex-validated before decoding so a non-base64 string can't silently produce
 * a mis-decoded id. The function is pure and synchronous with no unbounded work,
 * so one corrupt ad can never crash the process.
 */

import type { Ad } from "./types.js";

const ENCRYPTED_BASE64 = 1;
const ENCRYPTED_ROT13 = 2;

/**
 * Well-formed Base64 (standard alphabet, optional `=` padding). Empty string is
 * accepted (decodes to ""). Anchored so a partial match can't slip garbage
 * through. Length being a multiple of 4 is enforced separately below.
 */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decode a standard-alphabet Base64 string, or return `undefined` if the input
 * is not well-formed Base64. Returning `undefined` (never throwing) is what lets
 * the caller honor the all-or-none guarantee.
 */
function decodeBase64(input: string): string | undefined {
  if (input.length % 4 !== 0 || !BASE64_RE.test(input)) {
    return undefined;
  }
  const decoded = Buffer.from(input, "base64").toString("utf-8");
  // Round-trip guard: Buffer.from is lenient with stray characters, so confirm
  // re-encoding reproduces the input before trusting the result.
  if (Buffer.from(decoded, "utf-8").toString("base64") !== input) {
    return undefined;
  }
  return decoded;
}

/**
 * ROT13: rotate ASCII letters by 13, preserving case; leave every non-letter
 * (digits, spaces, dots, punctuation) untouched. A pure string transform that
 * cannot fail — its own inverse, so the same function both encodes and decodes.
 */
function rot13(input: string): string {
  return input.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/**
 * A field decoder: returns the decoded string, or `undefined` to signal a
 * decode failure (so the caller can honor the all-or-none guarantee).
 */
type FieldDecoder = (input: string) => string | undefined;

/**
 * Pick the decoder for a scheme, or `undefined` for plaintext
 * (`null`/`undefined`/`0`) and unknown schemes — both of which pass through
 * unchanged.
 */
function decoderFor(encrypted: number | undefined | null): FieldDecoder | undefined {
  switch (encrypted) {
    case ENCRYPTED_BASE64:
      return decodeBase64;
    case ENCRYPTED_ROT13:
      // rot13 is total (cannot fail), but matches the FieldDecoder shape.
      return rot13;
    default:
      return undefined;
  }
}

/**
 * Decode an encrypted ad across all three string fields, or return it unchanged.
 *
 * Pure: returns a NEW `Ad` on success, the ORIGINAL reference on pass-through;
 * never mutates the input.
 */
export function decodeAd(ad: Ad): Ad {
  const decode = decoderFor(ad.encrypted);

  // Plaintext (null/undefined/0) or unknown scheme: pass through unchanged.
  if (decode === undefined) {
    return ad;
  }

  // Decode all three fields into locals FIRST; mutate nothing until every one
  // succeeds (all-three-fields-or-none — guards a half-decoded adId, T-01-04).
  const adId = decode(ad.adId);
  const message = decode(ad.message);
  const probability = decode(ad.probability);

  if (adId === undefined || message === undefined || probability === undefined) {
    // Any failure → return the ORIGINAL ad, still flagged (D-09).
    return ad;
  }

  // Success: a fresh ad with the three decoded fields and the flag cleared.
  return {
    ...ad,
    adId,
    message,
    probability,
    encrypted: 0,
  };
}
