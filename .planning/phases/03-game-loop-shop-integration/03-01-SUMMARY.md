---
phase: 03-game-loop-shop-integration
plan: 01
subsystem: api
tags: [orchestrator, imperative-shell, vitest, tdd, fake-api-client, game-loop]

# Dependency graph
requires:
  - phase: 01-foundation-types-api-client-test-seam
    provides: ApiClient/Logger interfaces, GameState/Ad/ShopItem/SolveResult/BuyResult/GameReport types, FakeApiClient scripted double
  - phase: 02-strategy-core-pure-decision-logic-tdd
    provides: chooseAd, chooseShopPurchase, applySolveResult, applyBuyResult pure decision functions
provides:
  - "playGame(api, logger) orchestrator — the fetch->decide->act->update->log core loop (imperative shell)"
  - "Per-iteration shop-phase drain (D-01/D-02): buys folded via applyBuyResult, stops on null OR shoppingSuccess:false"
  - "Fresh getMessages after the shop phase, immediately before chooseAd (D-03/LOOP-03)"
  - "State threaded exclusively through the merge helpers (D-04) — score never zeroed by a buy"
  - "END reason vocabulary + MAX_TURN/NO_PROGRESS_LIMIT constants (TURN_CAP/NO_PROGRESS declared for 03-02)"
