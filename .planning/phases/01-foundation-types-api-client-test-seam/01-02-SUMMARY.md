---
phase: 01-foundation-types-api-client-test-seam
plan: 02
subsystem: api
tags: [typescript, esm, vitest, tdd, decode, base64, rot13, encryption]

# Dependency graph
requires:
  - "01-01: src/types.ts — the Ad model (adId/message/probability/encrypted)"
provides:
  - "src/decode.ts — decodeAd(ad: Ad): Ad — pure cross-field Base64/ROT13 decode (all-three-fields-or-none)"
  - "Base64 + ROT13 field decoders; D-08/D-09 encrypted-ad contract honored (decode known, pass-through unknown/corrupt, never throw)"
  - "src/decode.test.ts — 11 RED→GREEN tests covering Base64, ROT13, plaintext, unknown scheme, corrupt input, all-or-none, Hmmm.... round-trip"
affects: [01-04-HttpApiClient, phase-2-strategy, phase-3-runner]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "decodeAd is a separate step from zod validation (D-03): one encrypted flag governs three fields, so the cross-field decode is unit-tested in isolation, not as a per-field zod transform"
    - "All-three-fields-or-none: decode into locals first; mutate nothing unless every field succeeds — guards a half-decoded adId (T-01-04)"
    - "Base64 regex-validated + round-trip-checked before trusting Buffer.from output (T-01-02); decoders return undefined on failure instead of throwing (T-01-03)"
    - "Pure module: new object on success, original reference on pass-through, never mutates input; no fetch/console/Date/Math.random"

key-files:
  created:
    - "src/decode.ts"
    - "src/decode.test.ts"
  modified: []

key-decisions:
  - "Base64 guard combines an anchored regex (standard alphabet + optional = padding), a length-multiple-of-4 check, AND a re-encode round-trip equality check — because Buffer.from('base64') is lenient and silently strips stray characters, so the regex alone is insufficient to reject corrupt input"
  - "Successful decode clears the encrypted flag to 0 (not undefined) — a concrete cleared value that the Phase-2 strategy filter can test uniformly; tests assert (encrypted ?? 0) === 0 so either 0 or undefined satisfies the contract"
  - "ROT13 is modeled as a total FieldDecoder (cannot fail) but kept in the same string|undefined-returning shape as Base64 so decodeAd's all-or-none logic is uniform across schemes"

# Metrics
duration: ~2 min
completed: 2026-06-09
---

# Phase 01 Plan 02: decodeAd — Cross-Field Base64/ROT13 Decode Summary

