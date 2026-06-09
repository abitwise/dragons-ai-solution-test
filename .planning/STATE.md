---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-06-09T14:30:01.610Z"
last_activity: 2026-06-09 -- Phase 02 planning complete
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 9
  completed_plans: 8
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-09)

**Core value:** The bot autonomously plays a full game of Dragons of Mugloar to completion and reports its final score — driven by a simple, correct, well-tested decision loop.
**Current focus:** Phase 02 — strategy-core-pure-decision-logic-tdd

## Current Position

Phase: 02 (strategy-core-pure-decision-logic-tdd) — EXECUTING
Plan: 4 of 4
Status: Ready to execute
Last activity: 2026-06-09 -- Phase 02 planning complete

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 4
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01-01 | 5 | 3 tasks | 5 files |
| Phase 01 P01-02 | 2 | 3 tasks | 2 files |
| Phase 01 P01-03 | 15 | 2 tasks | 2 files |
| Phase 01 P01-04 | 4 | 3 tasks | 2 files |
| Phase 02 P01 | 3 | 2 tasks | 2 files |
| Phase 02 P02 | 2min | 2 tasks | 2 files |
| Phase 02 P03 | 2min | 2 tasks | 2 files |
| Phase 02 P04 | 3min | 2 tasks tasks | 2 files files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Architecture: Functional core / imperative shell — six flat source files under `src/`, no subfolders, manual DI only (no container, no HTTP-mocking library).
- Phase 1: Define the injectable `ApiClient` interface first — it is the TDD seam that lets Phases 2-3 be tested offline against a `FakeApiClient`.
- Phase 1: Encryption decoding (Base64 for `1`, ROT13 for `2`) and `encodeURIComponent` on path segments live in the API client, where raw JSON is first touched.
- Phase 2: TDD coverage (TEST-01) attaches here, where the bulk of testable logic lands; no separate test-only phase.
- [Phase ?]: Phase 1: ApiClient interface defined as the injectable TDD seam in types.ts; consumers depend on the interface, never on fetch.
- [Phase ?]: Phase 1: Pinned TypeScript to ~5.9 (5.9.3); TS 6.0 excluded per CLAUDE.md. Ad.probability is free-text string and Ad.encrypted is optional number (D-02).
- [Phase ?]: Phase 1 (01-02): decodeAd is a separate pure step from zod (D-03); decodes all three fields or none (D-08/D-09); Base64 guarded by regex + length + round-trip re-encode to defeat Buffer.from leniency; cleared flag is 0.
- [Phase ?]: Phase 1 (01-03): FakeApiClient is a scripted/programmable double (D-07) — per-method array queue OR function source; NO game logic inside; exhausted/absent queue rejects with an Error naming the method (T-01-06).
- [Phase ?]: Phase 1 (01-03): ApiClient double methods are async so a fail-loud throw surfaces as a rejected promise; the offline test seam (FakeApiClient, not HttpApiClient) is what Phases 2-3 wire — zero live network calls, no nock/msw.
- [Phase 01]: Phase 1 (01-04): HttpApiClient is the only fetch caller; single request<T> helper centralizes URL build/encode, AbortSignal timeout, retry, parse+validate
- [Phase 01]: Phase 1 (01-04): error taxonomy TransportError (retryable 5xx/network) vs BoundaryError (terminal non-2xx/parse/ZodError); reads retry ~3x bounded backoff, solve/buy never retry (D-04/D-05/D-06)
- [Phase 01]: Phase 1 (01-04): base URL non-www default + MUGLOAR_BASE_URL read once at construction (T-01-08); encodeURIComponent every path segment (PITFALLS #2); getMessages decodes via decodeAd after zod (D-03); success is a body field not HTTP status (PITFALLS #5)
- [Phase ?]: Phase 2 (02-01): strategy.ts is pure functional core — imports ONLY types.js via import type (no fetch/zod/pino/ApiClient); rankProbability and filterEligibleAds never throw
- [Phase ?]: Phase 2 (02-01): rank via exact-string Record lookup with ?? 0 (unknown->worst); integer ranks 0-10 from FEATURES.md are the EV weighting (D-01), not percentages; PROBABILITY_FLOOR_RANK = 6
- [Phase ?]: Phase 2 (02-01): eligibility filter drops expired/sub-floor/still-encrypted ads in one place, returns a new array; !ad.encrypted means undecodable per decode.ts clearing flag to 0 (D-02/D-03/D-09)
- [Phase ?]: Phase 2 (02-02): chooseAd returns Ad | null (null = no-ad signal the runner branches on); selection via one comparator preferAd folded by reduce (bestOf): EV desc -> expiresIn asc -> reward desc (D-04/D-05/D-07)
- [Phase ?]: Phase 2 (02-02): least-bad-gamble fallback relaxes ONLY the floor (ads.filter expiresIn>0 && !encrypted); never selects an expired or still-encrypted ad that would 400 (D-06/PITFALLS #2); reuses Plan 01 filterEligibleAds+rankProbability verbatim, no rank-table duplication
- [Phase ?]: Phase 2 (02-03): chooseShopPurchase(state, shop) is one function (heal-or-upgrade-or-none); heal branch returns early when lives below MAX_LIVES_TO_KEEP=3, gating the upgrade branch on healthy lives not on heal-not-bought (D-08/D-09)
- [Phase ?]: Phase 2 (02-03): upgrade reserves HEAL_BUFFER_GOLD=100 (cost <= gold - 100) and picks the priciest affordable non-hpot via reduce (D-10/D-11); all costs read LIVE from the shop (no hardcoded 50/100/300), proven by a 70-cost-hpot test that does not heal at gold 60
- [Phase 02]: Phase 2 (02-04): two pure merge helpers applySolveResult/applyBuyResult complete the decision core (D-12) — spread the prior state first then override only result-provided fields, so a solve carries level forward and a buy carries score/highScore forward
- [Phase 02]: Phase 2 (02-04): applyBuyResult consumes the RAW BuyResult (not api.ts's partial GameState), so the api.ts score:0/highScore:0 placeholder can never reach the threaded final score; strategy.ts is now feature-complete (STRAT-01..06), still types-only import

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- Base URL must default to the non-`www` host (`https://dragonsofmugloar.com/api/v2`) and be configurable — `www.` returned nginx 404s in live testing (research SUMMARY.md).

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-09T13:40:30.352Z
Stopped at: Completed 02-01-PLAN.md
Resume file: None
