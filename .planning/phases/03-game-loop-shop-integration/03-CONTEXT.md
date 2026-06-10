# Phase 3: Game Loop & Shop Integration - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers a thin **`runner.ts`** exposing one async orchestrator —
`playGame(api: ApiClient, logger: Logger): Promise<GameReport>` — that plays a
**single full game to game-over** by wiring the already-proven pure `strategy.ts`
functions to the already-proven `ApiClient` seam. Each iteration is
**fetch → decide → act → update → log**: read state/shop/ads, ask strategy what to
do, call the client to do it, fold the result back into the threaded `GameState`
via the merge helpers, and narrate via the `Logger` interface. The loop **can
never run forever** (two independent guards) and the whole thing is **verified
offline against `FakeApiClient`** with zero live network.

**In scope (LOOP-01, LOOP-02, LOOP-03):**
- The `playGame` orchestrator and its turn loop (the imperative shell).
- Shop integration: a per-iteration "shop phase" that drains sensible buys before
  the solve.
- The two safety guards (max-turn cap + no-progress guard) that bound the loop.
- Re-fetching ads after each turn-consuming action so `expiresIn` stays current;
  applying the strategy's defined fallback when no eligible ad exists.
- Clean handling of an ApiClient error mid-game (controlled rejection, no crash).
- `runner.test.ts` driving the whole loop with `FakeApiClient`.

**Out of scope (other phases):**
- The `Logger` **implementation**, levels, and pretty output; the CLI composition
  root (`index.ts`); the final-score *printing*; exit-code mapping; the live smoke
  run — all **Phase 4** (LOG-01/02). The runner only **calls** the `Logger`
  *interface*; how those calls render and what exit code results are Phase 4.
- Any change to `strategy.ts` or `api.ts` — both are feature-complete and locked.
  The runner imports and composes them; it does not modify them.
- New gameplay capabilities (adaptive probability memory, reputation weighting,
  multi-game runs) — parked in REQUIREMENTS.md v2, not this phase.

</domain>

<decisions>
## Implementation Decisions

These resolve the runner's behavioral gray areas. Locked carry-forwards (already
decided by Phases 1–2 / success criteria) are listed afterward — do not re-litigate.

### Per-turn action flow (LOOP-01, LOOP-03)
- **D-01: Shop-phase, then solve.** Each outer iteration runs a **shop phase
  first**, then **one solve**. The shop phase is a drain loop:
  `chooseShopPurchase(state, shop)` → if it returns an item, `api.buy(gameId, id)`
  → `applyBuyResult` to update state → re-fetch the shop → repeat. After the shop
  phase, `getMessages` **fresh**, `chooseAd(ads)`, and (if non-null)
  `api.solve(gameId, adId)` → `applySolveResult`.
