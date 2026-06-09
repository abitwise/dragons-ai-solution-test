# Phase 2: Strategy Core — Pure Decision Logic (TDD) - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers **all "what should the bot do" logic** as pure, fully
test-driven functions in `strategy.ts`. Inputs are plain objects (`GameState`,
`Ad[]`, `ShopItem[]`, `SolveResult`, `BuyResult`) → outputs are decisions or a
merged `GameState`. No `fetch`, no `zod`, no `pino`, no mocks, no network — the
suite runs purely on hand-built fixtures (TEST-01).

**In scope (STRAT-01..06, TEST-01):**
- Probability string → rank lookup (exact-string keyed; unknown → worst; never throws).
- Ad eligibility filtering (expired, below probability floor, unhandled encryption).
- Ad selection by expected value with an expiry-aware tiebreak, plus the
  no-eligible-ad fallback.
- Shop decisions: heal (`hpot`) policy and level-upgrade policy with a reserved
  healing buffer.
- State merge: apply a solve result and apply a buy result into `GameState`
  without clobbering the field each response omits.
- Fast, deterministic unit tests covering all of the above.

**Out of scope (other phases):** the orchestration loop, re-fetching ads, the
max-turn / no-progress guards, error-driven game-over (all Phase 3 / `runner.ts`);
the `Logger` implementation, CLI composition root, and live smoke run (Phase 4).
`strategy.ts` imports **only** `types.ts` — it never calls the `ApiClient`; the
runner calls strategy and the client and wires the two together.

</domain>

<decisions>
## Implementation Decisions

These are the heuristic-policy gray areas resolved during discussion. Locked
carry-forwards (already decided by success criteria / Phase 1) are listed
afterward — do not re-litigate them.

### Probability ranking (STRAT-01)
- **D-01:** Rank via an **exact-string lookup map** over the 11 verified labels,
  using the **integer ranks 0–10** from `research/FEATURES.md` (`Sure thing`=10 …
  `Impossible`=0). The success criterion literally says "expected value =
  `reward × rank`", so integer ranks are the weighting — NOT the MEDIUM-confidence
  approximate success percentages. An **unknown/new label ranks worst (0)** and
  must never throw. Match `"Hmmm...."` on its **exact four-dot string** (PITFALLS).

### Risk floor & ad eligibility (STRAT-02)
- **D-02:** **Probability floor = `Hmmm....` (rank ≥ 6).** Ads ranked below 6
  (`Gamble`=5 and riskier) are filtered out before selection. Conservative play —
  the bot only attempts ads with roughly ~55%+ odds, relying on EV to choose among
  solid ads. This is a hard pre-filter applied *before* EV ranking.
- **D-03:** The eligibility filter drops, in one place (`strategy.ts`):
  (1) **expired** ads (`expiresIn <= 0`), (2) **sub-floor** ads (rank < 6),
  (3) **unhandled-encryption** ads (those that still carry an `encrypted` flag —
  the client could not decode them, per Phase 1 D-09). Keeping all eligibility
  filtering here (not in the client/runner) is deliberate.

