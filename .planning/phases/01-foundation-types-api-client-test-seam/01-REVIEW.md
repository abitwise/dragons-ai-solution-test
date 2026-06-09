---
phase: 01-foundation-types-api-client-test-seam
reviewed: 2026-06-09T12:45:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/types.ts
  - src/decode.ts
  - src/decode.test.ts
  - src/fake-api-client.ts
  - src/fake-api-client.test.ts
  - src/api.ts
  - src/api.test.ts
  - package.json
  - tsconfig.json
  - biome.json
  - .gitignore
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-09T12:45:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

This is a well-executed foundation phase. The code is genuinely TDD-driven (37 tests pass, `tsc --noEmit` is clean), the architecture honors the brief's constraints (api.ts is the only `fetch` caller, decode is a separate pure step, the `ApiClient` seam is injectable, no forbidden deps), and the security-relevant behaviors the phase called out are correctly implemented: `encodeURIComponent` on every path segment, base URL read once from operator-controlled sources only (SSRF guard), the `success` field treated as a body field rather than an HTTP error, retry restricted to idempotent reads, and HTML error bodies handled without a raw `JSON.parse` crash.

No blockers were found. The findings below are robustness and edge-case gaps that should be tightened before later phases build on top of this layer, plus a few quality items. The most material are: (1) a non-2xx-with-`success:false` body distinction that does not actually exist as a problem but a related empty/null reward coercion that silently produces `0`, (2) the empty-`gameId` path producing a malformed `//messages` URL, (3) a redundant Base64 length check, and (4) a couple of test-fixture/contract gaps.

I verified each finding by executing the relevant logic directly (zod coercion behavior, Base64 round-trip guard, URL assembly, backoff schedule) rather than reasoning about it on paper.

## Warnings

### WR-01: Empty/null `reward` silently coerces to `0` instead of being rejected as schema drift

**File:** `src/api.ts:103`
**Issue:** `reward: z.coerce.number()` is intended (per the comment at line 103 and D-02) to coerce a *string-typed numeric* wire value like `"100"` into `100`. I verified in zod v4 that `z.coerce.number()` does reject `"abc"` (NaN is guarded) — good. However it also silently maps `""` → `0` and `null` → `0`. So an ad whose `reward` arrives as an empty string or `null` (genuine schema drift / a malformed ad) is not surfaced as a `BoundaryError`; it becomes a `reward: 0` ad that the Phase 2 strategy will happily rank as worthless and may pick or skip incorrectly. The boundary's job is to reject malformed data, but here it manufactures a plausible-but-wrong value.
**Fix:** Constrain the coercion to genuine numeric inputs, e.g. accept only `number | numeric-string` and reject `null`/`""`:
```ts
reward: z.union([
  z.number(),
  z.string().regex(/^\d+(\.\d+)?$/).transform(Number),
]),
```
or, if you want to keep `z.coerce.number()`, add `.refine((n) => Number.isFinite(n))` and pre-reject `null`/`""` at the schema level so they raise a `BoundaryError` rather than degrading to `0`.

### WR-02: Empty `gameId` (or `itemId`/`adId`) produces a malformed double-slash URL with no guard

**File:** `src/api.ts:190, 200, 206, 211`
**Issue:** `getMessages("")` builds `/${seg("")}/messages` → `https://dragonsofmugloar.com/api/v2//messages` (verified). An empty or whitespace id is never validated before being interpolated into the path. While `encodeURIComponent("")` is `""` (no injection), the resulting `//messages` route is silently wrong and will yield a confusing 404/`BoundaryError` far from the real cause (a caller that passed an empty id). Because every method funnels ids straight into the path, a single upstream bug (e.g. a Phase 2 caller reading `gameId` from an unparsed field) produces a cryptic boundary failure instead of a clear "empty id" error.
**Fix:** Add a cheap guard in `seg()` or at each call site:
```ts
function seg(value: string): string {
  if (!value) throw new BoundaryError(`Empty path segment`);
  return encodeURIComponent(value);
}
```
This fails loud at the true source rather than after a round trip.

### WR-03: `decodeBase64` length check is dead/redundant relative to the round-trip guard, and the comment overstates its role

