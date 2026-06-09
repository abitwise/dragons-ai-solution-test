---
phase: 02-strategy-core-pure-decision-logic-tdd
reviewed: 2026-06-09T18:05:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/api.test.ts
  - src/api.ts
  - src/fake-api-client.test.ts
  - src/fake-api-client.ts
  - src/strategy.test.ts
  - src/strategy.ts
  - src/types.ts
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-09T18:05:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the pure decision core (`strategy.ts`), its types (`types.ts`), the HTTP
client (`api.ts`), the scripted test double (`fake-api-client.ts`), and the three
test suites, with particular attention to the 02-05 gap-closure changes (WR-01
non-finite-reward drop via the shared `isAttemptable` predicate, WR-03 non-finite
`cost` guards, and the WR-02 `buy()` raw-`BuyResult` seam).

**Behavioral verdict: the decision logic is correct.** I traced the EV selection,
both tiebreaks, the fallback lock-step (the fallback relaxes ONLY the floor), the
shop heal/upgrade ordering, the buffer reserve, and the two state-merge helpers by
hand and against the 105 passing tests. `npm run typecheck` is clean and Biome
reports no issues. The `buy()` seam change is internally consistent across all
three files: `types.ts` declares `buy(): Promise<BuyResult>`, `api.ts` returns the
raw validated `BuyResult` via `buySchema`, and `fake-api-client.ts`'s `Source` /
`SourceReturn<"buy">` both resolve to `BuyResult`. No BLOCKER-class defect found.

**The material finding is that the WR-01 and WR-03 guards rest on a factually
incorrect description of the zod boundary's behavior.** The guards themselves are
harmless defense-in-depth, but their justifying comments assert a boundary
behavior that the actual schemas in `api.ts` cannot produce — verified empirically
against the installed zod 4 (see WR-01). This is a correctness-of-reasoning defect:
it will mislead maintainers and gives false confidence about which inputs the pure
core must tolerate. The remaining findings are quality/clarity items.

## Warnings

### WR-01: WR-01/WR-03 guards justified by an incorrect claim about zod coercion (the boundary cannot emit a non-finite `reward`/`cost`)

**File:** `src/strategy.ts:98-102`, `src/strategy.ts:116-117`, `src/strategy.ts:213-217`
**Issue:**
The non-finite-reward and non-finite-cost guards are documented as protecting
against values the API boundary produces from a "failed coercion":

> `src/strategy.ts:99` — "`Ad.reward` is coerced from a wire string in `api.ts`, and a failed coercion yields `NaN`."
> `src/strategy.ts:214-215` — "`ShopItem.cost` flows from the same wire-string boundary as `Ad.reward`, so a failed coercion can yield `NaN`/`±Infinity`."

Both claims are false for the schemas actually in `api.ts`, verified empirically
against the installed zod 4 (`zod ^4.4.3`):

- `reward` uses `z.coerce.number()` (`api.ts:103`). In zod 4, `z.coerce.number()`
  applied to `"abc"`, `"Infinity"`, `"1e400"`, `"NaN"`, raw `NaN`, and raw
  `Infinity` all **fail validation** (`safeParse(...).success === false`), so
  `getMessages` throws a `BoundaryError` rather than returning a non-finite
  `Ad.reward`. The only "odd" coercions (`""`, `null`, `[]` → `0`; `true` → `1`)
  are all **finite**. No input yields a `NaN`/`±Infinity` `Ad.reward` through
  `adSchema`.
- `cost` uses **`z.number()`** (`api.ts:133`), not `z.coerce.number()` — it is not
  coerced at all, and `z.number()` in zod 4 **rejects** `NaN` and `Infinity`. So a
  non-finite `ShopItem.cost` cannot pass `shopItemSchema` either; the WR-03 comment
  describing `cost` as flowing through "the same wire-string boundary" with a
  coercion failure is doubly wrong (it is neither string-coerced nor able to be
  non-finite).

