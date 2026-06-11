# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Autoplay Bot

**Shipped:** 2026-06-11
**Phases:** 4 | **Plans:** 15 | **Tasks:** 29

### What Was Built
- An injectable `ApiClient`/`Logger` seam + shared types (`types.ts`), the pure `decodeAd`
  (Base64/ROT13), the offline `FakeApiClient`, and the live `HttpApiClient` (zod boundary, bounded
  retry, `encodeURIComponent`, error taxonomy) — Phase 1.
- A pure, types-only strategy core (`strategy.ts`): probability ranking, ad eligibility filtering,
  EV-based `chooseAd` with fallback, the heal/upgrade `chooseShopPurchase`, and the
  `applySolveResult`/`applyBuyResult` state-merge helpers — Phase 2.
- The `playGame` runner wiring strategy to the seam, with dual termination guards and typed-error
  pass-through — Phase 3.
- `ConsoleLogger` (pino) + the `index.ts` composition root with leveled narration, a FINAL SCORE
  banner, and a 3-way exit code; one accepted live smoke run — Phase 4.

### What Worked
- **The injectable-seam-first decision.** Defining `ApiClient` as the very first artifact made every
  later phase testable offline against `FakeApiClient` — 151 tests run with zero live network. This
  was the single highest-leverage call in the milestone.
- **Functional core / imperative shell.** Keeping `strategy.ts` pure (types-only imports) made the
  bug-prone logic trivially testable with plain-object fixtures and no mocks.
- **TDD discipline held end-to-end.** RED-before-GREEN commit ordering is visible in git history;
  the strategy phase alone landed 116 tests before any loop touched it.
- **Phase verification + the milestone audit agreed.** Every phase passed individually, and the
  cross-phase integration check found 0 broken seams — the inside-out build order paid off.

### What Was Inefficient
- **Phase 2 needed a gap-closure pass (02-05).** Three review warnings (non-finite reward/cost
  guards, the buy-seam returning `BuyResult`) forced a re-verification. Catching the `buy()` return
  shape during planning rather than review would have saved a round-trip.
- **Advisory comment drift.** Several guard rationale comments are factually inaccurate (the zod
  boundary already rejects non-finite values). Correct code, misleading prose — caught only at
  review, carried forward as tech debt.

### Patterns Established
- **One module owns each external concern:** `api.ts` is the sole `fetch` caller; `logger.ts` is the
  sole pino importer; `index.ts` is the sole construction/injection site. Greppable single sources
  of truth.
- **`END` as a shared const + a compile-time drift assertion** (`_AssertEndValuesAreEndReason`) so
  the producer (runner) and consumer (exit-code mapping) can never diverge silently.
- **State changes only ever fold through merge helpers** — never `state = rawResult` — so a buy can
  never clobber the running score.

### Key Lessons
1. Pin the seam interfaces (especially return shapes like `buy(): Promise<BuyResult>`) during
   planning, not review — the one shape that drifted caused the only re-verification of the milestone.
2. When a guard is defense-in-depth against something the boundary already prevents, say so in the
   comment — inaccurate rationale is itself a (minor) debt that reviewers must reconcile.
3. Inside-out, test-first build order (seam → pure core → shell → CLI) let each phase verify in
   isolation and made the final cross-phase integration check a formality rather than a debugging session.

### Cost Observations
- Model mix: not tracked this milestone (quality profile; opus main loop, sonnet for sub-agent
  verification/integration checks).
- Notable: 108 commits over 4 calendar days; zero live-network tests kept the inner loop fast.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 4 | 15 | Inaugural milestone — established inside-out TDD build order behind an injectable API seam |

### Cumulative Quality

| Milestone | Tests | Live-network tests | Runtime deps |
|-----------|-------|--------------------|--------------|
| v1.0 | 151 | 0 | pino, pino-pretty, zod |

### Top Lessons (Verified Across Milestones)

1. (Pending a second milestone to cross-validate.) Candidate: the injectable seam is the decision
   that makes a TDD-first API bot cheap to test.
