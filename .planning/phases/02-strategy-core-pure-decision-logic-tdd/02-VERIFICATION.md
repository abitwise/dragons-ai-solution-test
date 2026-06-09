---
phase: 02-strategy-core-pure-decision-logic-tdd
verified: 2026-06-09T16:47:55Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Confirm WR-02 wiring intent is documented before Phase 3 plan is written"
    expected: "The strategy module's applyBuyResult expects a raw BuyResult, but ApiClient.buy() returns a merged GameState (Promise<GameState>). A Phase 3 runner that wires naively will either (a) skip applyBuyResult and adopt the score:0 placeholder directly, or (b) pass a GameState into applyBuyResult which will fail to type-check. Before Phase 3 begins, verify that either ApiClient.buy() is changed to return Promise<BuyResult>, or a documented convention is established that the runner must extract the raw buy result before merging."
    why_human: "This is an inter-phase seam correctness issue. The strategy module is internally correct and all 68 tests pass, but the contract between api.ts (which returns GameState from buy()) and applyBuyResult (which expects BuyResult) is inconsistent. No automated check can verify that the Phase 3 plan will wire these correctly — it requires a human decision on how to resolve the seam mismatch before Phase 3 is planned."
---

# Phase 2: Strategy Core (Pure Decision Logic, TDD) Verification Report

**Phase Goal:** All "what should the bot do" logic exists as pure, fully test-driven functions in `strategy.ts`, so decisions are deterministic, readable, and proven before any loop integrates them.
**Verified:** 2026-06-09T16:47:55Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every one of the 11 probability strings (including the exact `"Hmmm...."` four-dot label) maps to its rank, and an unknown string ranks worst and never throws | VERIFIED | `RANK` table at strategy.ts:60-72 maps all 11 labels; `"Hmmm...."`: 6 is literal on line 65. `rankProbability` returns `RANK[probability] ?? 0` — total function. 16 rank tests pass (11 labeled + 4 unknown/never-throw cases). Test at line 135 asserts exact four-dot literal. |
| 2 | Given a mixed board, the chosen ad is the best by expected value (`reward × rank`) after filtering expired, sub-floor, and unhandled-encryption ads, with an expiry-aware tiebreak; an empty or all-risky board yields the defined fallback rather than a crash | VERIFIED | `chooseAd` at strategy.ts:159-168 composes `filterEligibleAds` (primary) with a solvable-set fallback (relaxes only floor, still excludes expired and `!ad.encrypted`). `preferAd` at lines 122-131 implements EV-desc → expiresIn-asc → reward-desc ordering. 14 `chooseAd` tests pass covering: EV beats raw reward (A EV=2000 beats B EV=1800), sub-floor monster excluded, expiry tiebreak, reward tiebreak, least-bad gamble, empty/all-expired/all-encrypted boards return null, fallback never selects still-encrypted. |
| 3 | Applying a solve result and applying a buy result each merge into game state correctly — solve omits `level`, buy omits `score` — without clobbering the missing field | VERIFIED | `applySolveResult` at strategy.ts:227-236 spreads prior state then overrides lives/gold/score/highScore/turn, leaving `level` from the prior state. `applyBuyResult` at lines 254-262 spreads prior state then overrides lives/gold/level/turn, leaving score/highScore. 8 merge tests pass including placeholder-restore test (prior score:700 survives a BuyResult with score:0 in api.ts). Non-mutation snapshot tests also pass. |
| 4 | The bot decides to buy `hpot` when lives are low and gold allows, and only buys a level-raising upgrade from surplus gold after reserving a healing buffer | VERIFIED | `chooseShopPurchase` at strategy.ts:192-213 gates the upgrade branch on `state.lives >= MAX_LIVES_TO_KEEP` (not merely "heal not purchased") via early return. Upgrade filter: `item.cost <= state.gold - HEAL_BUFFER_GOLD`. `MAX_LIVES_TO_KEEP = 3`, `HEAL_BUFFER_GOLD = 100`. 16 shop tests pass including the critical live-cost proof (hpot priced at 70 does NOT fire heal at gold 60). |
| 5 | The strategy test suite covers all of the above and runs fast and deterministically with no mocks and no network (inputs are plain objects) | VERIFIED | `npx vitest run src/strategy.test.ts` — 68 tests pass in 127ms. All fixtures are plain objects (baseAd, baseState, shopItem, baseSolve, baseBuy builders). No FakeApiClient, no network, no `vi.fn()` mocks. The strategy module imports only `import type { Ad, BuyResult, GameState, ShopItem, SolveResult } from "./types.js"` — zero runtime imports confirmed by grep (returns 0). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/strategy.ts` | Rank lookup table, PROBABILITY_FLOOR_RANK, rankProbability, filterEligibleAds, chooseAd, chooseShopPurchase, applySolveResult, applyBuyResult | VERIFIED | 262 lines (>40 min); exports all 6 functions; contains PROBABILITY_FLOOR_RANK, HEAL_BUFFER_GOLD, MAX_LIVES_TO_KEEP; only imports `./types.js` via `import type` |
| `src/strategy.test.ts` | Table-driven rank tests (all 11 labels + unknown) and all subsequent test suites, plain-object fixtures, no mocks | VERIFIED | 646 lines (>60 min); imports all 6 exported functions; fixture builders: baseAd, baseState, shopItem, baseSolve, baseBuy; "Hmmm...." literal present at lines 120, 135, 167, 213, 253, 390 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/strategy.ts` | `src/types.js` | `import type { Ad, BuyResult, GameState, ShopItem, SolveResult }` | VERIFIED | Line 42: `import type { Ad, BuyResult, GameState, ShopItem, SolveResult } from "./types.js"` — exact pattern confirmed |
| `src/strategy.test.ts` | `src/strategy.js` | named import of all 6 functions | VERIFIED | Lines 2-9: imports applyBuyResult, applySolveResult, chooseAd, chooseShopPurchase, filterEligibleAds, rankProbability from `./strategy.js` |
| `src/strategy.ts chooseAd` | `rankProbability + filterEligibleAds (Plan 01)` | reuses rank table and floor filter | VERIFIED | `grep -c "const RANK" src/strategy.ts` = 1 (no duplication); chooseAd calls filterEligibleAds directly at line 160 |
| `src/strategy.ts applyBuyResult` | `BuyResult` type | spread-merge `...state` carrying score/highScore forward | VERIFIED | `grep -c '\.\.\.state' src/strategy.ts` = 2 (one per merge helper); BuyResult parameter typed correctly |

