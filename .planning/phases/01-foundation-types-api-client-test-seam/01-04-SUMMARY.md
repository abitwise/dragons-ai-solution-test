---
phase: 01-foundation-types-api-client-test-seam
plan: 04
subsystem: api
tags: [typescript, esm, vitest, tdd, zod, fetch, retry, http-client, encryption, boundary-validation]

# Dependency graph
requires:
  - phase: "01-01"
    provides: "src/types.ts — ApiClient interface + GameState/Ad/ShopItem/SolveResult/BuyResult models"
  - phase: "01-02"
    provides: "src/decode.ts — decodeAd(ad): pure cross-field Base64/ROT13 decode"
provides:
  - "src/api.ts — HttpApiClient implements ApiClient: the ONLY fetch caller in the codebase"
  - "Per-endpoint zod schemas (raw wire shape + light coercion): z.coerce.number() reward, encrypted optional-number tolerating unknown schemes (D-01/D-02)"
  - "Boundary error taxonomy: TransportError (retryable 5xx/network) vs BoundaryError (terminal non-2xx/parse/ZodError) (D-06)"
  - "Single request<T> helper: fetch + AbortSignal timeout + bounded retry-with-backoff for idempotent reads only; solve/buy never retried (D-04/D-05, T-01-07)"
  - "encodeURIComponent on every path segment (PITFALLS #2 / T-01-10); non-www base URL + MUGLOAR_BASE_URL override read once (T-01-08)"
  - "getMessages wires each validated ad through decodeAd (D-03); buy folds the buy result into a merged GameState"
  - "src/api.test.ts — 19 tests stubbing globalThis.fetch, zero live network"
affects: [phase-2-strategy, phase-3-runner, phase-4-cli]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Retry-at-the-edge inside HttpApiClient: reads (start/messages/shop) retry ~3x with bounded backoff; solve/buy NEVER auto-retry (turn-consuming, non-idempotent)"
    - "Boundary error taxonomy: a 5xx/network failure is a retryable TransportError; a non-2xx body / JSON-parse / ZodError is a terminal BoundaryError that bypasses retry"
    - "Single fetch call site (one request<T> helper) so every URL is built and encoded uniformly and no other module touches the network"
    - "zod validates the raw wire shape with light coercion only; decodeAd is a SEPARATE step AFTER validation (not a .transform)"
    - "Injectable backoff delay so the retry suite runs offline and instantly (vi.spyOn(globalThis, 'fetch') + noDelay)"

key-files:
  created:
    - "src/api.ts"
    - "src/api.test.ts"
  modified: []

key-decisions:
  - "Error taxonomy named TransportError (retryable) / BoundaryError (terminal); both extend Error with an optional status + cause"
  - "Constructor takes an options object { baseUrl?, delay? }; base-URL precedence is explicit option > MUGLOAR_BASE_URL env > non-www default, resolved ONCE at construction (never from a response)"
  - "Backoff is attempt * 250ms via an injected delay fn (real setTimeout in prod, no-op in tests); MAX_READ_ATTEMPTS = 3, REQUEST_TIMEOUT_MS = 10s"
  - "encrypted schema field typed z.number().nullish().transform(v => v ?? undefined) so a wire null normalizes to the Ad model's encrypted?: number"
  - "buy() returns a merged GameState with score/highScore defaulted to 0 (buy wire shape omits them); the cross-turn merge with prior score is applyResult's job (Phase 2)"

patterns-established:
  - "HttpApiClient is the single network egress; strategy/runner depend only on the ApiClient interface, never on fetch"
  - "Untrusted-response handling: non-2xx bodies read as TEXT (HTML-tolerant), never JSON.parse'd blindly; schema drift on a 2xx body is terminal and wrapped"

requirements-completed: [API-01, API-02, API-03, API-04, API-05, API-06]

# Metrics
duration: 4min
completed: 2026-06-09
---

# Phase 01 Plan 04: HttpApiClient — the only fetch caller Summary

**`HttpApiClient implements ApiClient` built test-first: the codebase's single `fetch` caller, with per-endpoint zod schemas (string `reward` coerced to number, `encrypted` an optional number), a TransportError/BoundaryError taxonomy, retry-at-the-edge for idempotent reads only (solve/buy never retry), `encodeURIComponent` on every path segment, a non-www base URL with `MUGLOAR_BASE_URL` override, HTML-error-body tolerance, `success`-as-a-body-field solve semantics, and `getMessages` wired through `decodeAd` — all green against a stubbed `globalThis.fetch` with zero live network.**

## Performance

- **Duration:** ~4 minutes
- **Started:** 2026-06-09T09:18:52Z
- **Completed:** 2026-06-09T09:23:25Z
- **Tasks:** 3 TDD gates (RED tests, GREEN implementation, REFACTOR)
- **Files modified:** 2 created (1 implementation + 1 test, ~340 + ~370 lines)

