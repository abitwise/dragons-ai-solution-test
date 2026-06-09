---
phase: 02-strategy-core-pure-decision-logic-tdd
verified: 2026-06-09T18:10:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/5
  gaps_closed:
    - "WR-02: buy() seam now returns Promise<BuyResult> across types.ts/api.ts/fake-api-client.ts — no GameState construction, no score:0/highScore:0 placeholders; applyBuyResult is reachable end-to-end; regression test at strategy.test.ts:728-751 proves prior score/highScore survive the buy merge"
    - "WR-01: non-finite reward ads dropped in BOTH filterEligibleAds (via shared isAttemptable predicate at strategy.ts:124-126) AND the chooseAd fallback solvable filter (strategy.ts:190) — lock-step via shared function, not duplicate predicates"
    - "WR-03: Number.isFinite(item.cost) guards present in BOTH the heal lookup (strategy.ts:228) and the upgrade affordableUpgrades filter (strategy.ts:238) — NaN/-Infinity cost never fires a heal or passes as a free upgrade"
  gaps_remaining: []
  regressions: []
---

# Phase 02: Strategy Core — Pure Decision Logic (TDD) Verification Report

**Phase Goal:** All "what should the bot do" logic exists as pure, fully test-driven functions in `strategy.ts`, so decisions are deterministic, readable, and proven before any loop integrates them.
**Verified:** 2026-06-09T18:10:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure plan 02-05 (WR-01, WR-02, WR-03)

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Every one of the 11 probability strings (including the exact `"Hmmm...."` four-dot label) maps to its rank; unknown string ranks worst and never throws | VERIFIED | `strategy.ts:63-86` — `RANK` table with all 11 strings exact; `"Hmmm...."`: 6 at line 68; `rankProbability` uses `?? 0` for unknown→worst; `strategy.test.ts:112-157` — `it.each` over all 11 labels, explicit four-dot test, never-throw asserts; 116 tests green |
| 2 | Given a mixed board, the chosen ad is best by EV (`reward × rank`) after filtering expired/sub-floor/unhandled-encryption ads with expiry-aware tiebreak; empty/all-risky board yields defined fallback, not a crash | VERIFIED | `strategy.ts:107-191` — `filterEligibleAds` + `isAttemptable` + `expectedValue` + `preferAd` + `chooseAd` with fallback and null signal; `strategy.test.ts:273-447` — EV beats raw reward, tiebreak, least-bad gamble, empty/encrypted/expired boards return null, never-throw, non-mutation all proven |
| 3 | Applying a solve result and applying a buy result each merge into game state correctly — solve omits `level`, buy omits `score` — without clobbering the missing field | VERIFIED | `strategy.ts:261-298` — `applySolveResult` spreads state then overrides SolveResult fields (carries `level` forward); `applyBuyResult` spreads state then overrides BuyResult fields (carries `score`/`highScore` forward); `strategy.test.ts:628-769` — carry-forward, WR-02 seam-reachability, and non-mutation tests all pass; `types.ts:123` + `api.ts:209-216` confirm seam is symmetric |
| 4 | Bot decides to buy `hpot` when lives are low and gold allows; only buys level-raising upgrade from surplus gold after reserving healing buffer | VERIFIED | `strategy.ts:223-248` — `chooseShopPurchase` heals when `lives < MAX_LIVES_TO_KEEP(3)` and `Number.isFinite(cost) && cost <= gold`; upgrade branch gated on healthy lives only; `HEAL_BUFFER_GOLD(100)` reserve enforced; priciest affordable non-hpot selected; `strategy.test.ts:449-626` — 20 shop tests including live-cost proof and NaN-cost degradation all pass |
| 5 | Strategy test suite covers all of the above and runs fast and deterministically with no mocks and no network (inputs are plain objects) | VERIFIED | `npx vitest run` → 116 tests, 4 suites, 180ms, all green; `strategy.test.ts` uses only plain object fixture builders (baseAd/baseState/shopItem/baseSolve/baseBuy); zero FakeApiClient/mocks/network; `strategy.ts` imports only `./types.js` via `import type` |

