# Phase 2: Strategy Core — Pure Decision Logic (TDD) - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 2 new (`src/strategy.ts`, `src/strategy.test.ts`)
**Analogs found:** 2 / 2 (both exact — `src/decode.ts` / `src/decode.test.ts`)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/strategy.ts` (new) | functional-core module (pure decision logic) | transform (plain-object in → decision/state out, no I/O) | `src/decode.ts` | exact — both are pure, deterministic, `types.js`-only modules with named-const config + small exported pure functions |
| `src/strategy.test.ts` (new) | unit test | transform (table-driven, hand-built fixtures, no mocks/network) | `src/decode.test.ts` | exact — both are pure-function suites with plain-object fixture builders, no `FakeApiClient`, no `fetch`, no `vi.spyOn` |

Both new files map to exactly one analog pair. `src/api.ts` is a **partial** analog only for the STRAT-06 merge subtlety (the `buy()` `score:0`/`highScore:0` placeholder, lines 209–225) — read it as a *contract reference*, NOT as a style template (it imports `zod`, calls `fetch`, and is the imperative shell; strategy must do none of that).

---

## Pattern Assignments

### `src/strategy.ts` (functional-core module, pure transform)

**Analog:** `src/decode.ts` (the only existing pure functional-core module). Copy its shape exactly: a JSDoc file header that names the governing decisions, type-only import of `types.js`, named `const` config at the top, small pure helper + exported pure functions, no side effects, never throws.

**File header pattern** (`src/decode.ts` lines 1–23) — open with a block comment that (1) names the module and its one job, (2) states the contract referencing the locked decisions (here D-01..D-12), and (3) asserts purity. Mirror this voice:
```typescript
/**
 * `decodeAd` — the pure, cross-field encryption-decode step (D-03).
 * ...
 * Contract (D-08 / D-09):
 *   - KNOWN scheme ...: decode ... and CLEAR the flag.
 *   - UNKNOWN scheme ...: return the ad UNCHANGED — never drop, never throw ...
 * ... The function is pure and synchronous ... so one corrupt ad can never crash the process.
 */
```
For `strategy.ts`, the header should cite STRAT-01..06 + D-01..D-12 and state: pure, imports only `types.js`, never throws, no `fetch`/`zod`/`pino`/network.

**Import pattern** (`src/decode.ts` line 23) — ESM with the `.js` extension, type-only import (mandatory under `verbatimModuleSyntax: true` in `tsconfig.json`):
```typescript
import type { Ad, GameState, ShopItem, SolveResult, BuyResult } from "./types.js";
```
Strategy is value-free at import time: it consumes only **types**, so the entire import line is `import type`. Do NOT import `decodeAd`, `ApiClient`, `zod`, `pino`, or anything from `api.js` / `fake-api-client.js`.

**Named-constant pattern** (`src/decode.ts` lines 25–33) — module-level `const` with an explanatory comment, UPPER_SNAKE for the magic numbers. No `enum` (CLAUDE.md bans `enum`/`namespace`/decorators):
```typescript
const ENCRYPTED_BASE64 = 1;
const ENCRYPTED_ROT13 = 2;
```
Apply to the thresholds named in CONTEXT D-02/D-08/D-10 + "Specific Ideas":
```typescript
const PROBABILITY_FLOOR_RANK = 6;   // Hmmm.... and safer (D-02)
const MAX_LIVES_TO_KEEP = 3;        // heal below a full life buffer (D-08)
const HEAL_BUFFER_GOLD = 100;       // ~2 potions reserved before any upgrade (D-10)
```
The rank table is the strategy analog of `ENCRYPTED_BASE64`: an exact-string-keyed lookup over the 11 verified labels from `research/FEATURES.md` lines 74–86. Use a `const` object (a `Record<string, number>` or `Map`); under `noUncheckedIndexedAccess` a `record[label]` lookup is `number | undefined`, so the unknown→worst rule (D-01) falls out of `?? 0` — exactly the `decoded.encrypted ?? 0` idiom already in `decode.test.ts` line 51. **Match `"Hmmm...."` on its exact four-dot string** (D-01 / PITFALLS / FEATURES.md line 80).

**Pure-helper-then-exported-function pattern** (`src/decode.ts` lines 40–86 helpers, 94–121 the exported entry) — keep internal mechanics as un-exported `function`s (e.g. `decodeBase64`, `rot13`, `decoderFor`), expose only the few functions the runner calls. For strategy, the exported surface (names at planner discretion per CONTEXT "Claude's Discretion") covers: rank lookup, eligibility filter, `chooseAd` selection, the shop decision(s), and the two merge helpers.

**Never-throw / total-function pattern** (`src/decode.ts` lines 76–86, 94–100) — use a `switch` with a `default` that returns a safe value, and early-return pass-throughs instead of throwing. Strategy mirrors this: unknown label → rank 0 (never throw, D-01); empty/all-ineligible board → explicit "no ad" signal (`null` or a small discriminated result, D-07), never an exception.

**Purity / no-mutation pattern** (`src/decode.ts` lines 88–121) — return a NEW object via spread (`{ ...ad, ...changes }`); never mutate the input. The merge helpers MUST follow this:
```typescript
// applySolveResult: carry `level` forward (SolveResult has no level) — spread, don't mutate.
return { ...state, lives: r.lives, gold: r.gold, score: r.score,
         highScore: r.highScore, turn: r.turn /* level: from state */ };