**File:** `src/decode.ts:41-49`
**Issue:** The function gates on `input.length % 4 !== 0` *and* the regex *and* a re-encode round-trip. The round-trip guard (`Buffer.from(decoded).toString("base64") !== input`) already rejects every input the length check would catch (a non-multiple-of-4 string can never equal a canonical re-encode), so the `% 4` check is redundant defensive code. That is not itself a bug, but the bigger concern is correctness of the round-trip guard for *legitimate* data: I verified it rejects valid Base64 that decodes to non-UTF-8 bytes (e.g. `//79` → `undefined`). For real Mugloar ad data (ASCII text) this never triggers, but the guard silently converts "valid Base64, non-UTF-8 payload" into a pass-through-still-flagged ad with no signal. If the API ever sends binary-ish encoded content, that ad is silently un-decodable forever.
**Fix:** Either drop the redundant `% 4` check (the round-trip guard subsumes it) to reduce surface area, or — if you keep belt-and-suspenders — document that the round-trip guard intentionally rejects non-UTF-8 payloads as "not text we can use," so a future reader doesn't treat a passed-through encrypted ad as a decode bug. Prefer keeping the guard but adding a one-line note at line 47 that non-UTF-8 decodes are deliberately rejected.

### WR-04: `FakeApiClient` function-source path does not `await` / normalize a returned Promise, diverging from the real client's always-async contract

**File:** `src/fake-api-client.ts:104-107`
**Issue:** When a source is a function, `next` returns `(source)(...args)` directly (line 107). The enclosing method is `async`, so a *synchronously-returned* value is auto-wrapped in a Promise — fine. But the `Source` type (`(...args) => TReturn`) and the cast only permit a synchronous return; a test author who writes an `async` function source (returning a `Promise<TReturn>`) gets a value typed as `TReturn` but actually a `Promise`, and downstream `.lives`/`.adId` access would be on a Promise. The double silently accepts a shape it cannot honor, so a mis-scripted async source fails confusingly rather than at the seam. Given the file's explicit "fail-loud" design goal (T-01-06), this is an inconsistency worth closing.
**Fix:** Either tighten the type to forbid async sources, or normalize by awaiting:
```ts
if (typeof source === "function") {
  return await (source as (...a: unknown[]) => SourceReturn<K>)(...args);
}
```
The `await` is harmless on sync returns and makes an accidental async source behave correctly.

## Info

### IN-01: `decodeAd` clears the flag to `0` while `decodeBase64("")` of an empty field is indistinguishable — minor model ambiguity

**File:** `src/decode.ts:119` / `src/types.ts:55`
**Issue:** On success the flag is set to `encrypted: 0`, but `Ad.encrypted` is `?: number` and consumers test `encrypted ?? 0`. Mixing `0` and `undefined` as "handled" is consistent in the current tests but invites a Phase 2 filter that checks `if (ad.encrypted)` (truthy) vs `if (ad.encrypted != null)` to diverge. Pick one sentinel.
**Fix:** Standardize on `encrypted: undefined` (delete the key) on success, or document that `0` is the canonical "handled" value and that all consumers must use `?? 0`.

### IN-02: Magic backoff/timeout/attempt constants are fine, but the first retry waits 250ms with no jitter

**File:** `src/api.ts:36-42, 254`
**Issue:** `attempt * BACKOFF_MS` means the first retry sleeps 250ms and the second 500ms (verified). For a CLI bot this is acceptable, but there is no jitter and `BACKOFF_MS`/`REQUEST_TIMEOUT_MS` are not injectable (only `delay` is). Tests inject `noDelay`, so this is purely a production-tuning note, not a correctness issue.
**Fix:** None required for v1. If retries ever hammer the live API, consider jitter; leave as-is otherwise.

### IN-03: `request<T>` has a documented-unreachable final `throw` — keep, but the `retryOrThrow` return value is ignored on the network path

**File:** `src/api.ts:269-273, 324`
**Issue:** On a thrown fetch, `await retryOrThrow(...)` is called but its `"retry"` sentinel is discarded and the loop relies on `continue`. This works (on the last attempt `retryOrThrow` throws), but the ignored return value makes the control flow slightly harder to verify than the 5xx path, which does the same. The final `throw` at line 324 is correctly labeled unreachable. No defect.
**Fix:** Optional: drop the `"retry"` return type from `retryOrThrow` (make it `Promise<void>`) since no caller uses it, removing a misleading affordance.

### IN-04: `tsconfig.json` `include` lists `src` and `**/*.test.ts` separately — test files under `src` are matched twice (harmless)

**File:** `tsconfig.json:12`
**Issue:** `"include": ["src", "**/*.test.ts"]` double-lists `src/*.test.ts` (already covered by `src`). Harmless today, but the second glob would also pull in any future root-level `*.test.ts` outside `src` into the typecheck, which may not be intended.
**Fix:** Narrow to `["src"]` if all tests live under `src/` (they currently do), or keep both intentionally and add a comment.

---

_Reviewed: 2026-06-09T12:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
