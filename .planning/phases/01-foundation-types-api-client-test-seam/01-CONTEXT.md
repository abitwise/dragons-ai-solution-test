# Phase 1: Foundation — Types, API Client & Test Seam - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the **shared types** and the **injectable `ApiClient` seam** — the
single decision that makes every later phase testable offline. Specifically:

- `types.ts` — all shared models and interfaces (`GameState`, `Ad`, `ShopItem`,
  `SolveResult`, `GameReport`, `ApiClient`, `Logger`), no logic.
- `api.ts` — the `ApiClient` interface + `HttpApiClient` (the only `fetch` caller),
  covering all 5 core endpoints (start / messages / solve / shop / buy), with retry,
  encryption decoding, `reward` coercion, URL-encoded path segments, and tolerant
  error-body handling.
- A hand-written `FakeApiClient` test double implementing `ApiClient`, so the suite
  passes with **zero live network calls**.

**In scope:** API-01..API-06 (start/state capture, fetch messages, solve, shop+buy,
encrypted-ad decode, real-world-quirk robustness). The TDD seam itself.

**Out of scope (other phases):** decision/strategy logic (Phase 2), the game loop &
shop *decisioning* (Phase 3), the logger implementation, CLI composition root, and the
live smoke run (Phase 4). No new capabilities beyond what API-01..06 scope.
</domain>

<decisions>
## Implementation Decisions

These are the gray areas resolved during discussion. Carry-forward decisions already
locked by PROJECT.md / research are listed under "Locked Carry-Forwards" below — do not
re-litigate them.

### Response validation at the API boundary
- **D-01:** Use **zod (4.x) at the `HttpApiClient` boundary** to validate/normalize every
  response. This is a deliberate, scoped runtime dependency at exactly one layer (the
  external-API edge), justified by the API's verified quirks: string-typed `reward`,
  HTML (non-JSON) error bodies, and free-text `probability`. *(User explicitly chose this
  over a hand-written parser — robustness at the edge was preferred over zero-dep
  minimalism. zod stays OUT of the strategy core and the loop.)*
- **D-02:** zod validates the **raw wire shape with light coercion only** — e.g.
  `z.coerce.number()` for `reward`; `encrypted` typed as an **optional number** (NOT a
  strict `1|2` union) so unknown schemes pass validation rather than throwing.
- **D-03:** **Encryption decoding lives in a separate `decodeAd` step**, NOT inside zod
  `.transform()`. zod validates shape → `decodeAd` does the cross-field Base64/ROT13
  decode. Rationale: the decryption is cross-field (one `encrypted` flag governs `adId`,
  `message`, AND `probability`), which is awkward in per-field zod transforms and harder
  to test in isolation. `decodeAd` is independently unit-testable.

