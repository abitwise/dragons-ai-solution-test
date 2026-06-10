# Phase 03: Game Loop & Shop Integration - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 2 new (`src/runner.ts`, `src/runner.test.ts`)
**Analogs found:** 2 / 2 (both role-match within the same codebase)

> No `RESEARCH.md` exists for this phase. Patterns below are extracted from the
> LOCKED, feature-complete modules the runner composes (`strategy.ts`, `api.ts`,
> `types.ts`, `fake-api-client.ts`) and the existing colocated Vitest suites.

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/runner.ts` | imperative-shell orchestrator | request-response / batch loop (fetch → decide → act → update → log) | `src/strategy.ts` (module + import + doc-header conventions) + `src/api.ts` (the only other I/O-sequencing module; error classes consumed) | role-match (no existing orchestrator/loop yet — this is the first imperative shell) |
| `src/runner.test.ts` | offline test suite | request-response (drives loop via injected double) | `src/fake-api-client.test.ts` (FakeApiClient instantiation + scripting) + `src/api.test.ts` (typed-error `.rejects.toBeInstanceOf` idiom) + `src/strategy.test.ts` (fixture-builder + describe/it conventions) | exact (FakeApiClient was BUILT to drive exactly this) |

---

## Pattern Assignments

### `src/runner.ts` (imperative-shell orchestrator, fetch→decide→act→update→log loop)

There is no existing orchestrator to copy a loop from — `runner.ts` is the first
imperative shell. So the analog supplies **conventions and contracts**, not loop
shape. The loop shape is specified by CONTEXT.md D-01..D-14; the runner must match
the established module style and call the LOCKED signatures verbatim.

**Module style / doc-header + import convention** — copy from `src/strategy.ts` lines 1-46.
Every module opens with a block comment naming its responsibility and its
"performs NO X" boundaries, then imports types from `./types.js` with the `.js`
extension (ESM, type-only import):
```typescript
import type { Ad, BuyResult, GameState, ShopItem, SolveResult } from "./types.js";
```
The runner additionally imports the pure strategy functions and (for production
wiring only — but the test needs the error classes) is composed against the
`ApiClient` / `Logger` interfaces, never `HttpApiClient` / `console`:
```typescript
import {
  applyBuyResult,
  applySolveResult,
  chooseAd,
  chooseShopPurchase,
} from "./strategy.js";
import type { ApiClient, GameReport, GameState, Logger } from "./types.js";
```
(Import-grouping/`.js`-suffix idiom mirrored from `src/strategy.test.ts` lines 1-10.)

**Signature (LOCKED — ARCHITECTURE.md / carry-forward).** Export exactly:
```typescript
export async function playGame(api: ApiClient, logger: Logger): Promise<GameReport>;
```

**Named-constant convention for tunable knobs** — copy the const-at-top-of-module
style from `src/strategy.ts` lines 47-54 (`PROBABILITY_FLOOR_RANK`,
`MAX_LIVES_TO_KEEP`, `HEAL_BUFFER_GOLD` — `SCREAMING_SNAKE`, each with a one-line
`// (D-xx)` doc). The runner's knobs (D-05/D-06/D-08, "Specific Ideas"):
```typescript
/** Generous backstop; the turn-based cap (D-05). */
const MAX_TURN = 2000;
/** Abort after this many consecutive iterations with no turn advance (D-06). */
const NO_PROGRESS_LIMIT = 3;
/** The closed, greppable end-reason vocabulary returned verbatim in GameReport (D-08). */
const END = {
  GAME_OVER: "game over: lives reached 0",
  TURN_CAP: "stopped: max-turn cap reached",
  NO_PROGRESS: "stopped: no-progress guard tripped",
} as const;
```
(Use a `const` object, NOT a TS `enum` — CLAUDE.md stack rules forbid `enum`/`namespace`.)

**State-threading pattern (D-04) — fold results, never assign raw.** The merge
helpers in `src/strategy.ts` lines 261-298 are the ONLY way state advances.
`api.buy()` returns a raw `BuyResult` (no `score`/`highScore`); `api.solve()`
returns a raw `SolveResult` (no `level`). The runner MUST fold:
```typescript
// after a buy:
state = applyBuyResult(state, await api.buy(state.gameId, item.id));
// after a solve:
state = applySolveResult(state, await api.solve(state.gameId, ad.adId));
```
Never `state = await api.buy(...)` — that would zero `score` (the asymmetry guard
documented at `strategy.ts` lines 280-287).

**Decision delegation (LOCKED strategy contracts the runner calls).** From
`src/strategy.ts`:
- `chooseShopPurchase(state, shop): ShopItem | null` — lines 223-248. `null` =
  nothing to buy (drains the shop phase per D-02).