### Data-Flow Trace (Level 4)

Not applicable — `strategy.ts` is a pure functional module with no I/O, no state store, and no data fetching. All inputs are passed as function arguments (plain objects). There is no "data source" to trace — the data flows from the caller (Phase 3 runner, which does not yet exist) into these functions as plain objects.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| rankProbability("Hmmm....") === 6 | `npx vitest run src/strategy.test.ts` (test at line 133-136) | 68/68 pass | PASS |
| chooseAd selects by EV not raw reward | Test at line 248-255: A(reward=200,rank=10,EV=2000) vs B(reward=300,rank=6,EV=1800) — A wins | 68/68 pass | PASS |
| applyBuyResult preserves prior score from GameState | Test at line 620-627: prior score:700 survives BuyResult merge | 68/68 pass | PASS |
| Full project suite passes with no regressions | `npx vitest run` | 105/105 pass across 4 files | PASS |
| TypeScript typecheck clean | `npx tsc --noEmit` | exit 0, no output | PASS |
| Biome lint/format clean | `npx biome check src/strategy.ts src/strategy.test.ts` | "No fixes applied" | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| STRAT-01 | 02-01 | Probability string to rank mapping, unknown ranks worst, never throws | SATISFIED | `rankProbability` + RANK table in strategy.ts:60-83; 16 rank tests |
| STRAT-02 | 02-01 | Filter out ineligible ads (expired, sub-floor, unhandled encryption) | SATISFIED | `filterEligibleAds` in strategy.ts:99-106; 14 filter tests |
| STRAT-03 | 02-02 | Select best ad by EV with expiry tiebreak, fallback, null for empty | SATISFIED | `chooseAd` in strategy.ts:159-168; 14 chooseAd tests |
| STRAT-04 | 02-03 | Buy hpot when lives low and gold allows | SATISFIED | `chooseShopPurchase` heal branch in strategy.ts:193-201; 6 heal-policy tests + live-cost proof |
| STRAT-05 | 02-03 | Buy upgrades from surplus after reserving healing buffer | SATISFIED | Upgrade branch in strategy.ts:203-213 gated on healthy lives + HEAL_BUFFER_GOLD; 4 upgrade tests |
| STRAT-06 | 02-04 | Merge solve/buy results into state without clobbering omitted fields | SATISFIED | `applySolveResult` + `applyBuyResult` in strategy.ts:227-262; 8 merge tests |
| TEST-01 | 02-01..04 | Core logic built test-first, fast deterministic unit tests, no live network | SATISFIED | 68 tests in 127ms, plain-object fixtures, no mocks, no network, RED→GREEN sequence in git history (10 commits) |

