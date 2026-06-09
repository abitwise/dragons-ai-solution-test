---
phase: 02-strategy-core-pure-decision-logic-tdd
reviewed: 2026-06-09T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/strategy.ts
  - src/strategy.test.ts
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-09
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed the pure functional-core decision module (`src/strategy.ts`) and its
Vitest suite (`src/strategy.test.ts`). The module is well-structured, genuinely
pure (no I/O imports — only `import type` from `types.js`, satisfying the
CLAUDE.md constraint), and the happy-path decision logic is correct: the
probability rank table matches `FEATURES.md` exactly (including the four-dot
`"Hmmm...."`), the `?? 0` unknown-label rule is total, `filterEligibleAds` and
`chooseAd` compose cleanly, and the asymmetric state-merge helpers correctly
carry forward the field each result omits.

No Critical issues. However, the adversarial pass surfaced several real gaps the
green test suite does not cover: NaN/non-finite `reward` and `cost` values can
silently corrupt `chooseAd`/`chooseShopPurchase` ranking (the API boundary
coerces wire strings to numbers and a failed coercion yields `NaN`); the
`applyBuyResult` contract does not match what the `ApiClient.buy()` seam actually
returns, which is a latent Phase-3 integration trap that can re-zero the score
the helper claims to protect; and the EV comparator silently picks an arbitrary
ad on a `NaN` EV. Several test-coverage and robustness gaps are also noted.

## Warnings

### WR-01: `chooseAd` / `expectedValue` mis-handle a non-finite (`NaN`) `reward`

**File:** `src/strategy.ts:109-131, 159-168`
**Issue:** `Ad.reward` is documented in `types.ts:34-36` as "already coerced to a
number by the API boundary (the raw wire value can be a string; the coercion
happens in `api.ts`)." A failed coercion (`Number("")`, `Number("12g")`,
`parseFloat` of a non-numeric) yields `NaN`. `expectedValue` then returns `NaN`,
and in `preferAd` (line 123) `const evDiff = expectedValue(candidate) -
expectedValue(current)` is `NaN`, so BOTH `evDiff > 0` (line 124) and `evDiff < 0`
(line 125) are `false`. The comparator silently falls through to the
expiry/reward tiebreak and can select an ad whose true EV is unknown/garbage over
a legitimately high-EV ad — or, if every reward is `NaN`, the reduce returns an
essentially arbitrary ad. This is a correctness gap in the core selection loop
(the very thing CLAUDE.md says "must work"). The module's own header (lines
11-13) promises "one malformed or adversarial ad can never crash the decision
loop" — it does not crash, but it can silently corrupt the choice, which is worse.
**Fix:** Treat a non-finite reward as ineligible/worst at the boundary of
`expectedValue`, e.g.:
```typescript
function expectedValue(ad: Ad): number {
  const reward = Number.isFinite(ad.reward) ? ad.reward : 0;
  return reward * rankProbability(ad.probability);
}
```
Or, preferably, drop non-finite-reward ads in `filterEligibleAds` (and in the
fallback `solvable` filter) so they never reach selection at all. Add tests for
`reward: NaN`, `reward: Infinity`, and a negative `reward`.

### WR-02: `applyBuyResult` consumes a `BuyResult`, but the `ApiClient.buy()` seam returns a merged `GameState` — latent double-merge / score re-zero

**File:** `src/strategy.ts:238-262`; cross-ref `src/types.ts:117-123`, `src/api.ts:209-225`
**Issue:** `applyBuyResult(state, result: BuyResult)` is the documented "load-bearing
half" (lines 247-250) that protects `score`/`highScore` from the `score:0`
placeholder. But the `ApiClient.buy()` interface (`types.ts:122`) returns
`Promise<GameState>`, and the concrete `api.ts buy()` (lines 216-224) already
folds the buy result into a `GameState` with `score: 0, highScore: 0`. The raw
`BuyResult` shape is never exposed through the injected seam the runner depends
on. A Phase-3 runner wiring this naively has two failure modes: (a) it never
calls `applyBuyResult` (because `buy()` already returns a `GameState`) and thus
adopts the `score:0` placeholder directly — silently corrupting the final score,
exactly the bug this helper exists to prevent; or (b) it tries to pass the
returned `GameState` into `applyBuyResult`, which won't type-check against
`BuyResult` and invites an unsafe cast. The strategy half is correct in
isolation, but the contract across the module boundary is inconsistent and the
green tests cannot catch it (no runner exists yet).
**Fix:** Make the seam expose the raw result the merge needs. Either change
`ApiClient.buy()` to return `Promise<BuyResult>` (let the strategy own the merge,
which is its stated job), or remove the dead `score:0`/`highScore:0` placeholder
path from `api.ts buy()` and have it return a partial. Document the single
intended wiring in the Phase-3 plan so the runner cannot pick the score-corrupting
path. At minimum, add a comment in `applyBuyResult` pointing at the exact
seam-method that must feed it.

