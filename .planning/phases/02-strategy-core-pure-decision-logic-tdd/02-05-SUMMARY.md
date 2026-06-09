---
phase: 02-strategy-core-pure-decision-logic-tdd
plan: 05
subsystem: strategy-core
tags: [tdd, gap-closure, hardening, seam-contract, functional-core]
gap_closure: true
requires:
  - "02-01..02-04 (the built, passing strategy core + api/fake seam)"
provides:
  - "Non-finite reward hardening in filterEligibleAds + chooseAd fallback (WR-01)"
  - "Non-finite cost hardening in chooseShopPurchase heal + upgrade (WR-03)"
  - "Symmetric buy() seam returning Promise<BuyResult> across types.ts/api.ts/fake-api-client.ts (WR-02)"
  - "applyBuyResult reachable end-to-end through the injected seam (WR-02 regression guard)"
affects:
  - "Phase 3 runner: buy() now returns a raw BuyResult the runner folds via applyBuyResult"
tech-stack:
  added: []
  patterns:
    - "Shared isAttemptable(ad) predicate keeps the primary + fallback ad filters provably in lock-step (IN-04)"
    - "Number.isFinite guards at the api boundary's downstream consumers treat non-finite wire-coerced numerics as ineligible/unaffordable (degrade, never throw)"
    - "buy() symmetric with solve(): seam returns the raw result; the merge helper (applyBuyResult) owns the state fold"
key-files:
  created: []
  modified:
    - "src/strategy.ts"
    - "src/strategy.test.ts"
    - "src/types.ts"
    - "src/api.ts"
    - "src/api.test.ts"
    - "src/fake-api-client.ts"
    - "src/fake-api-client.test.ts"
decisions:
  - "WR-02 resolved via option (a): ApiClient.buy() returns Promise<BuyResult> (symmetric with solve()), eliminating the api.ts score:0/highScore:0 placeholders"
  - "WR-01 uses a shared isAttemptable predicate (non-expired AND not-encrypted AND finite reward) reused by both filterEligibleAds and the chooseAd fallback, so the probability floor is provably the only constraint the fallback relaxes (IN-04)"
  - "WR-03 RED used a -Infinity cost (not just NaN) to produce a genuine failing test: NaN costs already coincidentally degrade to null/exclude via false comparisons, but -Infinity <= gold is true and would fire a free heal/upgrade without the Number.isFinite guard"
metrics:
  duration_min: 6
  completed: 2026-06-09
  tasks: 4
  files_modified: 7
  tests_before: 105
  tests_after: 116
---

# Phase 2 Plan 5: Phase-2 Gap Closure (WR-01 / WR-02 / WR-03) Summary

Closed the three open Phase-2 items — two non-finite-numeric hardening guards in the pure decision core and the `buy()` inter-phase seam contract fix the verifier flagged as `human_needed` — entirely test-first, with no regression to the already-verified 02-01..02-04 logic. The suite grew from 105 to 116 tests, all green; tsc and biome stay clean.

## What Was Built

- **WR-01 (non-finite `reward`):** `filterEligibleAds` and the `chooseAd` fallback now drop ads whose `reward` is `NaN`/`±Infinity` via a shared `isAttemptable(ad)` predicate, so a failed wire-string coercion can never silently corrupt EV selection. A finite negative reward is still eligible (only non-finite is excluded). `expectedValue`/`preferAd` are untouched.
- **WR-03 (non-finite `cost`):** `chooseShopPurchase` guards the heal lookup (`Number.isFinite(healingPotion.cost) && healingPotion.cost <= state.gold`) and the upgrade `affordableUpgrades` filter (`Number.isFinite(item.cost)`), treating a non-finite cost as unaffordable. The heal no longer silently suppresses on a malformed cost, and a `-Infinity` cost is never a free buy. Both branches degrade to `null`/exclusion, never throw.
- **WR-02 (seam contract):** `ApiClient.buy()` now returns `Promise<BuyResult>` (symmetric with `solve()` → `SolveResult`). `HttpApiClient.buy()` returns the raw validated `BuyResult` directly (the GameState construction and `score: 0`/`highScore: 0` placeholders are deleted). `FakeApiClient`'s buy script type, method return, and `SourceReturn` arm are all `BuyResult`. `applyBuyResult`'s **body is unchanged** — only its JSDoc (now naming `ApiClient.buy` as the seam that feeds it) and the seam types/tests changed. A new seam-reachability regression test proves a prior `score: 700, highScore: 900` survives a buy merge.

## TDD Gate Compliance

Every behavior-adding task followed a RED → GREEN (→ REFACTOR) sequence with the plan's exact commit prefixes:

