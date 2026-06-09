---
phase: 01-foundation-types-api-client-test-seam
plan: 01
subsystem: api
tags: [typescript, esm, vitest, biome, pino, zod, tsx, node24]

# Dependency graph
requires: []
provides:
  - "ESM TypeScript project skeleton (package.json, tsconfig.json, biome.json, .gitignore) on Node 24 LTS / TS 5.9"
  - "src/types.ts — shared models (GameState, Ad, ShopItem, SolveResult, BuyResult, GameReport) with zero logic"
  - "ApiClient interface — the single injectable TDD seam every later phase depends on"
  - "Logger interface — leveled debug/info/warn/error contract"
  - "Toolchain proven green: tsc --noEmit, vitest discovery, biome check all exit 0"
affects: [01-02-decodeAd, 01-03-FakeApiClient, 01-04-HttpApiClient, phase-2-strategy, phase-3-runner, phase-4-cli]

# Tech tracking
tech-stack:
  added:
    - "zod@4.4.3 (runtime deps)"
    - "pino@10.3.1, pino-pretty@13.1.3"
    - "typescript@5.9.3 (pinned ~5.9, NOT 6.x)"
    - "tsx@4.22.4, vitest@4.1.8, @biomejs/biome@2.4.16, @tsconfig/node24@24.0.4, @types/node@25.9.2"
  patterns:
    - "Injectable ApiClient interface as the TDD seam — consumers depend on the interface, never on fetch"
    - "types.ts is the leaf of the dependency graph: declarations only, zero runtime imports"
    - "Solve/buy field asymmetry modeled so state merges (solve omits level, buy omits score)"

key-files:
  created:
    - "package.json"
    - "tsconfig.json"
    - "biome.json"
    - ".gitignore"
    - "src/types.ts"
  modified: []

key-decisions:
  - "Pinned typescript to ~5.9 (5.9.3 installed); TS 6.0 deliberately excluded per CLAUDE.md"
  - "Ad.probability typed as plain string (free text), NOT a string-literal union, so unknown labels type-check"
  - "Ad.encrypted typed as optional number (encrypted?: number), NOT a strict 1|2 union (D-02)"
  - "Added a named BuyResult type to model the buy wire shape (level, no score) — mirror of SolveResult — making independent level/score merge possible"

patterns-established:
  - "Injectable ApiClient interface: the single seam; production wires HttpApiClient, tests wire FakeApiClient, no HTTP-mocking library"
  - "Leaf types module: src/types.ts holds shared vocabulary + interfaces with no logic and no runtime imports"

requirements-completed: [API-01, API-02, API-03, API-04]

# Metrics
duration: ~continuation (prior executor ran Tasks 1-2; this agent finished Task 3 + finalization)
completed: 2026-06-09
---

# Phase 1 Plan 01: Foundation — Types, API Client & Test Seam Summary

**ESM TypeScript skeleton (Node 24 / TS 5.9 / tsx / Vitest / Biome) plus src/types.ts defining the injectable `ApiClient` and `Logger` interfaces and all shared models with zero logic — the leaf every later phase imports.**

## Performance

- **Duration:** Continuation finalization (Tasks 1–2 by prior executor; Task 3 checkpoint + finalize here)
- **Completed:** 2026-06-09
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 5 created

## Accomplishments
- Bootstrapped a real, installable ESM TypeScript project: `"type": "module"`, `engines.node >=24`, scripts (dev/start/test/test:watch/typecheck/lint), real `npm install` with a lockfile and node_modules
- Defined `src/types.ts` — the dependency-graph leaf — with `GameState`, `Ad`, `ShopItem`, `SolveResult`, `BuyResult`, `GameReport`, the `ApiClient` interface (startGame/getMessages/solve/getShop/buy), and the `Logger` interface; no logic, no runtime imports
- Established the injectable `ApiClient` seam so Phases 2–4 can be developed and tested offline against a `FakeApiClient`, never against `fetch`
- Passed the supply-chain trust checkpoint (T-01-SC): human verified the installed dependency set, TypeScript 5.9.x, and the types.ts contract before any downstream plan builds on it