affects: [03-02 (termination guards + error propagation), 04 (index.ts CLI composition root, Logger impl, exit codes)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Imperative shell: the only module that sequences I/O and threads game progression; delegates all decisions to pure strategy fns"
    - "Fold-never-assign state threading: every transition goes through applyBuyResult/applySolveResult"
    - "drainShop helper extracted to keep playGame readable"

key-files:
  created:
    - src/runner.ts
    - src/runner.test.ts
  modified: []

key-decisions:
  - "Extracted the shop-phase inner loop into a private drainShop(api, state) helper returning the updated state, keeping playGame readable (plan-sanctioned refactor, done inline during GREEN)."
  - "MAX_TURN / NO_PROGRESS_LIMIT declared with biome-ignore suppression comments documenting they are wired by plan 03-02's guards; TURN_CAP/NO_PROGRESS live in the END const object (no unused-warning since object members)."

patterns-established:
  - "Imperative shell / functional core: runner.ts sequences I/O via the ApiClient interface and delegates every decision to pure strategy.ts functions; never imports fetch/zod/pino/console/HttpApiClient."
  - "Fold-never-assign: raw BuyResult/SolveResult are always folded through the merge helpers, never assigned raw to GameState (protects the reported score)."

requirements-completed: [LOOP-01, LOOP-03]

# Metrics
duration: 3min
completed: 2026-06-10
---

# Phase 3 Plan 01: playGame Core Loop Summary

**TDD-built `playGame(api, logger)` imperative shell — a full scripted game runs to lives:0 and returns a correct GameReport, with a shop-phase drain (folded via applyBuyResult), fresh-ads-before-solve ordering, and state threaded exclusively through the merge helpers.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-10T14:46:35Z
- **Completed:** 2026-06-10T14:50:11Z
- **Tasks:** 2 (RED, GREEN)
- **Files modified:** 2 (both created)

## Accomplishments

- **RED:** Wrote 5 offline `FakeApiClient`-driven tests pinning the happy-path GAME_OVER report, the shop drain (score-preservation via `applyBuyResult`), the drain stop on `shoppingSuccess:false`, the fresh-`getMessages`-before-solve ordering (LOOP-03), and the empty-board (`chooseAd` null) no-crash case. Confirmed they fail because `src/runner.ts` did not yet exist (the correct RED reason).
- **GREEN:** Implemented `playGame` — seeds state from `startGame`, loops while `lives > 0`, runs a `drainShop` shop phase first (D-01/D-02), then fetches fresh ads and runs one solve (D-03), folding every result through `applyBuyResult`/`applySolveResult` (D-04). All 5 new tests pass; the full 121-test suite, `tsc --noEmit`, and `biome check .` are all clean.
- Declared `MAX_TURN` / `NO_PROGRESS_LIMIT` / `END.TURN_CAP` / `END.NO_PROGRESS` now but left them unwired — deferred to plan 03-02 as the plan instructs.

## Task Commits

Each task was committed atomically (TDD gate sequence — `test(03-01)` precedes `feat(03-01)`):

1. **Task 1 (RED): failing offline tests for the playGame core loop** — `a87c464` (test)
2. **Task 2 (GREEN): implement playGame core loop** — `1fd7d24` (feat)

REFACTOR: none as a separate commit — the plan's suggested cleanup (extracting the shop-drain inner loop into a private `drainShop` helper) was written that way during GREEN rather than as a post-GREEN pass, so a separate `refactor(03-01)` commit would have been an empty no-op and was deliberately not made.

**Plan metadata:** committed separately (SUMMARY + STATE + ROADMAP + REQUIREMENTS).

## Files Created/Modified

- `src/runner.ts` — the imperative shell. Exports `async function playGame(api: ApiClient, logger: Logger): Promise<GameReport>`; private `drainShop` helper; top-of-module `MAX_TURN`, `NO_PROGRESS_LIMIT`, and the `END` const object (three reason strings, `as const`, NOT a TS enum). Imports only from `./strategy.js` and `./types.js`.
- `src/runner.test.ts` — 5 colocated Vitest cases driven by `FakeApiClient`, asserting only on the returned `GameReport` and recorded `.calls` (no log-string assertions; the Logger is a silent spy).

## Decisions Made

- **drainShop helper (plan-sanctioned refactor):** the shop-phase inner loop was extracted into `drainShop(api, state)` returning the updated state, keeping `playGame` readable. Done inline during GREEN, so no separate refactor commit.
- **Constant suppression:** `MAX_TURN` and `NO_PROGRESS_LIMIT` are required-by-plan to be declared now for 03-02 but are unused in this plan, which trips Biome's `noUnusedVariables`. Added targeted `biome-ignore lint/correctness/noUnusedVariables` comments that document each is wired by 03-02's guard — keeping `biome check .` clean without disabling the rule project-wide. `END.TURN_CAP`/`END.NO_PROGRESS` are object members and need no suppression.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Biome lint/format gate failed on the declared-but-unused guard constants and a multi-line import**
- **Found during:** Task 2 (GREEN)
- **Issue:** `biome check` exited non-zero — (a) a format error: the `./strategy.js` import was multi-line but fits within the 100-col limit Biome wanted on one line; (b) `MAX_TURN`/`NO_PROGRESS_LIMIT` are declared per the plan's acceptance criteria for use in 03-02 but are unused in 03-01, tripping `noUnusedVariables`. The plan's `<verify>` requires a clean `biome check`, so this blocked task completion.
- **Fix:** Collapsed the import to a single line, and added two `biome-ignore lint/correctness/noUnusedVariables` comments documenting each constant is wired by plan 03-02 (rather than disabling the rule or deleting the plan-mandated constants).
- **Files modified:** src/runner.ts
- **Verification:** `npx biome check .` exits 0 (16 files clean); `npx tsc --noEmit` exits 0; `npx vitest run` 121/121 pass.
- **Committed in:** `1fd7d24` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** The fix was required to satisfy the plan's own clean-lint verification gate while honoring its mandate to declare the 03-02 guard constants now. No scope creep — no behavior changed, no constant was removed.

## Issues Encountered

None beyond the lint gate above. The RED suite failed cleanly for the right reason (missing `playGame`), and the GREEN implementation passed all 5 cases on first run.

## Known Stubs

None — `playGame` is fully wired (no placeholder data, no hardcoded empties flowing to output). `MAX_TURN`/`NO_PROGRESS_LIMIT`/`END.TURN_CAP`/`END.NO_PROGRESS` are intentionally-declared-but-unwired constants explicitly deferred to plan 03-02 (which extends these same two files in wave 2), not stubs that block this plan's goal.

## User Setup Required

None — no external service configuration required. The plan installed no new packages.

## Next Phase Readiness

- The happy-path game-over loop, shop drain, fresh-ad ordering, and state-threading discipline are proven offline. Plan 03-02 can now add the MAX_TURN cap and no-progress guard checks (constants already declared) and the error-propagation tests (`.rejects.toBeInstanceOf(BoundaryError|TransportError)`), extending the same two files.
- No blockers. The carried-forward base-URL concern (non-`www` host) is a Phase 4 / `index.ts` wiring concern, unaffected by this plan.

## Self-Check: PASSED

- FOUND: src/runner.ts
- FOUND: src/runner.test.ts
- FOUND: .planning/phases/03-game-loop-shop-integration/03-01-SUMMARY.md
- FOUND commit: a87c464 (test(03-01) RED)
- FOUND commit: 1fd7d24 (feat(03-01) GREEN)

---
*Phase: 03-game-loop-shop-integration*
*Completed: 2026-06-10*
