---
phase: 03-game-loop-shop-integration
reviewed: 2026-06-10T18:08:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/runner.ts
  - src/runner.test.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-06-10T18:08:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed `src/runner.ts` (the `playGame` orchestrator and `drainShop` helper) and `src/runner.test.ts` (the offline FakeApiClient-driven Vitest suite). The implementation is structurally sound: all stated architectural invariants hold — no `fetch`/`zod`/`pino`/`console` imports, no raw API result assignment to `GameState`, no `try/catch` around API calls, and the `END` const object correctly avoids TS enums. All 13 tests pass, `tsc --noEmit` is clean, and Biome reports no errors.

Two warnings are raised: the termination-invariant claim ("non-termination impossible") is overstated because the `drainShop` inner loop lacks any cap and cannot be interrupted by the outer-loop guards, and the `MAX_TURN` constant is duplicated (unexported) between the implementation and its test in a way that creates a silent test-validity hazard on constant changes. Two info items cover a loosely-typed `GameReport.reason` and missing `warn`-level logging for guard trips.

## Warnings

### WR-01: `drainShop` inner loop is unbounded — outer-loop termination guards do not cover it

**File:** `src/runner.ts:75-92`
**Issue:** The plan's invariant "the loop can NEVER run forever" (D-07, runner.ts line 106) applies only to the outer `while (state.lives > 0)` loop via the `shouldStop` guard. The `drainShop` inner `while (item !== null)` loop has no iteration cap. If the API returns `shoppingSuccess: true` on every buy while the gold field in the response is unchanged (a buggy or hostile server), `chooseShopPurchase` will keep finding the item affordable and recommending it, and `drainShop` will loop forever — control never returns to the outer loop, so neither the `MAX_TURN` cap nor the `NO_PROGRESS` stall counter can fire. The existing test suite does not cover a function-source `buy` that returns `shoppingSuccess: true` indefinitely, so the gap is invisible to the current test matrix.

The failure mode requires a misbehaving API (the real Mugloar server won't do this), but it falsifies the stated correctness claim made in the module's doc comment.

**Fix:** Add a per-drain iteration cap. The simplest correct approach mirrors the outer-loop guard:

```typescript
async function drainShop(api: ApiClient, state: GameState): Promise<GameState> {
  const MAX_BUYS_PER_TURN = 20; // generous; a real shop has O(10) items
  let buys = 0;
  let shop = await api.getShop(state.gameId);
  let item = chooseShopPurchase(state, shop);

  while (item !== null && buys < MAX_BUYS_PER_TURN) {
    buys += 1;
    const result = await api.buy(state.gameId, item.id);
    state = applyBuyResult(state, result);
    if (!result.shoppingSuccess) break;
    shop = await api.getShop(state.gameId);
    item = chooseShopPurchase(state, shop);
  }

  return state;
}
```

Alternatively, remove the "non-termination impossible" doc claim to accurately scope the guarantee to the outer loop only, and add a corresponding test with a function-source `buy` that always returns `shoppingSuccess: true` with unchanged gold to document the known gap.

---

### WR-02: `MAX_TURN` constant is duplicated (unexported) — test validity silently drifts on value change

**File:** `src/runner.test.ts:196`
**Issue:** `runner.ts` declares `const MAX_TURN = 2000` (line 30) but does not export it. The test file re-declares `const MAX_TURN = 2000` (line 196) as a mirror. The cap test's key assertion is `expect(report.turns).toBeGreaterThan(MAX_TURN)` using the test-local copy. If `runner.ts` changes `MAX_TURN` (e.g. to 1000 for a tighter cap), but the test copy is not updated, `report.turns` would be ~1001 but the assertion would check `1001 > 2000` — a false result that fails the test even though the cap fired correctly. The test would give a **false negative** on valid implementation behavior, masking real issues.

The test comment acknowledges the mirroring ("Mirrors `MAX_TURN` in runner.ts") but does not protect against silent divergence.

**Fix:** Export `MAX_TURN` from `runner.ts` so the test can import it, eliminating the duplication:

```typescript
// runner.ts — change `const` to `export const`:
export const MAX_TURN = 2000;
```

```typescript
// runner.test.ts — replace the local re-declaration:
import { playGame, MAX_TURN } from "./runner.js";
// Remove: const MAX_TURN = 2000;
```

If exporting an implementation constant feels like a leaky API, the alternative is to keep the constant unexported but assert `report.turns > 0 && report.reason === REASON.TURN_CAP` without referencing `MAX_TURN`, relying on the scripted `solveCalls > MAX_TURN + 50` safety throw to detect an unwired guard.

---

## Info

### IN-01: `GameReport.reason` typed as `string` — closed vocabulary not enforced by the type system

**File:** `src/types.ts:104`
**Issue:** `GameReport.reason` is typed as `string`. The implementation returns only one of the three `END` constants, and the test asserts verbatim strings (by design, to catch wording drift). However, callers of `playGame` cannot use the type system to exhaustively switch on `reason` or have the compiler enforce that only the three-value vocabulary is possible. A future maintainer adding a fourth `END` constant would get no compile-time error if they forget to update downstream consumers that switch on `reason`.

**Fix:** Export the `END` object (or a derived type alias) from `runner.ts` and narrow `GameReport.reason`:

```typescript
// runner.ts
export const END = { ... } as const;
export type EndReason = typeof END[keyof typeof END];
```

```typescript
// types.ts
import type { EndReason } from "./runner.js"; // or inline the union
export interface GameReport {
  score: number;
  turns: number;
  reason: EndReason;
}
```

Note: this creates a circular dependency if `runner.ts` imports from `types.ts` and `types.ts` imports from `runner.ts`. The clean resolution is to define `END`/`EndReason` in `types.ts` directly, separate from `runner.ts`.

---

### IN-02: Abnormal termination paths logged at `info` level instead of `warn`

**File:** `src/runner.ts:152`
**Issue:** Guard-tripped terminations (`END.TURN_CAP` and `END.NO_PROGRESS`) are logged with `logger.info`. Both represent abnormal game ends — the `TURN_CAP` fires only when the turn counter climbs past 2000 without a `lives === 0` exit (an API anomaly or a bot logic failure), and `NO_PROGRESS` fires when no turn-consuming action succeeds for 3 consecutive iterations. These conditions are diagnostically distinct from a normal game-over and warrant `logger.warn` to make them stand out in production output.

**Fix:**

```typescript
// runner.ts line 151-153:
if (stop !== null) {
  const report: GameReport = { score: state.score, turns: state.turn, reason: stop };
  logger.warn("game stopped by guard", report); // warn: not a normal game-over
  return report;
}
```

---

_Reviewed: 2026-06-10T18:08:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