- `chooseAd(ads): Ad | null` — lines 181-192. `null` = truly empty/no-solvable
  board (the least-bad-gamble fallback is already INSIDE it — strategy.ts lines
  187-191), so a `null` here feeds the no-progress guard, NOT a crash (D-14).

**The shop-phase drain (D-01/D-02), composed from the above:**
```typescript
// fetch → decide → act → update, repeated until null OR shoppingSuccess:false
let shop = await api.getShop(state.gameId);
let item = chooseShopPurchase(state, shop);
while (item !== null) {
  const result = await api.buy(state.gameId, item.id);
  state = applyBuyResult(state, result);
  if (!result.shoppingSuccess) break;          // D-02: can't afford → stop re-buy loop
  shop = await api.getShop(state.gameId);       // re-fetch after the turn-consuming buy
  item = chooseShopPurchase(state, shop);
}
```

**Ads fetched FRESH right before the solve (D-03 / LOOP-03).** Always call
`api.getMessages` after the shop phase, immediately before `chooseAd`, so
`expiresIn` is current at decision time:
```typescript
const ads = await api.getMessages(state.gameId);
const ad = chooseAd(ads);
if (ad !== null) {
  state = applySolveResult(state, await api.solve(state.gameId, ad.adId));
}
```

**Termination guards (D-05/D-06/D-07).** Track previous `state.turn`; if it fails
to advance for `NO_PROGRESS_LIMIT` consecutive iterations → `END.NO_PROGRESS`;
if `state.turn > MAX_TURN` → `END.TURN_CAP`; loop exits on `lives === 0` →
`END.GAME_OVER`. Reset the stall counter whenever `turn` advances.

**Error pattern (D-11) — pass-through, do NOT catch-and-wrap.** The runner adds
NO try/catch around the API calls (Phase 1 already retries reads; solve/buy never
retry). A thrown `TransportError`/`BoundaryError` (`src/api.ts` lines 52-77)
propagates as a rejected promise carrying the ORIGINAL typed error. Optionally
`logger.error(...)` in-context before it unwinds, but never re-throw a new type.
This is the inverse of a typical controller: there is deliberately no error
boundary here — `index.ts` (Phase 4) owns the catch.

**Report shape (D-08/D-09).** Return `GameReport` from `src/types.ts` lines 100-105:
```typescript
return { score: state.score, turns: state.turn, reason: END.GAME_OVER };
```
`turns` is the API's `state.turn` (NOT a private iteration counter); `reason` is
one of the three `END` constants verbatim. There is NO `API_ERROR` reason (D-10).

---

### `src/runner.test.ts` (offline test suite, FakeApiClient-driven)

**Analog (test scaffolding):** `src/fake-api-client.test.ts`
**Analog (typed-error rejection idiom):** `src/api.test.ts`
**Analog (fixture-builder + describe/it style):** `src/strategy.test.ts`

**Vitest imports + colocated-test convention.** Tests live in `src/` next to the
module (NOT in a `tests/` dir — despite ARCHITECTURE.md's `tests/runner.test.ts`
sketch, the established convention across all existing suites is colocation).
From `src/fake-api-client.test.ts` lines 1-3:
```typescript
import { describe, expect, it } from "vitest";
import { FakeApiClient } from "./fake-api-client.js";
import type { Ad, BuyResult, GameState, ShopItem, SolveResult } from "./types.js";
```
Plus the unit under test and the error classes the rejection cases assert on
(error-class import mirrored from `src/api.test.ts` line 20):
```typescript
import { playGame } from "./runner.js";
import { BoundaryError, TransportError } from "./api.js";
```

**Fixture-builder pattern** — copy from `src/strategy.test.ts` lines 44-90 and
`src/fake-api-client.test.ts` lines 20-47: small named factory functions returning
fully-typed objects with `Partial<T>` overrides, so each test tweaks only the
field it exercises. Reuse these exact shapes:
```typescript
const baseState = (o: Partial<GameState> = {}): GameState =>
  ({ gameId: "g1", lives: 3, gold: 0, level: 0, score: 0, highScore: 0, turn: 0, ...o });

const solveFixture = (o: Partial<SolveResult> = {}): SolveResult =>
  ({ success: true, lives: 3, gold: 10, score: 10, highScore: 10, turn: 1, message: "ok", ...o });

const adFixture = (adId: string): Ad =>
  ({ adId, message: `do ${adId}`, reward: 10, expiresIn: 3, probability: "Sure thing" });
```
A silent/spy `Logger` is needed (the runner depends on the interface, not
`console`); pass a no-op object or `vi.fn()`-backed stub:
```typescript
const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
```

