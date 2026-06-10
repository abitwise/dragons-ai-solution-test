# Phase 3: Game Loop & Shop Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 3-Game Loop & Shop Integration
**Areas discussed:** Per-turn action flow, Loop guards (LOOP-02), End-reason taxonomy, Error vs normal play

---

## Per-turn action flow

### Q1 — How should one loop iteration be structured?

| Option | Description | Selected |
|--------|-------------|----------|
| One action per iteration | Exactly one turn-consuming action per pass (shop-check OR solve), re-fetch at top each time | |
| Shop-phase, then solve | Drain sensible buys (re-fetching between buys), THEN solve one ad | ✓ |
| You decide | Pick the readable LOOP-03-honoring default | |

**User's choice:** Shop-phase, then solve.
**Notes:** Each buy and each solve both consume a turn; the shop phase may consume several turns before the solve.

### Q2 — How should the shop phase terminate and when should ads be re-fetched?

| Option | Description | Selected |
|--------|-------------|----------|
| Drain shop, then fresh ads | Inner loop buys until null OR shoppingSuccess:false; then getMessages fresh → chooseAd → solve | ✓ |
| One buy max per iteration | At most one buy per outer iteration, then solve | |
| You decide | Safe default | |

**User's choice:** Drain shop, then fresh ads (with the `shoppingSuccess:false` break).
**Notes:** Clarified during discussion that there is no get-state endpoint — state is threaded via `applyBuyResult`/`applySolveResult` merges, while `getShop`/`getMessages` are reads that inform decisions only.

---

## Loop guards (LOOP-02)

### Q1 — What should the max-turn cap count?

| Option | Description | Selected |
|--------|-------------|----------|
| Count loop iterations | Our own counter, independent of API; the only true "never forever" guarantee on its own | |
| Trust the API turn field | Abort when state.turn exceeds a named constant | ✓ |
| You decide | Robust default | |

**User's choice:** Trust the API turn field.
**Notes:** Surfaced that this makes the no-progress guard the essential complement (it catches a flat/never-advancing `turn`). The pair guarantees termination.

### Q2 — What counts as no-progress?

| Option | Description | Selected |
|--------|-------------|----------|
| Turn counter stalls | state.turn flat for NO_PROGRESS_LIMIT=3 consecutive iterations → abort | ✓ |
| Score stalls | Abort if score hasn't risen for N iterations (rejected — too strict) | |
| No action this iteration | Abort first iteration with no buy and no solve (folds into empty-board case) | |

**User's choice:** Turn counter stalls (NO_PROGRESS_LIMIT = 3).
**Notes:** Exact complement to the turn-based cap chosen in Q1.

---

## End-reason taxonomy

### Q1 — How should GameReport.reason be produced?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed set of reason constants | Closed, greppable vocabulary the runner returns verbatim; Phase 4 maps to exit codes | ✓ |
| Free-form human strings | Most natural prose, but Phase 4 can't reliably switch on it | |
| You decide | Default | |

**User's choice:** Fixed set of reason constants.
**Notes:** After Area 4, the set shrank to three game-terminal reasons (GAME_OVER / TURN_CAP / NO_PROGRESS); API_ERROR dropped because errors propagate (see Error vs normal play).

### Q2 — What should GameReport.turns hold, and how much error detail in the reason?

| Option | Description | Selected |
|--------|-------------|----------|
| state.turn + short error detail | turns = final state.turn; api-error reason = constant + short error name | |
| Iteration count + bare constant | turns = our loop counter; bare constant, no detail | |
| You decide | Default | ✓ |

**User's choice:** You decide → `GameReport.turns = final state.turn`; error-detail moot since errors propagate (index.ts surfaces the error name in Phase 4).

---

## Error vs normal play

### Q1 — What's the error-handling contract for playGame?

| Option | Description | Selected |
|--------|-------------|----------|
| playGame never throws | One try/catch owns every exit; thrown error → API_ERROR GameReport | |
| Let fatal errors propagate | Thrown ApiClient error bubbles out; index.ts (Phase 4) catches → failure + exit code | ✓ |
| You decide | Default | |

**User's choice:** Let fatal errors propagate.
**Notes:** Surfaced a tension with Phase 3 success criterion #4 ("ends cleanly with a reason"); resolved in Q2.

### Q2 — How to reconcile propagation with criterion #4 and the Area 3 reason set?

| Option | Description | Selected |
|--------|-------------|----------|
| Propagate raw; index.ts owns exit | Reject with the original typed error; GameReport reasons shrink to the 3 game-terminal ones; Phase 3 asserts playGame rejects | ✓ |
| Log + rethrow, no raw | Wrap in a runner-level error type before rethrowing | |
| You decide | Default | |

**User's choice:** Propagate raw; index.ts owns the exit.
**Notes:** Phase 3 verifies criterion #4 by asserting `playGame` rejects with `BoundaryError`/`TransportError` against the fake (no hang/crash). Normal-play signals (`solve success:false`, `buy shoppingSuccess:false`) are explicitly NOT errors → continue.

### Q3 — Empty board (chooseAd returns null) and shop bought nothing — what does the runner do?

| Option | Description | Selected |
|--------|-------------|----------|
| Ride into no-progress guard | Turn stays flat → NO_PROGRESS trips after 3 stalls; single termination path | ✓ |
| End immediately | End on first no-op iteration; adds a second termination path | |
| You decide | Default | |

**User's choice:** Ride into the no-progress guard.
**Notes:** `chooseAd`'s least-bad-gamble fallback already lives inside it (Phase 2 D-06), so `null` means nothing solvable at all.

---

## Claude's Discretion

- The `MAX_TURN` constant value (generous backstop, ~1000–2000) and the exact `END` reason strings (kept as named constants; wording flexible).
- Whether `playGame` calls `logger.error(err)` before the error propagates (Logger impl is Phase 4; Phase 3 tests pass a silent/spy logger).
- Local loop structure (shop-phase helper vs inline; organization of the `END` constants).
- Order of guard checks vs the lives check within an iteration, provided the loop provably cannot spin.
- `GameReport.turns` source and error-detail handling (Q2 of End-reason taxonomy).

## Deferred Ideas

None — discussion stayed within Phase 3 scope. Logging levels/output, the CLI composition root, final-score printing, exit-code mapping, and the live smoke run are Phase 4 (LOG-01/02), not deferrals.