// applyBuyResult: carry `score`/`highScore` forward (BuyResult has neither) — see api.ts subtlety below.
return { ...state, lives: r.lives, gold: r.gold, level: r.level, turn: r.turn /* score/highScore: from state */ };
```

**STRAT-06 contract reference (NOT a style template):** `src/api.ts` `buy()` lines 209–225 returns a `GameState` with `score: 0, highScore: 0` placeholders because the client has no prior state to merge. The `types.ts` field asymmetry is the source of truth: `SolveResult` (lines 72–80) has **no `level`**; `BuyResult` (lines 92–98) has **no `score`/`highScore`**. The cleanest pure-function choice (recommended by CONTEXT) is for `applyBuyResult` to consume the **raw `BuyResult`** and fold it into the prior `GameState`, so `score`/`highScore` are preserved across a buy — and a unit test must prove it.

---

### `src/strategy.test.ts` (unit test, table-driven transform)

**Analog:** `src/decode.test.ts` (the only pure-function suite — no mocks, no network, no `FakeApiClient`).

**Import pattern** (`src/decode.test.ts` lines 1–3) — Vitest named imports (alphabetized: `describe, expect, it`), the unit under test via `.js`, types via `import type`:
```typescript
import { describe, expect, it } from "vitest";
import { chooseAd, rankProbability, /* ...exported strategy fns */ } from "./strategy.js";
import type { Ad, GameState, SolveResult, BuyResult, ShopItem } from "./types.js";
```
Do NOT import `FakeApiClient` (CONTEXT is explicit: strategy never touches the client, so its tests never need the double — unlike `fake-api-client.test.ts`).

**Fixture-builder pattern** (`src/decode.test.ts` lines 22–32) — a `baseX(overrides: Partial<X> = {}): X` helper returning a complete valid object spread-merged with per-case overrides. This is THE fixture idiom to copy:
```typescript
/** A complete, plaintext baseline ad we mutate per case. */
function baseAd(overrides: Partial<Ad> = {}): Ad {
  return {
    adId: "abc123",
    message: "Help the villagers",
    reward: 100,
    expiresIn: 3,
    probability: "Sure thing",
    ...overrides,
  };
}
```
Build a `baseAd`, a `baseState(overrides): GameState`, a `baseSolve(overrides): SolveResult`, a `baseBuy(overrides): BuyResult`, and a `shopItem(id, cost, name?)` helper the same way. (The arrow-function fixture form in `fake-api-client.test.ts` lines 30–47 — `const solveFixture = (overrides: Partial<SolveResult> = {}): SolveResult => ({ ... })` — is an equally-accepted variant in this codebase; pick one and be consistent.)

**describe/it nesting + naming pattern** (`src/decode.test.ts` lines 34–104) — one top-level `describe(<functionName>)`, nested `describe`s per scenario family, `it("<plain-English behavior incl. the decision id>")`. Match the prose style:
```typescript
describe("rankProbability", () => {
  describe("known labels (D-01)", () => {
    it("maps the exact four-dot 'Hmmm....' to rank 6", () => { /* ... */ });
  });
  describe("unknown label (D-01 worst-and-never-throw)", () => {
    it("ranks an unseen label 0 and does not throw", () => { /* ... */ });
  });
});
```

**Table-driven assertion pattern** — the 11-label rank table (FEATURES.md lines 74–86) is a natural `it.each`/loop or one `it` per label; either matches the analog's explicit-case style (`decode.test.ts` lines 35–104 favor one explicit `it` per behavior). Mirror the exact-equality assertions used there: `expect(x).toBe(...)` for scalars, `expect(x).toEqual(...)` for whole objects, and `expect(() => fn()).not.toThrow()` for the never-throw guarantees (`decode.test.ts` lines 157–159).

**Worth-having cases (from CONTEXT "Specific Ideas", all plain-object fixtures):**
- every one of the 11 labels → its rank incl. exact `"Hmmm...."`, plus unknown → 0 (D-01);
- mixed board where EV (`reward × rank`) picks a moderate-reward safe ad over a high-reward risky one; floor drops `Gamble`/`Risky`/expired/still-encrypted ads (D-02/D-03);
- expiry-aware tiebreak: equal-EV → sooner-expiring wins, then higher reward (D-05);
- all-sub-floor board → least-bad gamble returned (D-06); empty board → "no ad" signal (D-07);
- heal at `lives < 3` only when affordable (D-08); upgrade only when `gold − cost ≥ 100` and lives healthy, picking priciest affordable non-`hpot` (D-09/D-10/D-11);
- solve-merge preserves `level`; buy-merge preserves `score`/`highScore` (D-12).

**Non-mutation assertion pattern** (`src/decode.test.ts` lines 57–69) — for the merge helpers, snapshot the input and assert it is untouched, the same way `decodeAd` "does not mutate" is proved:
```typescript
const state = baseState();
const snapshot = { ...state };
applySolveResult(state, baseSolve());
expect(state).toEqual(snapshot);   // pure: prior state object never mutated
```

---

## Shared Patterns

### Module-header doc comment citing decision IDs
**Source:** `src/decode.ts` lines 1–23 (also `api.ts` 1–26, `types.ts` 1–10, `fake-api-client.ts` 1–24).
**Apply to:** `strategy.ts` (cite STRAT-01..06 + D-01..D-12 and assert purity); `strategy.test.ts` (a short header listing what the suite proves, like `decode.test.ts` 5–9 and `api.test.ts` 1–17).

### ESM `.js`-extension imports + `import type` for type-only deps
**Source:** `src/decode.ts` line 23; `decode.test.ts` lines 1–3; enforced by `tsconfig.json` `verbatimModuleSyntax: true` + `module/moduleResolution: nodenext`.
**Apply to:** every import in both new files. Strategy's entire `types` import is `import type`.

### Named-`const` config, no `enum`
**Source:** `src/decode.ts` lines 25–33; `api.ts` lines 32–38.
**Apply to:** `PROBABILITY_FLOOR_RANK`, `MAX_LIVES_TO_KEEP`, `HEAL_BUFFER_GOLD`, and the rank lookup table at the top of `strategy.ts`. CLAUDE.md bans `enum`/`namespace`/decorators — use `const` + string-literal/`Record` instead.

### `noUncheckedIndexedAccess` → `?? worst` for unknown keys
**Source:** the `decoded.encrypted ?? 0` idiom (`decode.test.ts` line 51) and the `decoderFor` `default` (`decode.ts` lines 76–86); `tsconfig.json` sets `noUncheckedIndexedAccess: true`, so any `rankTable[label]` is `number | undefined`.
**Apply to:** `rankProbability` — `return RANK[label] ?? 0;` is the entire unknown→worst rule (D-01), no `if`/throw needed.

### Pure, never-mutate, return-new-object
**Source:** `src/decode.ts` lines 94–121 (spread to a new object; original returned unchanged on pass-through).
**Apply to:** the eligibility filter (return a new array), `chooseAd` (read-only over the input), and both merge helpers (`{ ...state, ...partial }`).

### Total functions: explicit "nothing" signal, never throw
**Source:** `src/decode.ts` `switch`/`default` + early returns (lines 76–121).
**Apply to:** `chooseAd` returns `Ad | null` (or a small discriminated result) for the empty-board case (D-07); `rankProbability` returns 0 for unknown (D-01). Neither throws.

### Plain-object fixtures, zero mocks/network (TEST-01)
**Source:** `src/decode.test.ts` lines 22–32 (`baseAd` builder); `fake-api-client.test.ts` lines 20–47 (typed const + arrow-builder fixtures).
**Apply to:** all of `strategy.test.ts`. Per CONTEXT: no `FakeApiClient`, no `vi.spyOn`, no `fetch`, no `nock`/`msw` — strategy is pure, so fixtures are hand-built literals.

### Biome formatting
**Source:** `biome.json` — 2-space indent, double quotes, always semicolons, 100-char line width, organize-imports on.
**Apply to:** both new files (run `biome check --write` before commit; keep imports alphabetized as in `decode.test.ts` line 1).

---

## No Analog Found

None. Every new file has an exact in-repo analog (`decode.ts` / `decode.test.ts`). No need to fall back to RESEARCH.md patterns — and there is no phase RESEARCH.md anyway (research was intentionally skipped; `research/FEATURES.md` supplies the rank table and shop catalog as data, not as code patterns).

## Metadata

**Analog search scope:** `src/` (7 files: `types.ts`, `decode.ts`, `decode.test.ts`, `api.ts`, `api.test.ts`, `fake-api-client.ts`, `fake-api-client.test.ts`); config: `tsconfig.json`, `biome.json`.
**Files scanned:** 9
**Pattern extraction date:** 2026-06-09