- **D-02: Shop drain terminates on `null` OR `shoppingSuccess:false`.** The inner
  shop loop stops when `chooseShopPurchase` returns `null` (lives healthy + no
  affordable upgrade past the buffer) **or** when a `buy` reports
  `shoppingSuccess:false` (can't actually afford it). The `shoppingSuccess:false`
  break is the guard against an infinite re-buy when gold is insufficient but the
  strategy keeps recommending the same item.
- **D-03: Ads are always fetched fresh immediately before the solve.** Because the
  shop phase consumes turns (each buy is a turn) and ages the board, the runner
  calls `getMessages` **after** the shop phase, right before `chooseAd`, so
  `expiresIn` is current at decision time (satisfies LOOP-03's "re-fetch after
  each turn-consuming action"). The next iteration re-fetches again at its top.
- **D-04: State is threaded via the merge helpers, NOT re-fetched.** There is **no
  get-state endpoint**. `startGame()` seeds the initial `GameState`; every
  subsequent state is derived by `applyBuyResult(state, BuyResult)` /
  `applySolveResult(state, SolveResult)`. `getMessages` and `getShop` are reads
  that *inform decisions* but carry no state — they never replace the threaded
  `GameState`.

### Loop guards (LOOP-02)
- **D-05: Max-turn cap trusts the API `turn` field.** Abort when
  `state.turn > MAX_TURN` (a named constant; value at planner discretion, a
  generous backstop well above any real game — e.g. ~1000–2000). Reason →
  `END.TURN_CAP`.
- **D-06: No-progress guard = the turn counter stalls.** Remember `state.turn`
  each iteration; if it fails to advance for `NO_PROGRESS_LIMIT = 3` **consecutive
  iterations**, abort with `END.NO_PROGRESS`. Reset the stall counter whenever
  `turn` advances.
- **D-07: The two guards together guarantee termination.** This pairing is the
  point: `turn` either climbs (→ eventually hits `MAX_TURN`) or stalls (→ trips
  the no-progress guard). The no-progress guard is the *essential complement* to
  the turn-based cap — it is the thing that catches a flat/never-advancing `turn`,
  which the turn-based cap alone cannot. Both must exist; neither is optional.

### End-reason taxonomy (feeds Phase 4 exit codes)
- **D-08: `GameReport.reason` is a fixed set of named string constants** the runner
  returns verbatim — **exactly three**: `GAME_OVER` (lives reached 0 — the expected
  end), `TURN_CAP` (max-turn cap), `NO_PROGRESS` (no-progress guard). The TS type
  stays `string`, but the *values* are a closed, greppable vocabulary so Phase 4
  can map `GAME_OVER → exit 0`, the other two → non-zero. Suggested values:
  `'game over: lives reached 0'`, `'stopped: max-turn cap reached'`,
  `'stopped: no-progress guard tripped'` (wording at planner discretion; keep them
  as named constants, e.g. an `END` object).
- **D-09: `GameReport.turns = final `state.turn`.** Report the game's own turn
  counter (consistent with the turn-based cap and what a player means by "turns"),
  not a private loop-iteration counter. `GameReport.score = final state.score`.
- **D-10: There is NO `API_ERROR` reason in `GameReport`.** Error exits do not
  produce a `GameReport` at all (see D-11) — they propagate. The taxonomy is
  deliberately just the three *game-terminal* conditions.

### Error vs normal play (Success Criterion #4, LOOP-03)
- **D-11: Fatal ApiClient errors propagate raw; `playGame` does NOT catch them.**
  A thrown `ApiClient` error (already post-Phase-1-retry — reads retried ~3×,
  `solve`/`buy` never retried) bubbles out of `playGame` as a **rejected promise**
  carrying the **original typed error** (`TransportError` / `BoundaryError` from
  `api.ts`). The runner does **not** add its own retry. The runner **may**
  `logger.error(err)` in-context (it has the turn/state) before the error
  unwinds, but it does not wrap it in a new error type. `index.ts` (Phase 4) is
  the single owner of the failure path: catch → print failure → set non-zero exit
  code.
- **D-12: "Ends cleanly" in Phase 3 means a controlled rejection, not a swallowed
  `GameReport`.** Success Criterion #4 is verified offline by asserting
  `await expect(playGame(fake, logger)).rejects.toBeInstanceOf(BoundaryError)`
  (and/or `TransportError`) when the fake throws mid-game — i.e. the loop unwinds
  with no hang, no crash, no corrupted state. The human-readable "game-over with a
  reason" framing in the criterion is satisfied at the CLI layer in Phase 4.
- **D-13: Solve/buy "failure" bodies are NORMAL play, not errors.** A
  `SolveResult` with `success:false` is folded via `applySolveResult` (lives drop)
  and the loop **continues** — a failed ad is ordinary gameplay, not an exception.
  A `BuyResult` with `shoppingSuccess:false` ends the shop phase (D-02) and the
  loop **continues**. Only *thrown* errors terminate the run (D-11).
- **D-14: An empty board rides into the no-progress guard.** `chooseAd` already
  contains the least-bad-gamble fallback (Phase 2 D-06), so it returns `null`
  **only** when nothing is solvable at all. When that happens AND the shop phase
  bought nothing, the iteration does nothing turn-consuming, `state.turn` stays
  flat, and the no-progress guard (D-06) ends the game with `NO_PROGRESS` after 3
  stalls. **No separate empty-board termination path or reason constant** — one
  unified stall-termination. (Costs ≤3 extra fetch round-trips before ending;
  harmless offline, rare live.)

### Claude's Discretion
The user said "you decide" (explicitly or by accepting recommendations) on the
mechanics below — recommended defaults encoded above:
- **The `MAX_TURN` constant value** (a generous backstop; ~1000–2000) and the exact
  **`END` reason strings** (keep them named constants; wording is flexible).
- **Whether `playGame` calls `logger.error` before the error propagates** (D-11
  allows it; the Logger impl is Phase 4 — for Phase 3 the test passes a silent/spy
  logger).
- **Exact local structure of the loop** (helper functions for the shop phase vs
  inline; how the `END` constants are organized) — any readable form that honors
  D-01..D-14.
- **The order of guard checks vs the lives check** within an iteration, as long as
  the loop provably cannot spin (D-07).

## Locked Carry-Forwards (already decided — do NOT re-ask)

From success criteria, PROJECT.md, and Phases 1–2 CONTEXT/code:
- **Signature & architecture:** `playGame(api: ApiClient, logger: Logger):
  Promise<GameReport>` (ARCHITECTURE.md). Functional core / imperative shell;
  `runner.ts` is the imperative shell — it calls the **pure** `strategy.ts` and the
  `ApiClient` **interface**, never `fetch`/`zod` directly, and depends on the
  `Logger` **interface**, never `console`. Six flat files under `src/`, manual DI.
- **Strategy is feature-complete and imported as-is** (STRAT-01..06): `chooseAd`
  (returns `Ad | null`; `null` = truly empty board; least-bad-gamble fallback is
  *inside* it), `chooseShopPurchase` (heal > upgrade > none), `filterEligibleAds`,
  `rankProbability`, `applySolveResult` (carries `level` forward), `applyBuyResult`
  (carries `score`/`highScore` forward). The runner does not reimplement any of it.
- **Decision priority heal > upgrade > solve** (Phase 2 D-09) is encoded *inside*
  `chooseShopPurchase` + the runner's shop-phase-before-solve ordering (D-01).
- **Retry/error taxonomy is fixed in `api.ts`** (Phase 1 D-04/05/06): reads
  (`startGame`/`getMessages`/`getShop`) retry ~3× with bounded backoff;
  `solve`/`buy` are never retried; `TransportError` (retryable transport) vs
  `BoundaryError` (terminal parse/non-2xx/ZodError). The runner adds **no** retry.
- **TDD with `FakeApiClient`** (the Phase 1 scripted double): per-method FIFO
  queues / function sources, **fail-loud** on exhaustion (a missing scripted
  response rejects naming the method). Tests script a final `lives: 0` solve to
  drive the play-to-game-over path, and a throwing method to drive the
  error-propagation path. **Zero live network** — no nock/msw.
- **`encrypted` pass-through:** ads the client could not decode arrive still
  flagged; `filterEligibleAds` (inside `chooseAd`) drops them. The runner does not
  re-filter or decode.
- **Scoring context (informational, not a gate):** the well-known target is
  score ≥ 1000; the game ends at `lives === 0`; there is no hard "win".

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & scope
- `.planning/ROADMAP.md` § "Phase 3: Game Loop & Shop Integration" — the goal and
  the **4 success criteria** this phase is judged against (note criterion #4's
  reconciliation with D-11/D-12 above).
- `.planning/REQUIREMENTS.md` § "Game Loop & Orchestration" (LOOP-01, LOOP-02,
  LOOP-03) — the exact requirements this phase implements.
- `.planning/PROJECT.md` — Core Value (the decision loop is THE thing that must
  work), the "keep it simple" constraint, and the play-loop context.

### Architecture & the seam (the contracts the runner composes)
- `.planning/research/ARCHITECTURE.md` — the six-file layout; the
  `runner.ts` row (`async function playGame(api, logger): Promise<GameReport>`,
  "each turn: fetch → decide → act → update → log", "stops when lives === 0");
  Pattern 2 (Injected ApiClient seam) with the `tests/runner.test.ts` sketch that
  drives a `FakeApiClient`. **The most directly relevant doc for this phase.**
- `src/types.ts` — the contracts the runner threads: `GameState`, `Ad`,
  `ShopItem`, `SolveResult` (no `level`), `BuyResult` (`shoppingSuccess`/`gold`/
  `lives`/`level`/`turn`, no `score`/`highScore`), `GameReport`
  (`{score, turns, reason}`), `ApiClient` (the 5 methods), `Logger`.
- `src/strategy.ts` — the exact functions/signatures the runner calls:
  `chooseAd(ads): Ad | null`, `chooseShopPurchase(state, shop): ShopItem | null`,
  `applySolveResult(state, result): GameState`,
  `applyBuyResult(state, result): GameState`.
- `src/api.ts` — `HttpApiClient` and the `TransportError` / `BoundaryError`
  classes the runner's tests assert on (D-12); the never-retry contract for
  `solve`/`buy`.
- `src/fake-api-client.ts` — `FakeApiClient` + `FakeApiScript` shape (per-method
  arrays or functions; fail-loud on queue exhaustion) — how every Phase 3 test is
  driven offline.

### Prior decisions the runner depends on
- `.planning/phases/02-strategy-core-pure-decision-logic-tdd/02-CONTEXT.md` —
  esp. D-06 (least-bad-gamble fallback lives inside `chooseAd`, so `null` = truly
  empty), D-07 (`chooseAd` null contract), D-08/09/10/11 (shop policy), D-12 (the
  merge helpers' field asymmetry).
- `.planning/phases/01-foundation-types-api-client-test-seam/01-CONTEXT.md` —
  D-04/05/06 (read-only retry; solve/buy not retried; ZodError terminal) and
  D-07 (FakeApiClient scripted double) — the error/retry behavior the runner
  inherits and must NOT duplicate.

### Supporting facts (read if a number/quirk is in question)
- `.planning/research/FEATURES.md` — live shop catalog (`hpot`, upgrade tiers),
  the solve/buy field asymmetry, the 11 probability strings.
- `.planning/research/PITFALLS.md` — `success` is a body field not HTTP status
  (relevant to D-13); HTML error bodies (already handled in `api.ts`).

*No user-authored external specs/ADRs were referenced during discussion; the
research docs and `src/*` above are the canonical sources.*

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (all exist, imported as-is — the runner writes no new logic for these)
- **`src/strategy.ts`** — `chooseAd`, `chooseShopPurchase`, `applySolveResult`,
  `applyBuyResult`, `filterEligibleAds`, `rankProbability`. Feature-complete, pure,
  TDD-covered. The runner is glue around these.
- **`src/api.ts`** — `HttpApiClient` (the only `fetch` caller) + `TransportError` /
  `BoundaryError`. The runner depends on the `ApiClient` *interface*, not this
  class; production wiring of `HttpApiClient` happens in `index.ts` (Phase 4).
- **`src/fake-api-client.ts`** — `FakeApiClient` (scripted, fail-loud) is the test
  double that drives `runner.test.ts` offline. New this phase: scripts that play a
  full game to `lives:0` and scripts where a method throws mid-game.
- **`src/types.ts`** — `GameReport` already declared (`{score, turns, reason}`); no
  new shared types needed beyond perhaps a local `END` reason-constants object in
  `runner.ts`.

### Established Patterns (honor these)
- **Functional core / imperative shell** — the runner is the *only* place that
  sequences I/O calls and threads mutable game progression; the decisions it makes
  are all delegated to pure strategy functions. Keep strategy and runner separate
  (do not merge "to save a file" — ARCHITECTURE.md).
- **State threading via merges, not refetch** (D-04) — mirrors how Phase 2 built
  `applySolveResult`/`applyBuyResult` precisely so the loop never needs a
  get-state endpoint.
- **Errors are typed and propagate** — Phase 1 deliberately made `solve`/`buy`
  non-retrying and gave reads edge-retry, so the runner can stay a thin
  pass-through (D-11).

### Integration Points
- **`runner.ts → api.ts`** via the `ApiClient` interface (the 5 methods).
- **`runner.ts → strategy.ts`** via the pure decision functions (no client coupling
  in strategy).
- **`runner.ts → Logger` interface** — the runner emits narration calls; the
  concrete `ConsoleLogger` and level design are Phase 4.
- **`runner.ts ← index.ts`** (Phase 4) — `index.ts` constructs real `HttpApiClient`
  + `ConsoleLogger`, calls `playGame`, prints the `GameReport`, **catches a
  propagated error**, and sets the exit code (D-11).

### A subtlety to honor
- `api.ts buy()` returns the **raw `BuyResult`** (no `score`/`highScore`); the
  runner MUST fold it with `applyBuyResult` against the prior state so `score`/
  `highScore` are preserved across a buy (Phase 2 D-12 / api.ts placeholder
  history). Likewise `solve()` returns a raw `SolveResult` (no `level`) folded by
  `applySolveResult`. Never assign a raw result to the threaded `GameState`.

</code_context>

<specifics>
## Specific Ideas

- Surface the loop knobs as **named constants** in `runner.ts`:
  `MAX_TURN` (the cap), `NO_PROGRESS_LIMIT = 3`, and an `END` object for the three
  reason strings — so the guard policy reads as prose and is trivially tunable.
- **`runner.test.ts` cases worth having** (all offline, `FakeApiClient`-driven):
  - A full game scripted to `lives:0` → asserts the returned `GameReport`
    (`score`, `turns = final state.turn`, `reason = GAME_OVER`). (Criterion #1)
  - A scenario where `state.turn` keeps climbing → trips `MAX_TURN`
    (`reason = TURN_CAP`); and a scenario where `turn` goes flat (empty board /
    all-unaffordable) → trips `NO_PROGRESS` after 3 stalls. (Criterion #2)
  - A shop-phase drain: multiple sensible buys folded via `applyBuyResult`
    (state/`score` preserved), stopping on `shoppingSuccess:false`; then a fresh
    `getMessages` before the solve proves ads are re-fetched. (Criterion #3, LOOP-03)
  - `chooseAd` → `null` (truly empty board) feeds the no-progress guard rather than
    crashing. (Criterion #3 fallback, D-14)
  - A `FakeApiClient` method that throws mid-game → `playGame` **rejects** with the
    typed error (`BoundaryError`/`TransportError`), no hang/crash; and `solve`
    `success:false` / `buy` `shoppingSuccess:false` do NOT end the run.
    (Criterion #4, D-12/D-13)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 3 scope. Logging levels/output, the CLI
composition root, final-score *printing*, exit-code mapping, and the live smoke run
are **Phase 4** (LOG-01/02), not deferrals. Adaptive probability memory (STRAT-07),
reputation weighting (STRAT-08), and multi-game runs (RUN-01) remain parked in
REQUIREMENTS.md v2, out of scope for v1.

</deferred>

---

*Phase: 3-Game Loop & Shop Integration*
*Context gathered: 2026-06-10*
