---
phase: 02-strategy-core-pure-decision-logic-tdd
plan: 03
subsystem: strategy
tags: [typescript, vitest, tdd, pure-functions, heuristic, shop-decision, survival-buffer, functional-core]

# Dependency graph
requires:
  - phase: 02-strategy-core-pure-decision-logic-tdd
    plan: 02
    provides: "rankProbability, filterEligibleAds, PROBABILITY_FLOOR_RANK, chooseAd — all reused unchanged; chooseShopPurchase is added alongside them in the same pure module"
provides:
  - "chooseShopPurchase(state, shop): ShopItem | null — the shop heal+upgrade decision (STRAT-04 / STRAT-05 / D-08..D-11)"
  - "MAX_LIVES_TO_KEEP = 3 (heal-below-full threshold, D-08) and HEAL_BUFFER_GOLD = 100 (reserved survival gold, D-10) named constants"
  - "Heal policy: buy hpot (looked up by id, LIVE cost) when lives < 3 and gold >= cost (D-08)"
  - "Ordering heal > upgrade: upgrade considered ONLY when lives are healthy, gated on healthy lives not on heal-not-bought (D-09)"
  - "Priciest affordable non-hpot upgrade while reserving the 100-gold buffer (cost <= gold - HEAL_BUFFER_GOLD) (D-10/D-11)"
  - "Explicit null no-buy signal; never throws, never mutates state or the shop list; all costs read LIVE from the shop"
affects: [02-04-state-merge, 03-runner]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-branch shop decision: heal branch returns early (or null) when lives unhealthy; upgrade branch runs only on healthy lives — ordering enforced by an early return, not a flag"
    - "Priciest-affordable selection via a single Array.reduce over the buffer-filtered non-hpot items (mirrors Plan 02-02's bestOf reduce)"
    - "Costs read LIVE from the passed-in ShopItem[] (find by id / filter by cost) — zero hardcoded 50/100/300 literals; only named threshold constants"
    - "Total-function explicit-null no-buy signal instead of an exception (mirrors chooseAd's null and decode.ts pass-throughs)"
    - "RED→GREEN per-feature TDD commit sequence within one plan"

key-files:
  created: []
  modified:
    - src/strategy.ts
    - src/strategy.test.ts

key-decisions:
  - "Single function chooseShopPurchase(state, shop): ShopItem | null (heal-or-upgrade-or-none) rather than two functions — the planner's recommended shape; one call site for the Phase 3 runner (shape was at planner/executor discretion per CONTEXT 'Claude's Discretion')"
  - "Upgrade branch gated on state.lives >= MAX_LIVES_TO_KEEP (healthy lives), NOT merely on 'heal not purchased' — a low-lives-but-broke state returns null instead of spending the survival reserve (D-09 ordering, enforced via early return in the heal branch)"
  - "Priciest affordable non-hpot chosen by Array.reduce over shop.filter(id !== 'hpot' && cost <= gold - HEAL_BUFFER_GOLD) — readable, not an optimizer (mirrors Plan 02-02's reduce)"
  - "All costs read LIVE: hpot via shop.find(id === 'hpot') then its .cost; upgrades via .cost in the filter/reduce — NO hardcoded 50/100/300 (REQUIREMENTS Out of Scope honored; the 70-cost-hpot test proves it)"

patterns-established:
  - "Survival-first shop policy: heal restores a full life buffer before any upgrade; the 100-gold reserve can never be spent on an upgrade (PITFALLS #4 heal-before-risk)"
  - "Live-catalog lookups (by id / by cost) keep the decision robust to a changing shop and avoid the brittleness flagged in REQUIREMENTS Out of Scope"

requirements-completed: [STRAT-04, STRAT-05, TEST-01]

# Metrics
duration: 2min
completed: 2026-06-09
---

# Phase 2 Plan 03: chooseShopPurchase Shop Decision Summary

**Added `chooseShopPurchase` to the pure strategy core test-first: it heals (buys `hpot`, looked up by id at its LIVE cost) when `lives < 3` and gold allows, and — only when lives are healthy — buys the priciest affordable non-`hpot` upgrade while reserving a 100-gold healing buffer; it reads every cost live from the passed-in shop list, returns an explicit `null` when nothing should be bought, and never throws or mutates its inputs.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-06-09T13:31:53Z
- **Completed:** 2026-06-09T13:34:07Z
- **Tasks:** 2 of 2
- **Files modified:** 2 (both extended, none created)

## Accomplishments

- `chooseShopPurchase(state, shop): ShopItem | null` decides heal vs upgrade vs nothing in one pure function (STRAT-04 / STRAT-05).
- Heal policy (D-08): buys `hpot` (found by id, LIVE cost) when `lives < MAX_LIVES_TO_KEEP=3` and `gold >= cost` — proven at the boundary (gold === cost) and as priority over a large upgrade surplus.
- **Live-cost proof:** a `hpot` priced at 70 does NOT trigger a heal at gold 60 (a hardcoded-50 decision would have wrongly healed) — the single most important test for the "no hardcoded costs" rule (REQUIREMENTS Out of Scope).
- Ordering heal > upgrade (D-09): the upgrade branch is gated on healthy lives via an early return in the heal branch, so a `lives 1 / gold 30` state returns `null` rather than spending the survival reserve on an upgrade.
- Buffer reserved (D-10): `cs`(100) is bought at gold 200 (leaves exactly 100); at gold 150 buying `cs` would leave 50 (< 100) so nothing is bought.
- Priciest affordable non-hpot (D-11): `ch`(300) is chosen over `cs`(100) at gold 500, and `hpot` is NEVER selected as an upgrade.
- Robustness (T-02-05): an empty shop and an `hpot`-less shop both degrade to `null` without throwing; a non-mutation guard proves neither `state` nor `shop` is mutated.
- RED → GREEN TDD discipline visible in git history (2 commits); zero hardcoded cost literals (grep clean).