**Driving the loop — script FakeApiClient with per-method FIFO queues.** Pattern
from `src/fake-api-client.test.ts` lines 50-84: construct `new FakeApiClient({...})`
with array sources (dequeued FIFO) or function sources. The game-over script
ends with a `lives: 0` solve (fixture pattern at that file's lines 59-68):
```typescript
const fake = new FakeApiClient({
  startGame: [baseState()],
  getShop: [[], []],                                  // shop phase buys nothing
  getMessages: [[adFixture("a1")], [adFixture("a2")]],
  solve: [solveFixture({ turn: 1 }), solveFixture({ success: false, lives: 0, turn: 2 })],
});
const report = await playGame(fake, logger);
expect(report).toEqual({ score: /* final */, turns: 2, reason: "game over: lives reached 0" });
```

**Asserting recorded calls (re-fetch proof for D-03/LOOP-03).** `FakeApiClient`
records every call in `.calls` (fake-api-client.ts lines 60 + 88-93; asserted in
fake-api-client.test.ts lines 110-123). Use it to prove `getMessages` was called
fresh after the shop phase:
```typescript
expect(fake.calls.map((c) => c.method)).toContain("getMessages");
// or assert ordering: getShop/buy precede the getMessages before each solve
```

**Typed-error rejection idiom (D-12)** — copy EXACTLY from `src/api.test.ts`
lines 226 / 254 / 262. Script a method as a throwing function source, then:
```typescript
const fake = new FakeApiClient({
  startGame: [baseState()],
  getShop: [[]],
  getMessages: () => { throw new BoundaryError("boom", 400); },
});
await expect(playGame(fake, logger)).rejects.toBeInstanceOf(BoundaryError);
// (and a TransportError variant — both per D-12)
```

**"Failure body is normal play" cases (D-13).** A `solve` with `success:false`
(but `lives > 0`) and a `buy` with `shoppingSuccess:false` must NOT reject — the
loop continues. Assert `playGame` resolves to a `GameReport`, and that the run
proceeded past those bodies (e.g. reached a later `lives:0` game-over). Contrast
with the throwing case above: only THROWN errors reject.

---

## Shared Patterns

### Injected-seam composition (manual DI)
**Source:** `src/types.ts` lines 118-136 (`ApiClient`, `Logger` interfaces) and
`src/fake-api-client.ts` lines 54-117 (`FakeApiClient implements ApiClient`).
**Apply to:** Both new files. The runner takes `api: ApiClient` and
`logger: Logger` as parameters — DI is "pass one argument," never a container
(CLAUDE.md). Production wires `HttpApiClient`; the test wires `FakeApiClient`.
Neither new file imports `fetch`, `zod`, `pino`, or `console`.

### State merge (the score-preservation guard)
**Source:** `src/strategy.ts` lines 261-298 (`applySolveResult` / `applyBuyResult`).
**Apply to:** Every state transition in `runner.ts`. `api.buy()` returns a raw
`BuyResult` with NO `score`/`highScore`; the runner MUST fold it via
`applyBuyResult` against the prior state, else the reported score is silently
zeroed (the load-bearing subtlety, strategy.ts lines 280-287). Same for
`applySolveResult` carrying `level` forward.

### Typed errors propagate (no new error type, no swallow)
**Source:** `src/api.ts` lines 52-77 (`TransportError`, `BoundaryError`, both
`extends Error` with `readonly status?` + `{ cause }`).
**Apply to:** `runner.ts` (D-11 — pass-through, optional in-context
`logger.error`) and `runner.test.ts` (D-12 — assert with
`.rejects.toBeInstanceOf(BoundaryError | TransportError)`, the idiom at
api.test.ts lines 226/254/262).

### Fail-loud test double
**Source:** `src/fake-api-client.ts` lines 94-116 (exhausted/absent queue throws
naming the method).
**Apply to:** `runner.test.ts` — script EXACTLY the responses each scenario
consumes; an over-run loop will reject with a clear `FakeApiClient: no scripted
response for <method>` rather than producing a misleading green. This naturally
catches a runner that fetches more than expected.

### Module doc-header + `.js` ESM imports + SCREAMING_SNAKE constants
**Source:** `src/strategy.ts` lines 1-54.
**Apply to:** `runner.ts` — open with a responsibility/boundary block comment,
import types from `./types.js` (type-only, `.js` suffix), and surface loop knobs
as documented top-of-file constants.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/runner.ts` (loop shape only) | orchestrator | batch loop | No existing imperative-shell / turn-loop module exists — `runner.ts` is the first. Conventions (style, imports, constants, DI, error pass-through, state-merge) ARE covered by analogs above; only the literal loop control-flow (shop drain + dual guards + fold-and-continue) has no in-repo precedent and must follow CONTEXT.md D-01..D-14. |

## Metadata

**Analog search scope:** `src/` (the entire flat six-file source tree per ARCHITECTURE.md)
**Files scanned:** `types.ts`, `strategy.ts`, `strategy.test.ts`, `fake-api-client.ts`, `fake-api-client.test.ts`, `api.ts`, `api.test.ts`; `package.json` (test scripts / colocation convention)
**Pattern extraction date:** 2026-06-10