**`decodeAd(ad: Ad): Ad`, built test-first: a pure, all-three-fields-or-none decoder that decodes adId/message/probability together for known schemes (1=Base64, 2=ROT13) and clears the flag, while passing unknown schemes and corrupt payloads through UNCHANGED — never dropping, never throwing, never partially decoding (D-08/D-09, PITFALLS #1).**

## Performance

- **Duration:** ~2 minutes
- **Completed:** 2026-06-09
- **Tasks:** 3 TDD gates (RED test, GREEN implementation, REFACTOR)
- **Files modified:** 2 created (317 insertions)

## Accomplishments
- Wrote `src/decode.test.ts` FIRST and watched it fail (RED — module not found), then implemented `src/decode.ts` to green (GREEN), then refactored the scheme dispatch (REFACTOR) — full TDD discipline with three atomic gate commits
- Implemented the D-08/D-09 encrypted-ad contract exactly: KNOWN scheme (`encrypted:1`=Base64, `encrypted:2`=ROT13) decodes adId/message/probability TOGETHER and clears the flag; UNKNOWN scheme / corrupt Base64 / plaintext returns the ad UNCHANGED, still flagged, never throwing
- Enforced the all-three-fields-or-none guarantee (PITFALLS #1 / T-01-04): each field is decoded into a local first, and the ad is only rewritten if ALL three succeed — a half-decoded adId can never reach `/solve`
- Hardened Base64 against the silent-corruption footgun: an anchored regex + length check + re-encode round-trip equality, so a non-base64 string (e.g. `@@@`) is rejected rather than producing garbage that `Buffer.from` would otherwise emit (T-01-02)
- Covered all required cases with passing assertions, including the verified live FEATURES.md examples (`SW5maWx0cmF0ZSBUaGUgSmFja2Fscy4uLg==` → `Infiltrate The Jackals...`; `Xvyy Frssben Cnefbaf...` → `Kill Seffora Parsons...`) and the literal four-dot `Hmmm....` ROT13 round-trip (PITFALLS #6)
- Kept the module pure and offline: no fetch, no console, no Date/Math.random, no mutation of the input — 11 tests run with zero network calls

## Task Commits

Each TDD gate was committed atomically:

1. **RED — failing tests for decodeAd** — `38b675b` (test)
2. **GREEN — implement decodeAd cross-field Base64/ROT13 decode** — `592ee66` (feat)
3. **REFACTOR — extract decoderFor scheme lookup** — `1c95067` (refactor)

**Plan metadata:** docs commit (this SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified
- `src/decode.ts` — `decodeAd(ad: Ad): Ad`; private `decodeBase64` (regex + length + round-trip guarded, returns `undefined` on failure), `rot13` (case-preserving, non-letters untouched, total), and a `decoderFor` scheme switch. Imports only the `Ad` type from `./types.js`.
- `src/decode.test.ts` — 11 tests: Base64 (decode + no-mutation), ROT13 (decode + case/non-letter preservation), plaintext (undefined/null/0), unknown scheme (3 → unchanged, still 3), corrupt input (bad message and bad adId → unchanged, still 1, no throw), and the `Hmmm....` ROT13 round-trip. Uses test-only `base64Encode`/`rot13` fixture builders so decodeAd is exercised against independently-produced ciphertext.

## Decisions Made
- **Base64 validation is defense-in-depth, not a single regex.** `Buffer.from(s, "base64")` silently drops characters outside the Base64 alphabet, so a corrupt string can decode to plausible-but-wrong bytes. The guard therefore combines (a) an anchored `^[A-Za-z0-9+/]*={0,2}$` regex, (b) a length-multiple-of-4 check, and (c) a re-encode round-trip equality check, rejecting anything that doesn't reproduce the exact input. This is what makes the corrupt-input test pass without a throw.
- **Cleared flag is `0`, not `undefined`.** A concrete `encrypted: 0` after a successful decode gives the Phase-2 strategy filter a uniform value to test; tests assert `(encrypted ?? 0) === 0` so the contract is satisfied by either form.
- **ROT13 kept in the `string | undefined` decoder shape** even though it's total, so `decodeAd`'s all-or-none branch is identical for both schemes (no special-casing).

## Deviations from Plan
None — plan executed exactly as written. All cases enumerated in the plan's `<behavior>` block have a passing assertion; the contract (D-08/D-09), purity, and all-or-none guarantee match the `<implementation>` spec.

## Threat Surface
All surface introduced by this plan is covered by the plan's `<threat_model>` and mitigated:
- **T-01-02 (Tampering/Injection):** decoded text is treated as pure DATA — never eval'd, never interpolated into a shell/template/URL in decode.ts; Base64 is regex- + round-trip-validated before decode, so a garbage payload returns the ad unchanged rather than a mis-decoded id.
- **T-01-03 (DoS):** decodeAd never throws on bad input (all-or-none pass-through); pure synchronous function, no unbounded work — one corrupt ad cannot crash the process.
- **T-01-04 (Tampering — partial decode):** all-three-fields-or-none — a field that fails to decode leaves the entire ad untouched and still flagged, so a half-decoded adId is never emitted.

No new security-relevant surface beyond the threat register.

## Issues Encountered
None — RED failed for the right reason (module not found), GREEN passed on the first implementation, REFACTOR stayed green. `tsc --noEmit` and `biome check .` exited 0 at every gate.

## TDD Gate Compliance
PASS. Full RED→GREEN→REFACTOR sequence present in git log:
1. RED: `38b675b test(01-02): add failing tests for decodeAd` — failed because `./decode.js` did not exist yet (no false-positive pass; investigated and confirmed the RED reason)
2. GREEN: `592ee66 feat(01-02): implement decodeAd cross-field Base64/ROT13 decode` — 11/11 tests pass
3. REFACTOR: `1c95067 refactor(01-02): extract decoderFor scheme lookup` — behavior unchanged, tests still green

## Known Stubs
None — `decodeAd` is a complete, exercised pure function with no placeholder values, empty-default returns, or TODO/FIXME markers.

## User Setup Required
None.

## Next Phase Readiness
- `decodeAd` is ready for `01-04` (HttpApiClient): after zod validates the wire shape of `GET /messages`, the client maps each ad through `decodeAd` so decoded ads reach the strategy with the flag cleared and unhandled ads stay flagged for the Phase-2 filter (STRAT-02).
- API-05 is implemented (Base64 for `encrypted:1`, ROT13 for `encrypted:2`, across all three fields), satisfying ROADMAP success criterion 3 (partial): an encrypted ad is decoded across adId/message/probability before reaching any caller.

## Self-Check: PASSED
- FOUND: src/decode.ts
- FOUND: src/decode.test.ts
- FOUND commit 38b675b (RED), 592ee66 (GREEN), 1c95067 (REFACTOR)

---
*Phase: 01-foundation-types-api-client-test-seam*
*Completed: 2026-06-09*
