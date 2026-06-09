---
phase: 01-foundation-types-api-client-test-seam
plan: 03
subsystem: test-seam
tags: [typescript, vitest, test-double, dependency-injection, offline-testing]

# Dependency graph
requires:
  - "01-01: src/types.ts ApiClient interface (the seam this double implements)"
provides:
  - "src/fake-api-client.ts — FakeApiClient: hand-written scripted double implementing ApiClient (D-07)"
  - "Per-method response queues OR functions; FIFO dequeue; fail-loud on exhausted/absent queue (T-01-06)"
  - "A scriptable lives:0 solve result — the game-over script Phase 3 depends on"
  - "Call recording (method + args) so tests can assert e.g. solve got the right adId"
  - "The offline test seam: Phases 2-3 wire FakeApiClient, not HttpApiClient — zero live network calls"
affects: [phase-2-strategy, phase-3-runner]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-written scripted test double (NO HTTP-mocking library — no nock/msw): the seam is the injected interface plus this double"
    - "Per-method response sources: array (FIFO queue) OR function(args) — scripted, not a stateful game simulator (D-07)"
    - "Fail-loud contract: Promise-returning methods reject (via async) with an Error naming the method on queue exhaustion/absence"

key-files:
  created:
    - "src/fake-api-client.ts"
    - "src/fake-api-client.test.ts"
  modified: []

key-decisions:
  - "FakeApiClient is scripted/programmable per D-07 — constructor takes one optional per-method source (array queue or function); NO game logic lives inside the double"
  - "A source can be a FIFO array (shift) OR a function receiving the call args, giving tests either pre-built queues or computed responses"
  - "Exhausted OR never-scripted queues throw an Error naming the method (T-01-06) so a mis-scripted test fails loudly instead of returning undefined"
  - "Methods are async so a fail-loud throw surfaces as a rejected promise (idiomatic Promise contract) rather than a synchronous throw [Rule 1 fix]"
  - "Optional call recording (calls: {method, args}[]) added so a test can assert solve was called with a specific adId — kept simple and opt-in"

requirements-completed: [API-01, API-02, API-03, API-04]

# Metrics
duration: ~15m
completed: 2026-06-09
---

# Phase 1 Plan 03: FakeApiClient — Scripted Offline Test Seam Summary

**Hand-written `FakeApiClient implements ApiClient` (no nock/msw): per-method scripted response queues or functions, FIFO dequeue, a scriptable `lives:0` game-over result, and a fail-loud throw naming the method on an exhausted queue — the offline double every Phase 2-3 test wires instead of `HttpApiClient`.**

## Performance

- **Duration:** ~15 minutes
- **Completed:** 2026-06-09
- **Tasks:** 2 (both `type="auto"`)
- **Files modified:** 2 created

## Accomplishments
- Created `src/fake-api-client.ts` — `FakeApiClient implements ApiClient`, the scripted test double (D-07). Its constructor takes one optional per-method source (`startGame`/`getMessages`/`solve`/`getShop`/`buy`), each either a FIFO array of pre-built return values or a function producing the value from the call's args.
- All five `ApiClient` methods implemented and return Promises; type-checked against the interface (`tsc --noEmit` exits 0).
- Fail-loud contract (T-01-06): a method whose queue is exhausted — or was never scripted — rejects with a clear `Error` naming the method, so a mis-scripted test fails obviously instead of returning `undefined`/garbage.
- Optional call recording (`calls: {method, args}[]`) so a test can assert e.g. `solve` was called with a specific `adId`, without putting any game logic in the double.
- Created `src/fake-api-client.test.ts` — 7 Vitest cases proving the mechanical contract only (the double has no game logic to test): FIFO order, a scriptable `lives:0` game-over `SolveResult`, startGame/getShop/buy scripted values, function sources receiving args, call recording, and loud failure on both exhausted and never-scripted queues. Fully offline.
- Confirmed the seam is the injected interface plus this hand-written double: NO HTTP-mocking library introduced; no `fetch`, no `console`, no network anywhere in either file.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement the scripted FakeApiClient implementing ApiClient** — `d29dd71` (feat)
2. **Task 2: Mechanical contract tests for FakeApiClient (offline)** — `69abf9b` (test; also carries the Rule 1 async fix to the impl)