| Task | RED (`test`) | GREEN (`feat`) | REFACTOR (`refactor`) |
| ---- | ------------ | -------------- | --------------------- |
| 1 — WR-01 reward | `893bf83` | `8ead4d2` | `9a18592` (extract `isAttemptable`, IN-04) |
| 2 — WR-03 cost   | `ca8b848` | `605bd3c` | (none) |
| 3 — WR-02 seam   | `3ce28a8` | `dce6908` | `d256f21` (docs + seam JSDoc) |

Task 4 was a verification-only gate (no source edits) — full suite, tsc, and biome run, no decision logic altered.

## Tasks Completed

| Task | Name | Commits | Key Files |
| ---- | ---- | ------- | --------- |
| 1 | WR-01 non-finite reward hardening | `893bf83`, `8ead4d2`, `9a18592` | src/strategy.ts, src/strategy.test.ts |
| 2 | WR-03 non-finite cost hardening | `ca8b848`, `605bd3c` | src/strategy.ts, src/strategy.test.ts |
| 3 | WR-02 raw-BuyResult buy() seam | `3ce28a8`, `dce6908`, `d256f21` | src/types.ts, src/api.ts, src/api.test.ts, src/fake-api-client.ts, src/fake-api-client.test.ts, src/strategy.ts, src/strategy.test.ts |
| 4 | Final gate (suite + tsc + biome) | (verification only) | — |

## Final Gate Results

- `npx vitest run` — **116/116 pass** (4 files), exit 0 (was 105; +11 new cases: 5 WR-01 filter/select, 3 WR-03 cost, 1 WR-02 seam-reachability, +2 reworked api/fake buy assertions)
- `npx tsc --noEmit` — exit 0, no output
- `npx biome check src/` — "No fixes applied", exit 0
- `strategy.ts` imports only `./types.js` via `import type` (pure-core constraint intact; the guards add no runtime imports)
- `grep -v '^ *\*' src/strategy.ts | grep -c "Number.isFinite"` = 3 (isAttemptable + heal + upgrade)
- `grep -c "score: 0" src/api.ts` = 0
- `grep -c '\.\.\.state' src/strategy.ts` = 2 (both merge helper bodies unchanged)

## Closure Confirmation

- **WR-01 CLOSED** — non-finite-reward ads are dropped in both the primary filter and the fallback (lock-step via `isAttemptable`); `chooseAd` can never select or fall through to a `NaN`/`Infinity`-reward ad.
- **WR-02 CLOSED** — `ApiClient.buy()` returns `Promise<BuyResult>`; `applyBuyResult` is now reachable end-to-end through the injected seam, with a regression test proving the prior score/highScore survive the merge. This resolves the `02-VERIFICATION.md` `human_needed` item via option (a).
- **WR-03 CLOSED** — a non-finite hpot cost no longer silently suppresses healing, and a non-finite upgrade cost is excluded; both degrade cleanly without throwing.

## Deviations from Plan

None — the plan executed as written. Task 1's optional REFACTOR (`isAttemptable` extraction) was performed because it makes the primary/fallback lock-step provable (IN-04) and improves clarity. Note for the verifier: the refactor consolidates WR-01's two `Number.isFinite` sites into one shared predicate, so the strategy.ts `Number.isFinite` count is 3 (isAttemptable + heal + upgrade) rather than 4 — this satisfies the Task 2 `>= 3` acceptance criterion and the Task 1 "`>= 1` if an extracted shared predicate is reused in both sites" allowance.

A WR-03 implementation note: a `NaN` cost already coincidentally degrades correctly (NaN comparisons are always false), so the RED test additionally used a `-Infinity` cost — which compares as `<= gold` and would wrongly fire a free heal/upgrade without the guard — to produce a genuine failing test that proves the `Number.isFinite` guard is load-bearing.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired components were introduced. The word "placeholder" no longer appears in `api.ts` (the score:0/highScore:0 placeholders were deleted) and the stale "placeholder" doc references in `strategy.ts`/`strategy.test.ts` flagged by the verifier's anti-pattern scan were corrected.

## Self-Check: PASSED

- src/strategy.ts — FOUND (modified)
- src/strategy.test.ts — FOUND (modified)
- src/types.ts — FOUND (modified)
- src/api.ts — FOUND (modified)
- src/api.test.ts — FOUND (modified)
- src/fake-api-client.ts — FOUND (modified)
- src/fake-api-client.test.ts — FOUND (modified)
- Commits 893bf83, 8ead4d2, 9a18592, ca8b848, 605bd3c, 3ce28a8, dce6908, d256f21 — all FOUND in git log
</content>
</invoke>