### Error handling & retry policy
- **D-04:** **Retry-at-the-edge** (≈3 attempts, bounded backoff) applies to **idempotent
  reads only** — `GET messages`, `GET shop`, and `POST game/start` (safe to repeat; a
  failed start just yields a fresh game we haven't begun). Trigger retry on 5xx and
  network/transport errors.
- **D-05:** **`POST /solve` and `POST /buy` are NOT auto-retried.** They are
  turn-consuming and non-idempotent; a lost-response retry could double-spend a turn or
  desync `lives`/`gold`. A transient failure on these surfaces to the caller; the runner
  (Phase 3) ends the turn/game cleanly with a reason rather than retrying.
- **D-06:** A **zod validation failure is terminal, not transient.** A ZodError means a
  malformed/unexpected body (schema drift), so it **bypasses retry**, is wrapped as a
  typed boundary error, and bubbles to the runner for clean game-over. Retry stays
  reserved strictly for 5xx/network failures. (This implies a small error taxonomy:
  retryable transport errors vs. terminal boundary/parse errors — Claude's discretion on
  exact type names, see below.)

### FakeApiClient (the TDD seam's test double)
- **D-07:** The `FakeApiClient` is **scripted/programmable**, NOT a stateful game
  simulator. Its constructor takes per-method response queues (or functions); each test
  scripts exactly the responses it needs — including a final `lives: 0` solve result to
  drive Phase 3's "play to game-over" test. **No game logic lives inside the double**
  (the double itself never needs trusting/testing); tests stay explicit and
  deterministic.

### Encrypted-ad contract (client ↔ strategy boundary)
- **D-08:** The client **decodes known schemes** (`encrypted: 1` = Base64,
  `encrypted: 2` = ROT13) across all three fields (`adId`, `message`, `probability`) and
  **clears the `encrypted` flag** on success.
- **D-09:** On an **unknown scheme** (e.g. `3`) or a **decode failure** (e.g. corrupt
  Base64), the client **passes the ad through with its `encrypted` flag still set** — it
  does NOT drop or throw. Strategy's `STRAT-02` filter (Phase 2) then drops such ads, and
  the loop (Phase 3) can log "skipped N encrypted/unhandled ads". Rationale: eligibility
  filtering stays in ONE place (strategy), and the skip stays **visible to logging**
  rather than silently swallowed in the client.

### Claude's Discretion
The user said "you decide" implicitly on the following (recommended defaults already
encoded above) — Claude has flexibility on the mechanics:
- **Base URL config surface:** default to the non-`www` host
  (`https://dragonsofmugloar.com/api/v2`) and make it overridable (constant or
  `MUGLOAR_BASE_URL` env var). *Must* default to non-`www` — `www.` returned nginx 404s
  in live testing.
- **Error-type taxonomy / names:** the exact named types for "retryable transport error"
  vs. "terminal boundary/parse error", backoff timing (e.g. `attempt * 250ms`), and
  whether `HttpApiClient` is a class or a factory returning an object literal satisfying
  `ApiClient`.
- **`api.ts` test approach:** whether to add an optional `api.test.ts` that stubs global
  `fetch` for JSON-mapping/decode/retry coverage (lower priority than the strategy/loop
  tests, but the encrypted-ad and `encodeURIComponent` cases are worth a unit test —
  see PITFALLS #1/#2).
- **zod schema organization:** one schema per endpoint, co-located in `api.ts` (preferred
  over a separate file — keep it flat).

## Locked Carry-Forwards (already decided — do NOT re-ask)

From PROJECT.md, STATE.md, and the research docs:
- Architecture: **functional core / imperative shell**, six flat files under `src/`, no
  subfolders, **manual DI only** (no container), **no HTTP-mocking library** (no
  nock/msw).
- The `ApiClient` **interface** is the seam, declared in `types.ts`; production wires
  `HttpApiClient`, tests wire `FakeApiClient`. `HttpApiClient` is the **only** `fetch`
  caller. Consumers depend on the interface, never the impl.
- Encryption decode (Base64=`1`, ROT13=`2`) of **all three fields** happens in the
  client; `encodeURIComponent` on every path segment (esp. `adId`, which can contain
  `/ + =`); `reward` coerced to number at the boundary.
- `success` boolean in the body (not HTTP status) is the source of truth for a solve;
  non-2xx responses may be HTML, not JSON — handle without crashing.
- Solve/buy field asymmetry: solve responses omit `level`; buy responses omit `score` —
  state must be **merged**, not replaced (the merge itself is `applyResult`, Phase 2, but
  the typed models that make it possible are defined here).
- Stack: **Node 24 LTS / TypeScript 5.9 (NOT 6.0) / tsx / native `fetch` / Vitest /
  Pino+pino-pretty / Biome**; ESM (`"type": "module"`); `tsc --noEmit` for type-checking.
  zod 4.x is now confirmed as the one allowed runtime dep beyond Pino (per D-01).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & scope
- `.planning/ROADMAP.md` § "Phase 1: Foundation — Types, API Client & Test Seam" — the
  goal and the 5 success criteria this phase is judged against.
- `.planning/REQUIREMENTS.md` § "Game API Integration" — API-01..API-06, the exact
  requirements this phase implements.
- `.planning/PROJECT.md` — Core Value, constraints (TDD, keep-it-simple), and the
  endpoint/play-loop context.

### API surface, quirks & verification (HIGH value — read before coding the client)
- `.planning/research/FEATURES.md` — live-verified (2026-06-09) API surface: the 6
  endpoints, the 11 probability strings, both encryption variants, shop catalog, and the
  solve/buy field asymmetry. **Re-read the verification notes during task breakdown.**
- `.planning/research/PITFALLS.md` — the 5 critical pitfalls, esp. #1 (decode all three
  encrypted fields or none), #2 (`encodeURIComponent` the `adId` in the solve path), and
  #5 (`success` field vs HTTP status; HTML 400 bodies).
- `.planning/research/SUMMARY.md` — synthesis, build order, and the non-`www` base-URL
  caveat + `reward` coercion notes (see "Gaps to Address").

### Architecture & the seam
- `.planning/research/ARCHITECTURE.md` — the six-file layout, the `ApiClient` interface
  sketch, the `FakeApiClient` pattern, retry-at-the-edge sketch, and the dependency
  direction. Maps directly onto this phase's files.
- `.planning/research/STACK.md` — exact versions; the "inject the API client" decision;
  and the explicit note that zod is the ONE clean spot for boundary validation (now
  chosen — D-01).

*No user-authored external specs/ADRs were referenced during discussion; the research
docs above are the canonical sources.*
</canonical_refs>

<code_context>
## Existing Code Insights

Greenfield repo — **no `src/` exists yet**. There is no `package.json`/`tsconfig.json`
either, so Phase 1 also bootstraps project config. The "existing assets" are the research
sketches, which downstream planning should treat as starting points (not gospel — the
zod/idempotency decisions above refine them).

### Reusable Assets (to be created this phase, consumed by later phases)
- `types.ts` `ApiClient` interface — the seam every later phase depends on.
- `FakeApiClient` (scripted, per D-07) — drives all Phase 2–3 tests offline.
- Typed models (`GameState`, `Ad`, `ShopItem`, `SolveResult`, `GameReport`) — the
  vocabulary the whole codebase shares.

### Established Patterns (from ARCHITECTURE.md — to be honored)
- Functional core / imperative shell; `strategy.ts` imports only `types.ts`.
- Retry-at-the-edge inside `HttpApiClient` (refined by D-04/D-05: reads-only retry).
- `index.ts` is the only composition root (Phase 4) — Phase 1 wires nothing real.

### Integration Points
- `runner.ts ↔ api.ts` via the `ApiClient` interface (Phase 3 consumes the seam built here).
- `api.ts ↔ strategy.ts` via the **encrypted-ad pass-through contract** (D-08/D-09):
  client decodes what it can, leaves unhandled ads flagged for strategy's filter.
</code_context>

<specifics>
## Specific Ideas

- Add a unit test for a **`/`-containing `adId`** to prove `encodeURIComponent` prevents a
  400 on `/solve` (PITFALLS #2).
- The `Ad` model's `probability` should be typed as `string` (free text), not a strict
  union — unknown labels must be tolerated (the rank map is Phase 2's concern).
- `encrypted` on the wire is a number/optional; after `decodeAd`, a successfully-decoded
  ad has `encrypted` cleared (0/undefined) and an unhandled one retains its flag (D-09).
- Base URL **must** default to non-`www`; keep it a single configurable source (no
  duplication).
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 1 scope. Scope-adjacent items already parked in
REQUIREMENTS.md v2 (adaptive probability memory STRAT-07, reputation weighting STRAT-08,
multi-game runs RUN-01) and the `/investigate/reputation` endpoint remain out of scope
for v1.
</deferred>

---

*Phase: 1-Foundation — Types, API Client & Test Seam*
*Context gathered: 2026-06-09*