**Plan metadata:** docs commit (this SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified
- `src/fake-api-client.ts` — `FakeApiClient implements ApiClient`; `FakeApiScript` (per-method source type) and `RecordedCall` exported types; per-method FIFO/function dequeue with fail-loud throw; no game logic, no I/O.
- `src/fake-api-client.test.ts` — Vitest mechanical-contract suite (7 cases), all fixtures plain typed objects, zero network, no log-string assertions.

## Decisions Made
- **Source = array OR function (D-07):** each per-method script field accepts either a FIFO array (dequeued via `shift`) or a function receiving the call's args. Arrays cover the common "queue these exact responses" case; functions cover "compute from the adId/itemId" without adding any stateful game simulation to the double.
- **Fail-loud on exhausted AND absent (T-01-06):** both an emptied queue and a never-provided method throw an `Error` whose message names the method, so the two failure modes are distinguishable and a mis-scripted test never silently returns `undefined`.
- **Methods are `async`:** so the fail-loud throw inside the shared `next` helper surfaces as a **rejected promise** — the idiomatic contract for a `Promise`-returning API — letting callers `await`/`.rejects` it instead of catching a synchronous throw.
- **Opt-in call recording:** `calls: {method, args}[]` is populated on every call but is purely for test assertions; it adds no behavior and keeps the double mechanical.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Promise-returning methods threw synchronously instead of rejecting**
- **Found during:** Task 2 (writing the exhausted-queue / never-scripted tests)
- **Issue:** The Task 1 implementation built each method as `return Promise.resolve(this.next(...))`. Because `this.next(...)` throws *before* `Promise.resolve` runs, an exhausted/absent queue produced a **synchronous throw** rather than a rejected promise — so `await client.solve(...)` could not be `.catch`'d as a normal async rejection, and `expect(...).rejects.toThrow(...)` failed. A `Promise`-returning API must reject, not throw synchronously.
- **Fix:** Marked all five methods `async` (`async startGame() { return this.next(...) }`), so any throw inside surfaces as a rejected promise — the idiomatic contract. The plan's acceptance criterion ("Calling a method with an exhausted/absent queue throws an Error whose message names the method") is satisfied as a promise rejection, which is how an async API surfaces a throw.
- **Files modified:** src/fake-api-client.ts
- **Verification:** `npx vitest run` 18/18 green (7 in this file); `npx tsc --noEmit` exits 0; `npx biome check .` clean.
- **Committed in:** 69abf9b (Task 2 commit)

---

**Total deviations:** 1 (Rule 1 async-rejection fix; no scope change)
**Impact on plan:** None to scope — the double's contract is unchanged (it still fails loud naming the method); the fix only ensures the failure is awaitable. ApiClient surface unchanged.

## Issues Encountered
None beyond the Rule 1 fix above. No HTTP-mocking library was needed or added; the seam is purely the injected interface plus this hand-written double, exactly as the locked carry-forward requires.

## TDD Gate Compliance
N/A for a strict RED-first cycle: `FakeApiClient` is **test infrastructure with no game logic to be trusted** (per D-07 and the plan, "it is plain — no TDD cycle"). It was implemented (Task 1), then its mechanical contract was characterized by tests (Task 2). The Task 2 tests immediately exposed a real impl bug (sync throw vs. rejection), which was fixed and re-verified — so the tests did their job as a safety net even outside a formal RED→GREEN gate.

## Known Stubs
None — `FakeApiClient` is a complete, working double. It intentionally contains NO game logic (that is by design per D-07, not a stub): each method returns exactly what the test scripts. There is no placeholder data, no hardcoded empty-return masquerading as behavior, and no unwired data source.

## Threat Flags
None — `FakeApiClient` performs no I/O, processes no untrusted input, and is never wired by the production composition root (index.ts, Phase 4, wires `HttpApiClient`). T-01-06 (silent `undefined` on mis-script) is mitigated: exhausted/absent queues fail loudly. No new security surface introduced.

## User Setup Required
None — no external service configuration.

## Next Phase Readiness
- The offline test seam is complete: Phase 2 (strategy) and Phase 3 (runner) wire `FakeApiClient`, not `HttpApiClient`, so their suites run with zero live network calls (ROADMAP success criterion 5 is now provable from this point forward).
- A `lives:0` `SolveResult` is proven scriptable, so Phase 3's "play to game-over" loop test has its driver.
- Remaining Wave 3 plan 01-04 (`HttpApiClient`) is independent of this double; it is the only `fetch` caller and is wired by production, not tests.

## Self-Check: PASSED

---
*Phase: 01-foundation-types-api-client-test-seam*
*Completed: 2026-06-09*