### Ad selection & tiebreak (STRAT-03)
- **D-04:** Among eligible ads, choose the **highest expected value =
  `reward × rank`**. (Locked by success criterion #2.)
- **D-05:** **Tiebreak on EV is expiry-aware: prefer the sooner-expiring ad**
  (lowest `expiresIn`) — use-it-or-lose-it, since an equal-EV alternative will
  still be on the board next turn. **Secondary tiebreak: higher `reward`** when
  `expiresIn` also ties. (Deterministic ordering so tests are stable.)

### No-eligible-ad fallback (STRAT-03)
- **D-06:** **Least-bad gamble.** When the board has ads but **none clear the
  floor**, relax the floor and return the **highest-EV ad among all present ads**
  (still excluding only those that would 400 — i.e. unhandled-encryption ads —
  and expired ads). Keep earning rather than stall: a forced gamble that might pay
  off beats forfeiting score, and the runner's heal/upgrade decisions run first
  each turn anyway.
- **D-07:** `chooseAd` returns a **"no ad" signal only when the board is truly
  empty** (no present, non-expired, solvable ad exists at all). Recommended
  contract: return `Ad | null` (or a small discriminated result) — `null` =
  "nothing to solve", which the runner (Phase 3) handles by shopping or ending
  cleanly. The selection function itself never throws and never relaxes onto an
  ad that would 400.

### Healing policy (STRAT-04)
- **D-08:** **Heal below full: buy `hpot` when `lives < 3` and `gold ≥ hpotCost`.**
  Survival-first — keeping a full life buffer maximizes total attempts before
  death = more total score (the game ends at `lives === 0`, so longevity is the
  scoring lever). `hpot` is **looked up by id in the live shop list**, not
  hardcoded (its cost is read live too — observed 50).

### Upgrade policy (STRAT-05)
- **D-09:** **Decision ordering is heal > upgrade > solve.** Heal always takes
  priority over an upgrade; an upgrade is only considered when lives are healthy
  (i.e. the heal condition in D-08 is NOT met).
- **D-10:** **Reserve a 100-gold healing buffer (≈ 2 potions).** Buy an upgrade
  only when `gold − upgradeCost ≥ 100`. Never spend the gold that keeps the bot
  alive.
- **D-11:** When surplus allows, buy the **priciest affordable non-`hpot` item**
  (up to the 300-gold tier). Each buy costs one turn regardless of price and
  pricier items are stronger (community lore; effects are NOT returned by the
  API), so a bigger level jump per turn is more turn-efficient. Select **by live
  `cost` / `id`** from the shop list — no hardcoded ids/costs.

### State merge (STRAT-06)
- **D-12:** Provide **two pure merge functions** (names at planner discretion,
  e.g. `applySolveResult(state, SolveResult): GameState` and
  `applyBuyResult(state, BuyResult): GameState`), each merging the response into
  the prior `GameState` **without clobbering the field the response omits**:
  - a **solve** result has **no `level`** → carry `level` forward from prior state;
  - a **buy** result has **no `score`/`highScore`** → carry them forward from prior state.
  See `<code_context>` for the `api.ts` subtlety that makes the buy merge necessary.

### Claude's Discretion
The user said "you decide" (explicitly or by accepting recommendations) on the
mechanics below — recommended defaults encoded above:
- **Exact function names / signatures** for selection, filtering, ranking, the
  two merge helpers, and the shop-decision function(s). Whether the shop decision
  is one function returning the chosen `ShopItem | null` (heal-or-upgrade-or-none)
  or two; whether `chooseAd` returns `Ad | null` or a discriminated union.
- **Thresholds as named constants** (`PROBABILITY_FLOOR_RANK = 6`,
  `MAX_LIVES_TO_KEEP = 3`, `HEAL_BUFFER_GOLD = 100`), so they read clearly and
  are trivially tunable. Costs (`hpot` = 50, upgrade tiers 100/300) are **read
  live from the shop**, not hardcoded.
- **Where the EV product is computed** and whether ranking is a sort or a single
  reduce — any readable form is fine (not an optimizer).

## Locked Carry-Forwards (already decided — do NOT re-ask)

From success criteria, PROJECT.md, and Phase 1's CONTEXT/code:
- **Architecture:** functional core / imperative shell; six flat files under
  `src/`, no subfolders, manual DI only. `strategy.ts` is **pure** and imports
  **only** `types.ts` (no `ApiClient`, no `fetch`, no `zod`, no `pino`).
- **Probability map is exact-string keyed; unknown → worst; never throws**
  (STRAT-01, criterion #1) — the *existence* and contract are locked; only the
  weighting choice (integer ranks) was a decision (D-01).
- **EV selection metric** `reward × rank` is locked (criterion #2).
- **Encrypted pass-through (Phase 1 D-08/D-09):** the client decodes known schemes
  and clears the flag; ads it could not decode arrive **still flagged**, and
  strategy's filter drops them (D-03). Eligibility filtering lives in strategy.
- **Tests use plain objects** — no mocks, no `FakeApiClient` even (strategy never
  touches the client), no network (TEST-01, criterion #5).
- **Scoring context (informational, not a gate):** the well-known target is
  score ≥ 1000; the game ends at `lives === 0`; there is no hard "win".

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & scope
- `.planning/ROADMAP.md` § "Phase 2: Strategy Core — Pure Decision Logic (TDD)" —
  the goal and the 5 success criteria this phase is judged against.
- `.planning/REQUIREMENTS.md` § "Decision Strategy" (STRAT-01..06) and § "Testing
  (TDD)" (TEST-01) — the exact requirements this phase implements.
- `.planning/PROJECT.md` — Core Value, the "keep it simple / readable heuristic"
  constraint, and the play-loop context.

### Strategy facts, numbers & verified data (HIGH value — read before coding)
- `.planning/research/FEATURES.md` — **the verified 11 probability strings table
  (ranks 0–10, exact labels incl. `Hmmm....`)**, the full live shop catalog
  (`hpot`=50; 100- and 300-gold upgrade tiers), the solve/buy field asymmetry, and
  the "Recommended Simple Heuristic" with the exact thresholds this discussion
  tuned. **The single most important reference for this phase.**
- `.planning/research/PITFALLS.md` — esp. the exact `"Hmmm...."` four-dot string,
  and `success` being a body field (relevant to the solve-result merge).

### Architecture & types (the contracts strategy operates on)
- `.planning/research/ARCHITECTURE.md` — the functional-core/imperative-shell
  layout; `strategy.ts` imports only `types.ts`; the dependency direction.
- `src/types.ts` — the models strategy consumes/produces: `GameState`, `Ad`
  (note `probability: string` free-text, `encrypted?: number`), `ShopItem`,
  `SolveResult` (no `level`), `BuyResult` (no `score`/`highScore`), `GameReport`.
- `.planning/phases/01-foundation-types-api-client-test-seam/01-CONTEXT.md` —
  D-08/D-09 (the encrypted pass-through contract strategy's filter depends on).

*No user-authored external specs/ADRs were referenced during discussion; the
research docs and `src/types.ts` above are the canonical sources.*

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/types.ts`** — all models already exist; strategy adds zero new types
  beyond perhaps a small internal rank-map or a `chooseAd` return shape. `BuyResult`
  and `SolveResult` are already declared with the correct field asymmetry.
- **No `FakeApiClient` needed here** — strategy is pure, so Phase 2 tests build
  `Ad[]` / `GameState` / `SolveResult` / `BuyResult` literals directly. The fake
  (from Phase 1) is for the Phase 3 loop, not for strategy.

### Established Patterns
- Functional core: pure functions, deterministic, no side effects → ideal for the
  TDD-first approach the brief mandates. Each STRAT requirement maps to one (or a
  few) small pure functions.
- Eligibility filtering centralized in strategy (Phase 1 deliberately left
  unhandled-encryption ads flagged for this filter — D-03/D-09).

### Integration Points & a subtlety to honor (STRAT-06)
- **`src/api.ts` `buy(gameId, itemId)` returns a `GameState` with `score: 0` and
  `highScore: 0` placeholders** (lines ~209–225) — it has no prior state to merge,
  so it zeroes the two fields a buy response omits. Therefore Phase 2's
  buy-merge MUST fold the buy result into the **prior** `GameState`, restoring
  `score`/`highScore`. Decide whether the merge consumes the raw `BuyResult`
  (cleanest for a pure function + a unit test) or post-processes the client's
  partial `GameState`; either works, but the planner should pick one and the test
  must prove `score`/`highScore` are preserved across a buy.
- `solve(gameId, adId)` returns a raw `SolveResult` (no `level`) — the solve-merge
  carries `level` forward from prior state.
- **Consumer:** `runner.ts` (Phase 3) calls these strategy functions and the
  `ApiClient`; strategy never imports the client. Keep `chooseAd`'s "no ad" signal
  (D-07) explicit so the runner can branch on it.

</code_context>

<specifics>
## Specific Ideas

- Surface thresholds as **named constants** (`PROBABILITY_FLOOR_RANK = 6`,
  `MAX_LIVES_TO_KEEP = 3`, `HEAL_BUFFER_GOLD = 100`) so the policy reads as prose
  and is tunable without hunting through logic.
- Costs are **read live from the shop** (`hpot` by id; upgrades by cost) — never
  hardcode 50/100/300; they are documented only to ground the discussion.
- Worth-having unit tests (TDD, all plain-object fixtures):
  - every one of the 11 labels → its rank, **including exact `"Hmmm...."`**, plus
    an unknown label → worst (D-01);
  - a mixed board where EV picks a moderate-reward safe ad over a high-reward
    risky one, and the floor drops `Gamble`/`Risky`/expired/still-encrypted ads;
  - the expiry-aware tiebreak (two equal-EV ads → sooner-expiring wins; then
    reward) (D-05);
  - all-sub-floor board → least-bad gamble returned (D-06); empty board → "no ad"
    signal (D-07);
  - heal triggers at `lives < 3` only when affordable (D-08); upgrade only when
    `gold − cost ≥ 100` and lives healthy, picking the priciest affordable
    non-`hpot` (D-09/D-10/D-11);
  - solve-merge preserves `level`; buy-merge preserves `score`/`highScore` (D-12).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 2 scope. Strategy-adjacent enhancements are
already parked in `REQUIREMENTS.md` v2: adaptive within-game probability memory
(STRAT-07) and reputation-aware weighting via `/investigate/reputation`
(STRAT-08). The loop, guards, and re-fetch belong to Phase 3; logging/CLI to
Phase 4.

</deferred>

---

*Phase: 2-Strategy Core — Pure Decision Logic (TDD)*
*Context gathered: 2026-06-09*