## Task Commits

Each task was committed atomically:

1. **Task 1: Bootstrap ESM TypeScript project (manifest, tsconfig, biome, deps)** — `e84ae48` (chore)
2. **Task 2: Define shared models + ApiClient/Logger interfaces in types.ts** — `44ffdcc` (feat)
3. **Task 3: Checkpoint — verify installed dependency set (supply-chain trust T-01-SC)** — human-approved gate (no code commit; verification-only)

**Plan metadata:** docs commit (this SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified
- `package.json` — ESM manifest, engines node >=24, scripts block, pinned runtime + dev deps
- `tsconfig.json` — extends @tsconfig/node24, `noEmit: true`, strict type-checking
- `biome.json` — Biome 2.x lint + format config
- `.gitignore` — node_modules/, dist/, editor/OS noise
- `src/types.ts` — GameState, Ad, ShopItem, SolveResult, BuyResult, GameReport, ApiClient, Logger (declarations only)

## Decisions Made
- Pinned `typescript` to `~5.9` (5.9.3 installed); TS 6.0.3 deliberately excluded per CLAUDE.md (transition release, largest breaking-change set since 2.0 — pure churn for a greenfield project)
- `Ad.probability` typed as plain `string` (free text), not a string-literal union, so an unknown/new label still type-checks (the rank lookup in Phase 2 treats unknown labels as worst rather than crashing)
- `Ad.encrypted` typed as optional number (`encrypted?: number`), not a strict `1 | 2` union (D-02), so unknown schemes validate rather than throw

## Deviations from Plan

**1. [Rule 2 — Missing Critical (modeling completeness)] Added a named `BuyResult` type**
- **Found during:** Task 2 (types.ts)
- **Issue:** The plan said "Declare a buy-result-shaped type if helpful" and described the raw buy wire shape (`shoppingSuccess`, `gold`, `lives`, `level`, `turn`, NO `score`). Leaving this implicit would make the solve/buy merge asymmetry (solve omits `level`, buy omits `score`) harder to model correctly in Phase 2.
- **Fix:** Declared an explicit `BuyResult` interface mirroring `SolveResult`, documenting that `api.ts` folds it into a merged `GameState` (the `ApiClient.buy` method returns `GameState`). This is within the plan's explicit allowance, not net-new scope.
- **Files modified:** src/types.ts
- **Verification:** `tsc --noEmit` exits 0; `ApiClient.buy(): Promise<GameState>` signature unchanged.
- **Committed in:** 44ffdcc (Task 2 commit)

---

**Total deviations:** 1 (named BuyResult type, explicitly permitted by plan wording)
**Impact on plan:** Improves merge correctness for Phase 2; no scope creep. ApiClient surface unchanged.

## Issues Encountered
None — the prior executor's Tasks 1–2 commits were present and clean; final verification (tsc 5.9.3 / vitest 4.1.8 discovery / biome 6 files clean) re-confirmed green on the first pass.

## TDD Gate Compliance
N/A — this is a `type: execute` plan creating only config + type declarations (no runtime logic, no behavior to test). TDD coverage attaches in Phase 2 where the testable logic lands (per ROADMAP / TEST-01).

## Known Stubs
None — `src/types.ts` contains only finished interface/type declarations. `index.ts` is intentionally absent (Phase 4 scope); package.json scripts may reference it ahead of time, which is expected and documented in the plan.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- The `ApiClient` and `Logger` interfaces and all shared models are in place and compile clean — Wave 2 plans (01-02 decodeAd, 01-03 FakeApiClient) and Wave 3 (01-04 HttpApiClient) can now import `src/types.ts`.
- Toolchain proven: `tsc --noEmit`, `vitest run` (discovery confirmed), and `biome check .` all exit 0.
- Carry-forward blocker for Plan 04: base URL must default to the non-`www` host (`https://dragonsofmugloar.com/api/v2`) — `www.` returned nginx 404s in live testing.

## Self-Check: PASSED

---
*Phase: 01-foundation-types-api-client-test-seam*
*Completed: 2026-06-09*