## Task Commits

Each TDD gate was committed atomically (test → feat):

1. **Task 1: RED — failing tests for the shop heal + upgrade decision** — `5fc3ca4` (test)
2. **Task 2: GREEN — implement the shop heal + upgrade decision (live-cost, buffer-reserved)** — `f752b8c` (feat)

_No REFACTOR commit needed — the implementation (two named constants, an early-return heal branch, and a buffer-filtered `reduce` for the priciest upgrade) was minimal and clean as written._

## Files Created/Modified

- `src/strategy.ts` (modified, +61 lines) — Added `MAX_LIVES_TO_KEEP = 3` (D-08) and `HEAL_BUFFER_GOLD = 100` (D-10) to the constant block; widened the type-only import to `Ad, GameState, ShopItem`; added the exported `chooseShopPurchase` (heal branch with early return → buffer-filtered priciest-upgrade reduce → `null`). Updated the file header to cite the Plan 02-03 responsibility. Still imports only `./types.js` via `import type`.
- `src/strategy.test.ts` (modified, +155 lines) — Added `baseState(overrides): GameState` and `shopItem(id, cost, name?): ShopItem` plain-object builders and `describe("chooseShopPurchase (STRAT-04 / STRAT-05)")` with nested families: heal policy (D-08, incl. the 70-cost live-read proof and the `hpot`-less robustness case), decision ordering (D-09), upgrade buffer reserved (D-10), priciest affordable non-hpot (D-11), nothing-to-buy / empty-shop, and a non-mutation purity guard. Costs in fixtures are the FEATURES.md tiers (50/100/300) but the decision is proven to read them live.

## Decisions Made

- **One function `chooseShopPurchase(state, shop): ShopItem | null`** (heal-or-upgrade-or-none) over two functions — the planner's recommended shape, a single branch point for the Phase 3 runner (shape was at planner/executor discretion per CONTEXT).
- **Upgrade branch gated on healthy lives, not on heal-not-purchased** — the heal branch returns (`hpot` or `null`) whenever `lives < 3`, so a low-lives state can never fall through into an upgrade (D-09 ordering).
- **Priciest affordable non-hpot via `reduce`** over `shop.filter(id !== "hpot" && cost <= gold - HEAL_BUFFER_GOLD)` — readable and stable, mirroring Plan 02-02's `bestOf` reduce.
- **All costs read LIVE** — `hpot` by `shop.find(id === "hpot")` then `.cost`; upgrades by `.cost` in the filter/reduce. No `50`/`100`/`300` literal appears as a price (only `HEAL_BUFFER_GOLD = 100` exists, and the acceptance-criterion grep excludes it).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. RED failed for the right reason (`chooseShopPurchase is not a function` — export absent, all 16 new tests; the 44 Plans 01-02 strategy tests stayed green), and GREEN passed the full strategy suite, typecheck, and Biome on the first implementation.

## Verification

- `npx vitest run src/strategy.test.ts` — 60 passed (16 rank + 14 filter + 14 chooseAd + 16 chooseShopPurchase).
- `npx vitest run` (full suite) — 97 passed across 4 files (no regressions).
- `npx tsc --noEmit` — clean.
- `npx biome check src/strategy.ts src/strategy.test.ts` — no issues.
- No-hardcoded-cost constraint: `grep -nE "(^|[^0-9])(50|100|300)([^0-9]|$)" src/strategy.ts | grep -v 'HEAL_BUFFER_GOLD = 100'` returns nothing — no cost literal used as a price.
- Import-only constraint: the only `import` in `src/strategy.ts` is `import type { Ad, GameState, ShopItem } from "./types.js"`.

## TDD Gate Compliance

Plan `type: tdd`. Gate sequence verified in git log:
- chooseShopPurchase: RED `5fc3ca4` (test) → GREEN `f752b8c` (feat). RED failed because the export was absent (`chooseShopPurchase is not a function`), not a passing-during-RED skip — a genuine RED before implementation.

No gate was skipped; no test passed unexpectedly during the RED phase.

## Threat Surface

The plan's `<threat_model>` mitigations are both covered by passing tests:
- **T-02-05 (DoS/robustness):** an empty shop list and an `hpot`-less shop both degrade to `null` and the `.not.toThrow()` guard proves no exception — the decision never crashes on a malformed catalog.
- **T-02-06 (Tampering / overspend):** the buffer-reserved tests prove an upgrade that would leave `< HEAL_BUFFER_GOLD` (100) gold is rejected, and the ordering test proves an upgrade is never bought while lives are unhealthy — the bot can never spend the gold reserved for healing (PITFALLS #4).

No new security-relevant surface introduced (pure functional core, no I/O, no schema/network change, no package installs).

## Self-Check: PASSED

- `src/strategy.ts` exists and exports `chooseShopPurchase` and defines `MAX_LIVES_TO_KEEP` + `HEAL_BUFFER_GOLD`.
- `src/strategy.test.ts` exists with `describe("chooseShopPurchase (STRAT-04 / STRAT-05)")`.
- `.planning/phases/02-strategy-core-pure-decision-logic-tdd/02-03-SUMMARY.md` exists.
- Both task commits present in git history (`5fc3ca4` test, `f752b8c` feat).