All 7 phase-2 requirements satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/strategy.ts` | 247-248 | Word "placeholder" in JSDoc comment | Info | Not a code stub — the word "placeholder" appears in a doc-comment explaining what api.ts buy() does with score:0. The code itself is fully implemented. Not a blocker. |
| `src/strategy.test.ts` | 37, 98, 620 | Word "placeholder" in comments/test description | Info | Same — documentation references to the api.ts behavior being guarded against. Not a stub. |

No TBD, FIXME, or XXX markers found in either file. No empty implementations. No return null/return {}/return [] stubs found in any export. No hardcoded shop cost literals in decision logic (verified by grep).

### Human Verification Required

#### 1. WR-02 Seam Contract — applyBuyResult vs ApiClient.buy() return type

**Test:** Before Phase 3 planning begins, review the mismatch between `applyBuyResult(state, result: BuyResult): GameState` and `ApiClient.buy(...): Promise<GameState>`. Decide one of:
  (a) Change `ApiClient.buy()` signature to return `Promise<BuyResult>`, letting the runner call `applyBuyResult` with the raw result; or
  (b) Document the intended Phase 3 wiring explicitly (e.g. the runner must use a different merge path or bypass `applyBuyResult` because buy() already merges internally); or
  (c) Remove the `score:0` placeholder from `api.ts buy()` so the GameState it returns already carries the correct score (eliminating the need for a separate merge).

**Expected:** One of the three options is selected and the Phase 3 plan explicitly documents how buy results flow into game state without silently zeroing the score.

**Why human:** The strategy module is internally consistent and all 68 tests pass. The `applyBuyResult` function correctly carries score/highScore forward from the prior state when given a raw `BuyResult`. The problem is an inter-module contract gap: `ApiClient.buy()` (types.ts:122) returns `Promise<GameState>`, not `Promise<BuyResult>`. The concrete `api.ts buy()` (lines 209-225) already folds the buy result into a GameState with `score: 0, highScore: 0` placeholders. A Phase 3 runner cannot call `applyBuyResult` with the output of `api.buy()` because the types don't match (`GameState` is not assignable to `BuyResult`). This means `applyBuyResult` is currently unreachable from the only wiring path that exists — the seam contract is inconsistent with the helper's signature. The code review (WR-02) flagged this exactly. The fix requires a human decision about which side of the seam to change, and that decision must be made before Phase 3 plan is written, otherwise the score-protect logic is dead code. Automated checks cannot detect this; it requires reading the Phase 3 integration intent.

### Gaps Summary

No automated verification gaps. All 5 must-haves are VERIFIED. All 7 requirement IDs (STRAT-01..06, TEST-01) are SATISFIED. The test suite runs 68/68 pass, typecheck is clean, Biome reports no issues, no debt markers exist, and no stubs are present.

The `human_needed` status is due to a latent inter-phase seam issue (WR-02 from the code review): `applyBuyResult` is the correct implementation for its intended contract, but `ApiClient.buy()` returns `GameState`, not `BuyResult`, making `applyBuyResult` unreachable through the injected seam without a type mismatch. This is not a gap in the Phase 2 goal (all pure decision logic is correct), but it is a wiring hazard that Phase 3 must explicitly resolve before the runner can correctly protect the score.

---

_Verified: 2026-06-09T16:47:55Z_
_Verifier: Claude (gsd-verifier)_