### WR-03: `chooseShopPurchase` upgrade selection corrupts on a non-finite `cost`

**File:** `src/strategy.ts:204-213`
**Issue:** `ShopItem.cost` flows from the same external API boundary as `reward`.
A `NaN` cost passes the filter predicate `item.cost <= state.gold -
HEAL_BUFFER_GOLD` as `false` (so a `NaN`-cost upgrade is excluded — acceptable),
but in the heal branch `healingPotion.cost <= state.gold` (line 197) a `NaN`
hpot cost evaluates `false`, so a needed heal silently won't fire even when gold
is ample, and `chooseShopPurchase` returns `null` — the bot quietly stops
healing instead of degrading loudly. More subtly, in the `reduce` (lines
211-213) `candidate.cost > priciest.cost` with a `NaN` on either side is always
`false`, so a `NaN`-cost item that somehow cleared the filter would never become
"priciest" — order-dependent and silent. The module promises "never throws — a
missing `hpot` or an empty shop simply degrades to `null`" but says nothing about
malformed costs, which behave inconsistently.
**Fix:** Guard cost reads with `Number.isFinite(item.cost)` in both the heal
lookup and the upgrade filter, treating non-finite costs as unaffordable, and add
tests for `cost: NaN` in both an `hpot` and an upgrade item.

## Info

### IN-01: Test suite has zero coverage for non-finite / malformed numeric inputs

**File:** `src/strategy.test.ts` (whole file)
**Issue:** The suite is thorough on labeled cases but never exercises `reward:
NaN`, `cost: NaN`, `Infinity`, or negative `reward`/`gold`/`cost` — the exact
inputs WR-01 and WR-03 turn on, and exactly the inputs the `types.ts` boundary
note warns can arise from string coercion. "All tests pass" therefore does not
establish correctness against adversarial API data, which the module's own header
claims as a goal.
**Fix:** Add `chooseAd`/`filterEligibleAds`/`chooseShopPurchase` cases for
non-finite and negative numbers; assert the intended degrade-to-skip behavior.

### IN-02: Tiebreak when EV, expiry, AND reward are all equal is untested and asymmetric

**File:** `src/strategy.ts:122-131`; `src/strategy.test.ts:294-310`
**Issue:** `preferAd` returns `candidate` on a total tie (line 130 falls to
`candidate.reward > current.reward ? candidate : current` → `current` only when
strictly greater, so an exact reward tie keeps `current`). The header comment
(line 120) says "`current` is kept on an exact tie," which is consistent, but no
test pins down the fully-equal case, so the documented stable-selection guarantee
is unverified. Selection determinism matters for reproducible logs/scoring.
**Fix:** Add a test with two ads identical in EV, `expiresIn`, and `reward` and
assert which `adId` is returned, locking the documented "keep current" behavior.

### IN-03: `chooseShopPurchase` uses the FIRST `hpot` and an order-dependent priciest reduce on duplicate ids/costs

**File:** `src/strategy.ts:196, 211-213`
**Issue:** `shop.find((item) => item.id === "hpot")` returns the first match; if a
shop ever lists two `hpot` entries, a cheaper affordable one later in the list is
ignored. Likewise the upgrade `reduce` keeps `priciest` on a cost tie (`>` not
`>=`), so two equally-priced top upgrades resolve by list order. Neither is
likely against the real catalog, but both are silent, order-dependent behaviors
with no test.
**Fix:** Low priority. If you want determinism guarantees, document the
"first/earliest wins" tiebreak and add a duplicate-id and equal-cost test; the
real API catalog makes this unlikely, so this is informational.

### IN-04: Magic comparison `> 0` for expiry duplicated between the floor filter and the fallback

**File:** `src/strategy.ts:102, 166`
**Issue:** The non-expired predicate `ad.expiresIn > 0` is written inline in both
`filterEligibleAds` (line 102) and the `chooseAd` fallback `solvable` filter (line
166). The two must stay in lock-step (the header explicitly says the fallback
relaxes "ONLY the floor"); duplicated inline predicates are a drift risk if the
expiry rule ever changes (e.g. to `>= 0`).
**Fix:** Extract a small `isAttemptable(ad)` (non-expired AND not-encrypted)
helper and reuse it in both places, so the floor is provably the only differing
constraint between the primary and fallback paths.

---

_Reviewed: 2026-06-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