## Accomplishments
- Wrote `src/api.test.ts` FIRST and watched it fail (RED — `./api.js` not found), then implemented `src/api.ts` to green (GREEN, 19/19), then refactored the retry tail (REFACTOR) — full TDD discipline with three atomic gate commits, RED committed before GREEN
- Implemented `HttpApiClient` as the ONLY `fetch` caller: a single private `request<T>(method, path, schema, { retry })` helper builds the URL, applies an `AbortSignal.timeout`, and centralizes all HTTP/retry/parse/validate concerns so no other module ever touches the network (`grep -c 'fetch(' src/api.ts` === 1; decode/types/fake all clean)
- Per-endpoint zod schemas co-located at module scope (D-01): `reward` coerced via `z.coerce.number()`, `encrypted` typed as an optional number tolerating an unknown scheme (D-02), plus the solve/buy asymmetry (solve has score/no level; buy has level/no score)
- Boundary error taxonomy (D-06): `TransportError` for retryable 5xx/network failures, `BoundaryError` for terminal non-2xx bodies, JSON-parse failures, and ZodErrors — a ZodError on a 200 body bypasses retry (exactly one fetch) and bubbles to the caller
- Retry-at-the-edge (D-04/D-05): `startGame`/`getMessages`/`getShop` retry ~3 attempts with bounded `attempt * 250ms` backoff on 5xx/network; `solve`/`buy` are called with `retry: false` and surface immediately on the first failure (asserted single fetch call)
- `encodeURIComponent` on every path segment (PITFALLS #2 / T-01-10): a `solve("g1", "a/b+c=d")` produces a URL whose adId segment is `%2F`-encoded, proven by asserting on the URL string passed to the stubbed fetch
- `success`-as-a-body-field (PITFALLS #5): an HTTP 200 with body `{ success: false, ... }` resolves as a normal FAILED `SolveResult` (no throw), while `success: true` resolves as a successful one — the two differ only by the body field, never the status code
- Non-www base URL default (`https://dragonsofmugloar.com/api/v2`) with a `MUGLOAR_BASE_URL` env override read ONCE at construction (T-01-08); also an explicit `baseUrl` option for tests
- `getMessages` maps each schema-validated ad through `decodeAd` (a SEPARATE step after zod, D-03) so a handled `encrypted:1` ad arrives Base64-decoded with its flag cleared and an unknown scheme stays flagged for the Phase-2 filter
- Full suite green (37 tests across 3 files), `tsc --noEmit` clean, `biome check .` clean; zero live network calls; no forbidden HTTP lib (axios/got/ky/nock/msw) introduced

## Task Commits

Each TDD gate was committed atomically (RED before GREEN):

1. **RED — failing tests for HttpApiClient** — `837474d` (test)
2. **GREEN — implement HttpApiClient (zod boundary, retry-at-the-edge, decode integration)** — `d7d1613` (feat)
3. **REFACTOR — extract retryOrThrow in request helper; format** — `33082d9` (refactor)

**Plan metadata:** docs commit (this SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified
- `src/api.ts` — `HttpApiClient implements ApiClient`; module-scope zod schemas (gameStart/ad/messages/solve/shop/buy); `TransportError`/`BoundaryError` classes; the single private `request<T>` helper (only `fetch` call site) with AbortSignal timeout, bounded read-retry, HTML-tolerant non-2xx handling, and terminal ZodError wrapping; `seg`/`safeText`/`truncate` helpers. Imports `decodeAd` from `./decode.js` and the `ApiClient`/`GameState`/`Ad`/`ShopItem`/`SolveResult` types from `./types.js`.
- `src/api.test.ts` — 19 tests, each stubbing `globalThis.fetch` via `vi.spyOn` with an injected no-op `delay`: reward coercion, unknown-scheme tolerance, Base64 decode integration, encodeURIComponent of a `/`-containing adId + gameId, read-retry-on-5xx (messages/shop/startGame), retry-on-thrown-network-error, eventual TransportError when all attempts 5xx, no-retry for solve/buy, HTML-400-body → BoundaryError, ZodError-bypasses-retry, success-false/true SolveResult, buy → merged GameState, non-www default + env override + explicit baseUrl.

## Decisions Made
- **Error-type names:** `TransportError` (retryable 5xx/network) and `BoundaryError` (terminal non-2xx/parse/ZodError) — both extend `Error` with an optional `status` and `cause`. This was explicitly left to Claude's discretion in 01-CONTEXT.
- **Constructor surface:** an options object `{ baseUrl?, delay? }` rather than positional args, so tests can inject a no-op backoff and an explicit base URL without env mutation. Base-URL precedence: explicit option > `MUGLOAR_BASE_URL` > non-www default, resolved once and trailing-slash-trimmed.
- **Backoff is injectable** (`delay: (ms) => Promise<void>`, default `setTimeout`) so the retry suite runs instantly and offline; `attempt * 250ms`, `MAX_READ_ATTEMPTS = 3`, `REQUEST_TIMEOUT_MS = 10s`.
- **`encrypted` schema field** is `z.number().nullish().transform(v => v ?? undefined)` so a wire `null` (plaintext) normalizes to the `Ad` model's `encrypted?: number` shape (matching what `decodeAd` expects), rather than carrying a literal `null`.
- **`buy()` returns a merged GameState** with `score`/`highScore` defaulted to `0` because the buy wire shape omits them; the actual cross-turn merge against the prior score belongs to `applyResult` (Phase 2). The `ApiClient.buy(): Promise<GameState>` signature is honored exactly.

## Deviations from Plan
None — plan executed exactly as written. Every case enumerated in the plan's `<behavior>` (schemas/coercion, decode integration, URL encoding, retry policy, error taxonomy/HTML bodies, success-as-body-field, base URL) has a passing assertion, and the `<implementation>` spec (single `request<T>` helper, co-located schemas, retry-true reads / retry-false solve/buy, decode after zod, class implementing `ApiClient`, env-read-once base URL) was followed. The constructor options object and the two error-type names are within the plan's explicitly-granted "Claude's discretion" latitude (01-CONTEXT), not net-new scope.

## Threat Surface
All surface introduced by this plan is covered by the plan's `<threat_model>` and mitigated — no new endpoints, auth paths, or trust boundaries beyond the registered ones:
- **T-01-07 (DoS — retry loop / hung connection):** bounded retry (`MAX_READ_ATTEMPTS = 3`) with bounded `attempt * 250ms` backoff — no unbounded loop; a per-request `AbortSignal.timeout(10s)` caps a hung connection; solve/buy do not retry at all.
- **T-01-08 (SSRF — base-URL trust):** base URL defaults to the non-www host and is overridable ONLY via the `MUGLOAR_BASE_URL` env var (or an explicit constructor option), read ONCE at construction — never derived from an API response.
- **T-01-09 (Tampering/DoS — untrusted response):** non-2xx bodies are read as TEXT and wrapped as a `BoundaryError` (never JSON.parse'd blindly — HTML 400 bodies handled, asserted); a ZodError on a 2xx body is terminal and wrapped (schema drift surfaces cleanly); decoded ad text is delegated to the already-hardened `decodeAd`.
- **T-01-10 (Tampering — path injection):** `encodeURIComponent` on every path segment (gameId, adId, itemId), asserted for a `/`/`+`/`=`-containing adId.
- **T-01-SC (zod runtime dep):** accepted; no new package installs occurred in this plan (zod 4.4.3 was already installed and legitimacy-confirmed in Plan 01).

No security-relevant surface beyond the threat register.

## Issues Encountered
None — RED failed for the right reason (`./api.js` not found, no false-positive pass), GREEN passed 19/19 on the first implementation, and REFACTOR (extracting the duplicated retry-or-throw tail into a `retryOrThrow` closure) stayed green. The only post-write step was applying the Biome formatter (line-wrap only) to both files; `tsc --noEmit` exited 0 throughout.

## TDD Gate Compliance
PASS. Full RED→GREEN→REFACTOR sequence present in git log, RED committed before GREEN:
1. RED: `837474d test(01-04): add failing tests for HttpApiClient` — failed because `./api.js` did not exist yet (investigated and confirmed the RED reason; no false-positive pass)
2. GREEN: `d7d1613 feat(01-04): implement HttpApiClient with zod boundary, retry-at-the-edge, decode integration` — 19/19 tests pass
3. REFACTOR: `33082d9 refactor(01-04): extract retryOrThrow in request helper; format` — behavior unchanged, tests still green

## Known Stubs
None — `HttpApiClient` is a complete, exercised implementation. `buy()` defaults `score`/`highScore` to `0`, which is NOT a stub: the buy wire shape genuinely omits those fields and the cross-turn merge with the prior score is `applyResult`'s responsibility in Phase 2 (documented in `src/types.ts` and the Decisions section above). No placeholder text, empty-default returns that flow to a caller as game state, or TODO/FIXME markers.

## User Setup Required
None — no external service configuration required. The base URL defaults to the non-www host; an operator may optionally set `MUGLOAR_BASE_URL` to override it, but no setup is required for the test suite (which never hits the network) or for a default live run.

## Next Phase Readiness
- The full `ApiClient` seam now has BOTH implementations: production wires `HttpApiClient` (this plan), tests wire `FakeApiClient` (01-03). Phase 2 (strategy) and Phase 3 (runner) depend only on the `ApiClient` interface and are tested offline against the fake — they never import `HttpApiClient` or `fetch`.
- API-01..API-06 are all satisfied in this client (start/state, messages, solve, shop+buy, encrypted-ad decode, real-world-quirk robustness). The phase's five ROADMAP success criteria are met: typed models for all 5 endpoints; encrypted ad decoded across all three fields AND `/`-containing adId URL-encoded; transient failure retried with bounded backoff; HTML error body handled without a crash; string reward coerced to a number; and the offline test seam proven with zero live network calls.
- This is the FINAL plan of Phase 1 — the foundation (types, decode, fake seam, real client) is complete and ready for Phase 2.

## Self-Check: PASSED

---
*Phase: 01-foundation-types-api-client-test-seam*
*Completed: 2026-06-09*