The guards are reasonable for a pure function that accepts an arbitrary `Ad` /
`ShopItem` (defense-in-depth is fine), but the stated rationale is incorrect. A
maintainer reading these comments will believe the boundary leaks `NaN` and may
draw false conclusions from that premise (e.g. skip a guard elsewhere "because the
boundary already produces NaN and strategy handles it"). The `api.test.ts` suite
never exercises a coercion-failure path (it only tests `reward: "100"` → `100`), so
this false premise is untested and unchallenged.

**Fix:** Reframe the guards as deliberate defense-in-depth and correct the false
boundary claim. For example, in `strategy.ts:98-102`:
```ts
//   - its `reward` is a FINITE number (WR-01). The strategy core is pure and
//     accepts ANY `Ad`, so it does NOT assume the api.ts boundary already
//     screened the value. (In practice `adSchema`'s `z.coerce.number()` REJECTS
//     non-numeric strings and `z.number()` rejects NaN/Infinity, so the live
//     boundary cannot emit a non-finite reward — but a future schema change, a
//     non-HTTP caller, or a hand-built Ad could, and a NaN EV would silently fall
//     through `preferAd`'s comparisons.) A finite negative reward is NOT excluded;
//     only NaN/±Infinity.
```
Apply the same correction to the `isAttemptable` doc (`strategy.ts:116-117`) and
the WR-03 block (`strategy.ts:214-217`); in particular stop describing `cost` as
string-coerced. Optionally add an `api.test.ts` case asserting that a non-numeric
`reward` string yields a `BoundaryError` (not a NaN-bearing `Ad`), to pin the
actual boundary contract the comment now references.

### WR-02: `expectedValue` can still produce a non-finite EV from a finite reward (overflow), defeating the WR-01 guard for that path

**File:** `src/strategy.ts:128-131`, `src/strategy.ts:142-151`
**Issue:**
`isAttemptable` admits any *finite* `reward`, and `expectedValue` computes
`ad.reward * rankProbability(ad.probability)` (rank 0–10). The WR-01 rationale is
that a non-finite EV "would silently fall through `preferAd`" — yet a finite
reward near `Number.MAX_VALUE` overflows to `Infinity` once multiplied by the
rank, and two such ads make `preferAd`'s `evDiff = Infinity - Infinity = NaN`,
whereupon every comparison in `preferAd` (`evDiff > 0`, `evDiff < 0`, and both
expiry checks) is `false` and selection silently falls through to the reward
tiebreak. That is exactly the failure mode WR-01 claims to prevent, but the guard
checks `reward`, not the EV product, so it does not cover it.

This is **not reachable through the live API** (Mugloar rewards are small gold
values, never ~1.8e308), so it is a WARNING, not a BLOCKER. It is raised because
the WR-01 narrative explicitly justifies the guard by "a non-finite EV makes the
comparator fall through," yet leaves an EV path that can still go non-finite — an
internal inconsistency between the stated invariant and the code.

**Fix:** Either guard the actual quantity the comparator consumes, or drop the
claim. Minimal, lock-step-preserving option — guard EV inside the comparator:
```ts
function preferAd(current: Ad, candidate: Ad): Ad {
  const currentEv = expectedValue(current);
  const candidateEv = expectedValue(candidate);
  // A non-finite EV (e.g. reward * rank overflow) ranks worst — never allowed to
  // silently win via a NaN comparison.
  const candFinite = Number.isFinite(candidateEv);
  const curFinite = Number.isFinite(currentEv);
  if (candFinite && !curFinite) return candidate;
  if (!candFinite && curFinite) return current;
  const evDiff = candidateEv - currentEv;
  if (evDiff > 0) return candidate;
  if (evDiff < 0) return current;
  // ...existing expiry / reward tiebreaks
}
```
Alternatively, if overflow is deemed out of scope, remove the "non-finite EV falls
through the comparator" sentence from the WR-01 rationale so the guard is not
documented as covering a case it does not.

### WR-03: `Ad.reward` / `ShopItem.cost` typed as plain `number` permit non-finite values the boundary forbids, undercutting the contract

**File:** `src/types.ts:52`, `src/types.ts:62`
**Issue:**
`Ad.reward: number` and `ShopItem.cost: number` are typed as bare `number`, which
in TypeScript includes `NaN` and `±Infinity`. The strategy core then spends two
guards (WR-01, WR-03) defending against non-finite values, while the `api.ts`
boundary (per WR-01) actually rejects them — so the type, the boundary, and the
core disagree about whether a non-finite value is possible. TS cannot express a
"finite number" type, so the type itself cannot be tightened; but the *comments*
on these fields should record the real invariant rather than leaving it implicit.
Note `types.ts:35-36` already documents reward as "coerced to a number by the API
boundary" without stating the finiteness guarantee zod actually enforces.

This is a WARNING (a contract/clarity gap, not a crash).

**Fix:** Document the boundary-enforced finiteness on the field so the type's
looseness is explained and the strategy guards are correctly framed as
defense-in-depth, e.g.:
```ts
/** ... `reward` is coerced AND validated finite at the api.ts boundary
 *  (z.coerce.number() rejects non-numeric strings; non-finite values fail
 *  validation). Typed as bare `number` because TS cannot express "finite"; the
 *  strategy core re-checks finiteness defensively for non-boundary callers. */
reward: number;
```
(Same note for `cost`, which is `z.number()` — validated, never coerced.)

## Info

### IN-01: Stale plan-progress comment claims the file "grows across plans 02-01..02-04" but 02-05 landed the WR-* hardening

**File:** `src/strategy.ts:16-17`
**Issue:** The module header says "This file grows across plans 02-01..02-04
(D-01..D-12). ... Plan 02-04 completes the core ...". The WR-01/WR-02/WR-03 changes
were delivered by plan 02-05 (per the phase context and commit history), so the
header's "completes the core with ... 02-04" narrative omits the gap-closure pass
that introduced `isAttemptable` and the finite guards. The doc is out of sync with
the file's actual history.
**Fix:** Add a line such as: "02-05 (WR-01/WR-02/WR-03): added the shared
`isAttemptable` predicate keeping the primary and fallback ad filters in lock-step,
and finite guards on reward/cost."

### IN-02: `chooseAd` evaluates `isAttemptable` over `ads` twice on the no-eligible path

**File:** `src/strategy.ts:181-191`
**Issue:** When no ad clears the floor, `chooseAd` first calls
`filterEligibleAds(ads)` (which evaluates `isAttemptable` for every ad) and then,
on the empty result, calls `ads.filter(isAttemptable)` (re-evaluating
`isAttemptable` for every ad again). The eligible set is always a subset of the
solvable set, so the second pass repeats the first pass's `isAttemptable` work.
This is a minor clarity/redundancy note, not a correctness or (out-of-scope)
performance issue — selection results are identical.
**Fix:** Compute the solvable set once and derive eligibility from it:
```ts
export function chooseAd(ads: Ad[]): Ad | null {
  const solvable = ads.filter(isAttemptable);
  const eligible = solvable.filter(
    (ad) => rankProbability(ad.probability) >= PROBABILITY_FLOOR_RANK,
  );
  return bestOf(eligible.length > 0 ? eligible : solvable);
}
```
This also makes the lock-step relationship (the fallback relaxes ONLY the floor)
structurally explicit rather than relying on two filters happening to share
`isAttemptable`.

### IN-03: `api.ts request()` has an explicitly-unreachable final `throw` carrying a misleading `TransportError`

**File:** `src/api.ts:312-315`
**Issue:** The post-loop `throw new TransportError("Request failed: ...")` is
documented as "Unreachable in practice." It exists only to satisfy the type checker
(the function must return `T` or throw on every path). That is fine, but
classifying a genuinely-unreachable terminal as a `TransportError` (the *retryable*
class) is slightly misleading should it ever fire via a misconfigured
`maxAttempts` — a retryable error type implies the caller may retry, when this path
means "the loop was misconfigured and produced nothing."
**Fix:** Either keep it but annotate that the class is arbitrary-for-typing, or
throw a non-retryable `BoundaryError`/plain `Error` so a misconfiguration surfaces
as terminal.

### IN-04: WR-02 seam is asserted by a hand-built literal, not by a value actually returned from `ApiClient.buy()`

**File:** `src/strategy.test.ts:728-751`, `src/api.test.ts:313-343`
**Issue:** The "WR-02 seam reachability" test in `strategy.test.ts` constructs a
`rawBuyResult` literal and folds it through `applyBuyResult`, and the
`buy → raw BuyResult` test in `api.test.ts` asserts the client returns the raw
shape — but no single test wires the two together (call `client.buy(...)`, then
fold the actual returned value through `applyBuyResult`). The two halves of the
seam are each proven in isolation; the end-to-end "what `buy()` returns is exactly
what `applyBuyResult` consumes" claim in the test's own comment
(`strategy.test.ts:728-733`) is therefore asserted by construction, not exercised.
Type-compatibility makes a regression unlikely, but the regression guard is weaker
than its comment implies.
**Fix (low priority):** In a single test, `await new FakeApiClient({ buy:
[rawBuyResult] }).buy("g","hpot")` and fold that returned value through
`applyBuyResult`, asserting prior `score`/`highScore` survive — exercising the real
seam rather than a parallel literal.

---

_Reviewed: 2026-06-09T18:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
