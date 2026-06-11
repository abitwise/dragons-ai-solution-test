# Milestones

## v1.0 Autoplay Bot (Shipped: 2026-06-11)

**Delivered:** A TypeScript CLI bot that autonomously plays a full game of Dragons of Mugloar to
game-over and reports its final score — built test-first, with a functional decision core behind an
injectable API seam, leveled human-readable narration, and a 3-way exit code.

**Stats:**
- Phases: 4 (1–4) · Plans: 15 · Tasks: 29
- Source: 15 TypeScript files in `src/` (8 modules + 7 test files), ~3.8k LOC incl. tests
- Tests: 151 offline unit tests (Vitest), zero live network in the suite
- Timeline: 2026-06-08 → 2026-06-11 (4 days)
- Audit: passed (18/18 requirements, integration PASS, 2/2 E2E flows) — see `milestones/v1.0-MILESTONE-AUDIT.md`
- Live smoke: two real-API runs accepted (score 3768 / 70 turns; score 5838 / 93 turns; exit 0 both)

**Key accomplishments:**

- **Phase 1 — Foundation, API client & test seam:** Defined the injectable `ApiClient`/`Logger`
  interfaces and shared models in `types.ts` (the leaf every later phase imports), the pure
  all-three-fields-or-none `decodeAd` (Base64/ROT13), the hand-written offline `FakeApiClient`
  (no nock/msw), and the live `HttpApiClient` — the codebase's single `fetch` caller with
  per-endpoint zod schemas, a TransportError/BoundaryError taxonomy, retry-at-the-edge for reads
  only, `encodeURIComponent` on every segment, and HTML-error tolerance.
- **Phase 2 — Strategy core (pure decision logic, TDD):** Built `strategy.ts` as a types-only
  functional core: exact-string probability ranking (unknown → worst, never throws), one-place ad
  eligibility filtering, `chooseAd` by expected value (`reward × rank`) with an expiry-aware
  tiebreak and a least-bad-gamble fallback, `chooseShopPurchase` (heal `hpot` when lives low, else
  priciest affordable upgrade with a 100-gold buffer, all at live costs), and the asymmetry-
  preserving `applySolveResult`/`applyBuyResult` state-merge helpers.
- **Phase 3 — Game loop & shop integration:** TDD-built the `playGame(api, logger)` imperative
  shell wiring the proven strategy to the proven seam — a full scripted game runs to lives:0 and
  returns a correct `GameReport`, with dual termination guards (max-turn cap + no-progress stall
  counter) proving the loop can never spin forever, and typed errors passing through verbatim.
- **Phase 4 — Logger, CLI & live smoke:** Added `ConsoleLogger` (the sole pino importer) behind
  the `Logger` interface and the `index.ts` composition root — the only site constructing the real
  client + logger and injecting them into `playGame` — with leveled per-turn narration, an
  always-visible FINAL SCORE banner, and a 3-way exit code (0/1/2) without ever calling
  `process.exit()`. The one-and-only live smoke run was executed and accepted.

**Known deferred items at close:** 0 (artifact audit clear). Advisory tech debt (inaccurate guard
comments, theoretical EV overflow not reachable via the live API, minor code smells) is recorded in
`milestones/v1.0-MILESTONE-AUDIT.md` as v2 backlog candidates — none block the milestone.

---