**Score:** 5/5 truths verified

---

### WR Gap Items — Closure Verification

| Gap | Status | Code Evidence |
|-----|--------|---------------|
| WR-01: non-finite reward dropped in BOTH primary filter AND fallback (lock-step) | VERIFIED | `strategy.ts:124-126` — `isAttemptable` predicate: `ad.expiresIn > 0 && !ad.encrypted && Number.isFinite(ad.reward)`; `strategy.ts:109` — `filterEligibleAds` calls `isAttemptable(ad)` (primary); `strategy.ts:190` — `chooseAd` fallback calls `ads.filter(isAttemptable)` (same predicate, lock-step via shared function); `grep -v '^ *\*' src/strategy.ts \| grep -c "Number.isFinite"` = 3; tests at `strategy.test.ts:245-270` and `413-431` prove NaN/Infinity excluded, negative-finite kept |
| WR-03: Number.isFinite(item.cost) in BOTH heal lookup and upgrade filter | VERIFIED | `strategy.ts:228` — heal: `Number.isFinite(healingPotion.cost) && healingPotion.cost <= state.gold`; `strategy.ts:238` — upgrade: `Number.isFinite(item.cost)` in `affordableUpgrades` filter; tests at `strategy.test.ts:562-610` prove NaN hpot returns null, -Infinity hpot returns null (not a free heal), -Infinity upgrade excluded, finite upgrade wins over -Infinity co-present upgrade |
| WR-02: ApiClient.buy() returns Promise<BuyResult>; api.ts has no score:0 placeholders; applyBuyResult reachable | VERIFIED | `types.ts:123` — `buy(gameId: string, itemId: string): Promise<BuyResult>`; `api.ts:209-216` — `HttpApiClient.buy()` returns `this.request("POST", path, buySchema, { retry: false })` with return type `Promise<BuyResult>`; `grep -c "score: 0" src/api.ts` = 0; `fake-api-client.ts:45` — `buy?: Source<[gameId: string, itemId: string], BuyResult>`; `fake-api-client.ts:84` — `async buy(...): Promise<BuyResult>`; `fake-api-client.ts:129` — `K extends "buy" ? BuyResult`; seam-reachability regression at `strategy.test.ts:728-751` proves `applyBuyResult(prior{score:700,highScore:900}, rawBuyResult)` yields score:700/highScore:900 preserved |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/strategy.ts` | Pure decision core: all 6 exports, imports only types.js | VERIFIED | 299 lines; single `import type` from `./types.js`; exports `rankProbability`, `filterEligibleAds`, `chooseAd`, `chooseShopPurchase`, `applySolveResult`, `applyBuyResult`; `PROBABILITY_FLOOR_RANK=6`, `MAX_LIVES_TO_KEEP=3`, `HEAL_BUFFER_GOLD=100`; `Number.isFinite` in 3 non-comment sites; `...state` spread in 2 merge helpers; no fetch/zod/pino/api.js import |
| `src/strategy.test.ts` | Table-driven tests for all strategy functions, plain objects only | VERIFIED | 770 lines; imports all 6 functions from `./strategy.js`; imports types via `import type ./types.js`; fixture builders: `baseAd`, `baseState`, `shopItem`, `baseSolve`, `baseBuy`; no mocks, no FakeApiClient, no network |
| `src/types.ts` | `ApiClient.buy()` returns `Promise<BuyResult>` | VERIFIED | Line 123: `buy(gameId: string, itemId: string): Promise<BuyResult>`; JSDoc at lines 113-116 states buy returns raw BuyResult for `applyBuyResult` folding, symmetric with `solve()` |
| `src/api.ts` | `HttpApiClient.buy()` returns raw BuyResult, no placeholders | VERIFIED | Lines 209-216: `return this.request("POST", path, buySchema, { retry: false })`; return type `Promise<BuyResult>`; `grep -c "score: 0" src/api.ts` = 0 |
| `src/fake-api-client.ts` | FakeApiScript.buy + buy() method + SourceReturn all typed BuyResult | VERIFIED | Line 45: `buy?: Source<[gameId: string, itemId: string], BuyResult>`; line 84: `async buy(...): Promise<BuyResult>`; line 129: `K extends "buy" ? BuyResult`; `GameState` usage confined to `startGame` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `strategy.ts` | `./types.js` | `import type { Ad, BuyResult, GameState, ShopItem, SolveResult }` | WIRED | Line 45; single type-only import; no runtime imports from any other module |
| `strategy.test.ts` | `./strategy.js` | named imports of all 6 functions | WIRED | Lines 2-9: all 6 exports imported |
| `api.ts HttpApiClient.buy` | `BuyResult` via `buySchema` | `return this.request(POST, path, buySchema, { retry: false })` | WIRED | Lines 215-216; `buySchema` at lines 142-148 validates raw 5-field BuyResult |
| `fake-api-client.ts buy` | `BuyResult` | `SourceReturn<"buy"> = BuyResult` in mapped type | WIRED | Line 129; `buy()` return type at line 84 is `Promise<BuyResult>` |
| `filterEligibleAds` + `chooseAd` fallback | `isAttemptable` shared predicate | both paths call same function | WIRED | Lock-step: `filterEligibleAds` at line 109, fallback at line 190; floor is provably the ONLY relaxed constraint |

---

### Data-Flow Trace (Level 4)

Not applicable — `strategy.ts` is a pure function module with no I/O, no data fetching, and no state storage. All inputs are passed as arguments (plain objects from the caller); all outputs are return values. No Level 4 trace required.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 116 tests pass (no regressions vs prior 105) | `npx vitest run` | 116 passed (4 files), 180ms | PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | exit 0, no output | PASS |
| Biome lint/format clean | `npx biome check src/` | "No fixes applied", exit 0 | PASS |
| strategy.ts imports only types.js | `grep -v '^ *\*' src/strategy.ts \| grep -cE "(fetch\|from \"zod\"\|from \"pino\"\|api\.js\|fake-api-client)"` | 0 | PASS |
| Number.isFinite in 3+ non-comment sites | `grep -v '^ *\*' src/strategy.ts \| grep -c "Number.isFinite"` | 3 | PASS |
| score:0 placeholder removed from api.ts | `grep -c "score: 0" src/api.ts` | 0 | PASS |
| buy signature returns BuyResult in types.ts | `grep -q "buy(gameId: string, itemId: string): Promise<BuyResult>" src/types.ts` | match found | PASS |
| RANK table defined exactly once | `grep -c "const RANK" src/strategy.ts` | 1 | PASS |
| applyBuyResult uses ...state spread (2 helpers) | `grep -c "\.\.\.state" src/strategy.ts` | 2 | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files exist; phase is a pure TDD module (no CLI, no server, no build pipeline probes declared).

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|---------|
| STRAT-01 | 02-01 | Probability string to rank via exact-string lookup; unknown ranks worst, never throws | SATISFIED | `strategy.ts:63-86`; 11 table-driven tests + four-dot explicit test + never-throw asserts at `strategy.test.ts:112-157` |
| STRAT-02 | 02-01 | Filter ineligible ads: expired, below floor, unhandled encryption | SATISFIED | `strategy.ts:107-126`; filter tests at `strategy.test.ts:160-271` including non-finite reward cases |
| STRAT-03 | 02-02, 02-05 | Select best ad by EV with expiry-aware tiebreak; WR-01 non-finite hardening | SATISFIED | `strategy.ts:128-191`; EV/tiebreak/fallback/empty/NaN tests at `strategy.test.ts:273-447` |
| STRAT-04 | 02-03, 02-05 | Buy hpot when lives low and gold allows; WR-03 non-finite cost hardening | SATISFIED | `strategy.ts:223-248`; heal policy + live-cost proof + NaN-cost degradation tests at `strategy.test.ts:457-498, 562-611` |
| STRAT-05 | 02-03 | Buy level-raising upgrade from surplus only after reserving healing buffer | SATISFIED | `strategy.ts:234-247`; upgrade buffer, priciest-affordable, and ordering tests at `strategy.test.ts:500-543` |
| STRAT-06 | 02-04, 02-05 | Merge solve/buy responses correctly — solve omits `level`, buy omits `score`; WR-02 buy seam symmetry | SATISFIED | `strategy.ts:261-298`; carry-forward + WR-02 seam-reachability + non-mutation tests at `strategy.test.ts:628-769`; `types.ts:123` + `api.ts:209-216` confirm seam is symmetric |
| TEST-01 | All plans | Core logic built test-first; fast deterministic unit tests, no live network | SATISFIED | 116 tests in 180ms; plain-object fixtures throughout; `strategy.ts` imports only types |

**All 7 phase-2 requirements (STRAT-01..06, TEST-01) are SATISFIED.**

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|---------|--------|
| `src/strategy.ts` | 16-17 | Stale plan-progress comment: "This file grows across plans 02-01..02-04 … Plan 02-04 completes the core" — omits the 02-05 gap-closure pass that added `isAttemptable` and finite guards | Info (IN-01 from 02-REVIEW.md) | No correctness impact; minor doc/history inaccuracy |
| `src/strategy.ts` | 98-102, 116-117, 213-217 | WR-01/WR-03 guards documented as protecting against "failed coercion yields NaN" — factually incorrect; zod 4 `z.coerce.number()` rejects non-finite inputs and `z.number()` rejects NaN/Infinity, so the boundary cannot emit non-finite values; guards are correct defense-in-depth but the rationale is inaccurate | Warning (WR-01 from 02-REVIEW.md) | No correctness impact; will mislead maintainers about boundary behavior |
| `src/strategy.ts` | 128-151 | `expectedValue` can overflow finite `reward × rank` to Infinity for very large (but finite) rewards; `preferAd` would then see `Infinity - Infinity = NaN`, the exact fallthrough WR-01 claims to prevent — not reachable through the live Mugloar API (rewards are small gold values) | Warning (WR-02 from 02-REVIEW.md) | Not a live risk; internal inconsistency between the WR-01 narrative and what the guard actually covers |
| `src/types.ts` | 52, 62 | `Ad.reward: number` and `ShopItem.cost: number` typed as bare `number` (which includes NaN/Infinity in TypeScript); comments do not state the boundary-enforced finiteness that zod actually guarantees | Warning (WR-03 from 02-REVIEW.md) | Contract/clarity gap only; no crash risk |

No TBD/FIXME/XXX markers found in any phase file. No placeholder return values in any export. No hardcoded shop cost literals in decision logic. No debt marker blockers.

The three warnings and four info findings from 02-REVIEW.md are advisory quality items as noted in the verification instructions. None constitute a must-have failure:

- The WR-01/WR-03 guards are present and behaviorally correct — only their rationale comments are inaccurate
- The overflow-EV gap is not reachable through the live Mugloar API
- The `Number.isFinite` count (3) and `...state` spread count (2) match plan acceptance criteria exactly

---

### Human Verification Required

None. The previously `human_needed` WR-02 item is fully resolved by code inspection:

- `types.ts:123` declares `buy(): Promise<BuyResult>`
- `api.ts:209-216` returns the raw validated `BuyResult` directly with no GameState construction and no score:0 placeholders
- `fake-api-client.ts:45/84/129` all typed `BuyResult`
- `strategy.test.ts:728-751` — WR-02 seam-reachability regression test proves `applyBuyResult(prior{score:700,highScore:900}, rawBuyResult)` yields score:700/highScore:900 preserved and gold/lives/level/turn updated

No visual appearance, user flow, real-time behavior, or external service integration questions remain.

---

### Gaps Summary

No gaps. All 5 ROADMAP success criteria verified, all 7 requirements (STRAT-01..06, TEST-01) satisfied, all three hard gates green (116 tests pass, `tsc --noEmit` exit 0, biome clean with no fixes). The WR-01/WR-02/WR-03 gap items from the previous `human_needed` verification are confirmed closed in code.

The 3 warnings and 4 info findings from the code review are documented above as advisory quality items. They do not block the phase goal and none is a must-have failure.

---

_Verified: 2026-06-09T18:10:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification after gap closure plan 02-05_
