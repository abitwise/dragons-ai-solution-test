---
phase: 01-foundation-types-api-client-test-seam
verified: 2026-06-09T12:50:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 1: foundation-types-api-client-test-seam Verification Report

**Phase Goal:** The injectable `ApiClient` seam and all shared types exist, so every later phase can be developed and tested offline against a `FakeApiClient`; the real `HttpApiClient` talks to the live API correctly and never crashes on its quirks.
**Verified:** 2026-06-09T12:50:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The `ApiClient` interface is defined in `types.ts` and a hand-written `FakeApiClient` implements it, so the rest of the codebase depends on the interface, not on `fetch`. | VERIFIED | `src/types.ts:117` exports `interface ApiClient` with all 5 methods. `src/fake-api-client.ts:54` declares `class FakeApiClient implements ApiClient`. `src/api.ts:171` declares `class HttpApiClient implements ApiClient`. `tsc --noEmit` exits 0, confirming both satisfy the interface contract. `grep -rl 'fetch(' src --include='*.ts' | grep -v test` yields only `src/api.ts` — no other file touches fetch. |
| 2 | `HttpApiClient` can start a game, fetch messages, solve an ad, read the shop, and buy an item, returning typed models for each. | VERIFIED | All 5 `ApiClient` methods implemented in `src/api.ts` (lines 184–225). Per-endpoint zod schemas co-located at module scope (`gameStartSchema`, `messagesSchema`, `solveSchema`, `shopSchema`, `buySchema`). 19 tests in `src/api.test.ts` exercise every method against a stubbed `globalThis.fetch`; all 37 tests pass (`vitest run` exits 0). |
| 3 | An encrypted ad (`encrypted:1` Base64 or `encrypted:2` ROT13) is decoded across `adId`, `message`, and `probability` before it reaches any caller, and a `/`-containing `adId` is URL-encoded so `/solve` does not 400. | VERIFIED | `src/decode.ts` exports `decodeAd(ad: Ad): Ad` with all-three-fields-or-none guarantee (Base64 and ROT13, verified against FEATURES.md live examples). `src/api.ts:195` maps each validated ad through `decodeAd` after zod validation (D-03). `seg()` at `api.ts:329` wraps `encodeURIComponent` and is applied to every path segment (`api.ts:190,200,205,211`). Test `"encodes a /-, +-, =-containing adId so the solve URL segment is %2F-safe"` asserts the URL contains `%2F` with no raw `/`. 11 decode tests + 2 API encoding tests all pass. |
| 4 | A transient failure is retried with bounded backoff and a non-JSON (HTML) error body is handled without throwing an unhandled crash; a string `reward` is coerced to a number at the client boundary. | VERIFIED | Retry logic: `retry: true` for `startGame`/`getMessages`/`getShop` (max 3 attempts, `attempt * 250ms` backoff); `retry: false` for `solve`/`buy` (never retried). `safeText()` at `api.ts:334` reads non-2xx responses as TEXT before wrapping as `BoundaryError` — HTML never reaches `JSON.parse`. `z.coerce.number()` at `api.ts:103` coerces string `reward`. All 9 retry-policy and error-taxonomy tests pass, including: 3 retry tests (500+500+200 succeeds, network error retried, startGame retries), no-retry for solve/buy (single-fetch assertion), HTML-400 → BoundaryError, ZodError-bypasses-retry (single-fetch assertion), bounded TransportError when all attempts 5xx. |
| 5 | The test suite runs and passes with zero live network calls. | VERIFIED | `npx vitest run` exits 0, 37/37 tests pass in 172ms. Every test in `src/api.test.ts` stubs `globalThis.fetch` via `vi.spyOn` with no real HTTP. `src/decode.test.ts` and `src/fake-api-client.test.ts` perform no I/O. No nock/msw/axios in package.json. The injectable seam means Phase 2-3 tests will also wire `FakeApiClient`, not `HttpApiClient`. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | ESM manifest, engines node >=24, scripts, pinned deps | VERIFIED | `"type": "module"`, `engines.node >=24`, scripts: dev/start/test/test:watch/typecheck/lint. Runtime deps: zod^4.4.3, pino^10.3.1, pino-pretty^13.1.3. Dev deps: typescript~5.9 (5.9.3 installed), tsx^4.22.4, vitest^4.1.8, @biomejs/biome^2.4.16, @tsconfig/node24, @types/node. No forbidden deps. |
| `tsconfig.json` | extends @tsconfig/node24, noEmit true, strict | VERIFIED | Present, extends @tsconfig/node24, `noEmit: true`. `tsc --noEmit` exits 0. |
| `biome.json` | Biome 2.x lint+format config | VERIFIED | Present. `biome check .` exits 0 on 12 files. |
| `src/types.ts` | GameState, Ad, ShopItem, SolveResult, GameReport, ApiClient, Logger — no logic | VERIFIED | 136 lines. All 7 types present. `ApiClient` has 5 methods. `Logger` has debug/info/warn/error. No runtime imports (`import` keyword absent). `Ad.probability: string`, `Ad.encrypted?: number`. |
| `src/decode.ts` | `decodeAd` pure function, Base64/ROT13 helpers | VERIFIED | 122 lines. Exports `decodeAd(ad: Ad): Ad`. Imports only `Ad` type from `./types.js`. No fetch, no console, no mutation. |
| `src/decode.test.ts` | 11 tests: Base64, ROT13, plaintext, unknown, corrupt, Hmmm.... | VERIFIED | 11 tests present and all passing: Base64 decode+no-mutation, ROT13 decode+case/non-letter, plaintext (undefined/null/0), unknown scheme (encrypted:3), two corrupt-input tests, Hmmm.... round-trip. |
| `src/fake-api-client.ts` | `FakeApiClient implements ApiClient`, per-method queues | VERIFIED | 131 lines. `class FakeApiClient implements ApiClient`. Per-method FIFO arrays or function sources. Fail-loud on exhausted/absent queues (throws naming the method). Call recording. No fetch, no game logic. |
| `src/fake-api-client.test.ts` | 7 mechanical contract tests | VERIFIED | 7 tests: FIFO order, lives:0 game-over script, startGame/getShop/buy scripted, exhausted-queue throw, never-scripted throw, function source with args, call recording. All pass. |
| `src/api.ts` | `HttpApiClient implements ApiClient`, zod schemas, retry, error taxonomy, decode integration | VERIFIED | 346 lines (min_lines 80 — met). `class HttpApiClient implements ApiClient`. Per-endpoint zod schemas. `TransportError`/`BoundaryError` error classes. Single `request<T>` helper as the only `fetch` call site. `decodeAd` integrated in `getMessages`. `seg()` used on all path segments. |
| `src/api.test.ts` | 19 tests with stubbed globalThis.fetch, zero live network | VERIFIED | 19 tests: reward coercion, unknown-scheme tolerance, Base64 decode integration, encodeURIComponent (+2 tests), retry (4 read tests), no-retry (2 solve/buy tests), HTML BoundaryError, ZodError bypasses retry, success:false/true SolveResult, buy→GameState merge, base URL (3 tests). All pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/types.ts` | `ApiClient interface` | `export interface ApiClient` | WIRED | `types.ts:117` exports the interface |
| `src/fake-api-client.ts` | `src/types.ts` | `implements ApiClient` | WIRED | `import type { ..., ApiClient, ... } from "./types.js"` at line 27; `implements ApiClient` at line 54 |
| `src/decode.ts` | `src/types.ts` | imports the Ad type | WIRED | `import type { Ad } from "./types.js"` at line 23 |
| `src/api.ts` | `src/decode.ts` | `getMessages maps each ad through decodeAd` | WIRED | `import { decodeAd } from "./decode.js"` at line 29; `return ads.map(decodeAd)` at line 195 |
| `src/api.ts` | `src/types.ts` | implements ApiClient, returns typed models | WIRED | `import type { Ad, ApiClient, GameState, ShopItem, SolveResult } from "./types.js"` at line 30; `class HttpApiClient implements ApiClient` at line 171 |
| `HttpApiClient solve/buy` | URL path segments | `encodeURIComponent` via `seg()` | WIRED | `seg()` wraps `encodeURIComponent`; used at lines 190, 200, 205, 211 on every user-supplied segment |
| `HttpApiClient` | `global fetch` | single `request<T>` helper | WIRED | `fetch(url, ...)` at `api.ts:263` inside `request<T>` — the only call site; confirmed by `grep -c 'fetch(' src/api.ts` = 1 |
| `package.json` | `vitest + tsc + biome` | scripts block | WIRED | `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`, `"lint": "biome check --write ."` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| API-01 | 01-01, 01-03, 01-04 | Bot can start a new game and capture initial state | SATISFIED | `startGame(): Promise<GameState>` in ApiClient; zod `gameStartSchema` in api.ts; test "startGame is an idempotent read and retries on 5xx" passes |
| API-02 | 01-01, 01-03, 01-04 | Bot can fetch current ads with all fields | SATISFIED | `getMessages(): Promise<Ad[]>` in ApiClient; `adSchema` with adId/message/reward/expiresIn/encrypted/probability; tests pass |
| API-03 | 01-01, 01-03, 01-04 | Bot can solve a chosen ad and read its result | SATISFIED | `solve(): Promise<SolveResult>` in ApiClient; `solveSchema`; success-as-body-field tests pass |
| API-04 | 01-01, 01-03, 01-04 | Bot can fetch shop catalog and buy an item | SATISFIED | `getShop(): Promise<ShopItem[]>` and `buy(): Promise<GameState>` in ApiClient; `shopSchema` and `buySchema`; buy→GameState merge test passes |
| API-05 | 01-02, 01-04 | Bot decodes encrypted ads (Base64/ROT13) across adId, message, probability | SATISFIED | `decodeAd` in `src/decode.ts`; wired in `getMessages` via `ads.map(decodeAd)`; 11 decode tests + 1 integration test in api.test.ts; all pass |
| API-06 | 01-04 | API client is robust to real-world quirks | SATISFIED | URL encoding (seg/encodeURIComponent — tested); reward coercion (z.coerce.number — tested); HTML-body tolerance (safeText + BoundaryError — tested); retry-at-the-edge for reads, none for solve/buy — tested; AbortSignal.timeout for hung connections; ZodError terminal — tested |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No TBD/FIXME/XXX/TODO/PLACEHOLDER markers found in any modified source file. No return null/empty stubs. No hardcoded empty data masking real behavior. |

**Code review findings from 01-REVIEW.md (4 warnings, 4 info) — none are blockers for this phase:**

- WR-01: `z.coerce.number()` silently maps `""` / `null` to `0` rather than raising a BoundaryError — the intended behavior is string-typed numerics only. Warning: a malformed `reward` becomes a worthless ad instead of a schema drift error. Not a blocker because no real game data is processed yet and the Phase 2 strategy tolerates `reward: 0` ads (it filters by expected value).
- WR-02: Empty `gameId`/`adId`/`itemId` produces a malformed `//messages` URL with no early guard. Warning: will surface as a distant BoundaryError rather than a near "empty id" error. Not a blocker; callers in Phase 3 will always have a valid `gameId` from `startGame`.
- WR-03: `decodeBase64` length check is redundant relative to the round-trip guard. Info/warning: code smell only; no correctness defect; non-UTF-8 payloads are silently un-decodable (intentional for game data, which is ASCII text).
- WR-04: `FakeApiClient` function sources are typed as synchronous only; an async source would silently return a Promise object instead of the resolved value. Warning: a mis-scripted async source in a future test would fail confusingly. Not a blocker because all current tests use synchronous sources and the double is only used in tests.

These are documented quality items for the next iteration. None prevent the phase goal.

### Human Verification Required

None. All success criteria are verifiable by reading the code and running the offline tool chain. No visual output, real-time behavior, or external service integration is involved in this phase.

### Gaps Summary

No gaps. All five success criteria verified against the actual codebase:

1. `ApiClient` interface and `FakeApiClient` confirmed in source and type-checked — `tsc --noEmit` exits 0.
2. `HttpApiClient` five methods verified in source with per-endpoint zod schemas; 19 tests pass against stubbed fetch.
3. `decodeAd` cross-field decode confirmed in `src/decode.ts`; wired via `getMessages → ads.map(decodeAd)`; `encodeURIComponent` on every segment confirmed.
4. Retry, HTML-body tolerance, and reward coercion all confirmed in source and tested.
5. `npx vitest run` exits 0, 37/37 tests pass, zero live network calls — fetch is only called inside `src/api.ts` with every test file stubbing `globalThis.fetch`.

---

_Verified: 2026-06-09T12:50:00Z_
_Verifier: Claude (gsd-verifier)_
