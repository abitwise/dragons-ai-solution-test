# Phase 1: Foundation — Types, API Client & Test Seam - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 1-Foundation — Types, API Client & Test Seam
**Areas discussed:** Boundary validation, Retry & idempotency, Fake client shape, Encryption contract (+ zod sub-decisions: decode composition, bad-payload handling)

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Boundary validation | zod vs hand-written narrow parser at the API edge | ✓ |
| Retry & idempotency | whether turn-consuming POSTs (/solve, /buy) auto-retry | ✓ |
| Fake client shape | scripted queue vs stateful in-memory simulator | ✓ |
| Encryption contract | drop vs pass-through-flagged on unknown/undecodable ads | ✓ |

**User's choice:** All four areas.
**Notes:** Carry-forwards already locked by PROJECT.md/research (6 flat files, ApiClient seam, decode-in-client, encodeURIComponent, reward coercion, non-www base URL, the stack) were explicitly NOT re-asked.

---

## Boundary validation

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-written narrow parser (recommended) | Small per-endpoint mapper; coerce `reward`, decode encryption, read needed fields; zero deps, fits "keep it simple" | |
| zod at the boundary | zod schemas per response; parse + normalize on every call; robust to API drift, adds a runtime dep | ✓ |
| You decide | Claude picks based on how mappers shape up | |

**User's choice:** zod at the boundary.
**Notes:** User **overrode** the recommended "keep it simple" hand-written option. Rationale endorsed: the API's verified quirks (string `reward`, HTML error bodies, free-text `probability`) make this the one clean spot for zod — exactly what STACK.md sanctions. zod stays out of the strategy core and loop.

## zod sub-decision — decode composition

| Option | Description | Selected |
|--------|-------------|----------|
| Validate shape, separate decoder (recommended) | zod parses raw shape with light coercion; a separate `decodeAd` step does cross-field Base64/ROT13 decode; independently testable | ✓ |
| Everything in zod transforms | reward coercion AND decryption inside zod `.transform()`; one-step parse, but cross-field decode is awkward and harder to test alone | |
| You decide | Claude keeps decode separate unless it reads better in-schema | |

**User's choice:** Validate shape, separate decoder.
**Notes:** `encrypted` typed as optional number (not strict 1|2 union) so unknown schemes pass validation.

## zod sub-decision — bad-payload handling

| Option | Description | Selected |
|--------|-------------|----------|
| Throw, not retried (recommended) | ZodError = malformed body → typed boundary error, bypasses retry, runner ends game cleanly; retry reserved for 5xx/network | ✓ |
| Retry on parse failure too | Treat parse failure as transient and retry; risks burning retries on a genuinely-changed schema | |
| You decide | Claude treats parse failures as terminal unless reason to retry | |

**User's choice:** Throw, not retried.

---

## Retry & idempotency

| Option | Description | Selected |
|--------|-------------|----------|
| Reads only; not solve/buy (recommended) | Retry GET messages/shop + POST start; transient failure on /solve or /buy surfaces to runner for clean end — never double-spends a turn | ✓ |
| Retry everything uniformly | One policy around every call (matches research sketch); simpler, but a lost-response retry on /solve could double-consume a turn / desync state | |
| You decide | Claude picks the safe-by-default policy | |

**User's choice:** Reads only; not solve/buy.

---

## Fake client shape

| Option | Description | Selected |
|--------|-------------|----------|
| Scripted/programmable (recommended) | Constructor takes per-method response queues; each test scripts exact responses (incl. a final lives:0 for game-over); no game logic in the double | ✓ |
| Stateful simulator | Fake models the game (decrements lives, ends at 0); loop tests read "real" but the double holds logic needing its own trust/testing — risks over-engineering | |
| You decide | Claude starts scripted, adds minimal state only if needed | |

**User's choice:** Scripted/programmable.

---

## Encryption contract

| Option | Description | Selected |
|--------|-------------|----------|
| Pass through flagged (recommended) | Client decodes known schemes & clears `encrypted`; unknown scheme/decode failure leaves flag set; strategy's STRAT-02 filter drops it; loop logs "skipped N"; eligibility stays in strategy | ✓ |
| Client drops them | Client silently omits undecodable ads; simpler but skip is invisible to logging and splits eligibility across client + strategy | |
| You decide | Claude keeps skip visible to logging unless it complicates the client | |

**User's choice:** Pass through flagged.

---

## Claude's Discretion

- Base URL config surface (constant vs `MUGLOAR_BASE_URL` env var) — must default to non-`www`.
- Error-type taxonomy/names (retryable transport vs terminal boundary/parse), backoff timing, class vs factory for `HttpApiClient`.
- Whether to add an optional `api.test.ts` (stub global `fetch`) for JSON-mapping/decode/retry coverage.
- zod schema organization (one per endpoint, co-located in `api.ts`).

## Deferred Ideas

None — discussion stayed within Phase 1 scope. v2 items (STRAT-07/08, RUN-01) and the `/investigate/reputation` endpoint remain out of scope per REQUIREMENTS.md.
