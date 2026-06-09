# Phase 2: Strategy Core — Pure Decision Logic (TDD) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 2-Strategy Core — Pure Decision Logic (TDD)
**Areas discussed:** Risk floor, Healing policy, Upgrade policy, No-eligible-ad fallback

---

## Risk floor

### Probability floor

| Option | Description | Selected |
|--------|-------------|----------|
| Floor at `Hmmm....` (rank ≥ 6) | Skip `Gamble` and riskier; only attempts ~55%+ odds; research default, safest play | ✓ |
| Floor at `Gamble` (rank ≥ 5) | Attempt down to a ~coin-flip; balanced; more aggressive scoring, more life-loss variance | |
| EV-only, no hard floor | Only `Impossible` (EV 0) excluded; maximally aggressive; highest ceiling, bleeds lives | |

**User's choice:** Floor at `Hmmm....` (rank ≥ 6)
**Notes:** Conservative pre-filter applied before EV ranking; relies on EV to pick among solid ads.

### EV tiebreak direction

| Option | Description | Selected |
|--------|-------------|----------|
| Sooner-expiring first | Lowest `expiresIn` wins ties — use-it-or-lose-it; secondary tiebreak = higher reward | ✓ |
| More runway first | Highest `expiresIn` wins — keeps near-expiry ad as backup; may lose it | |
| Reward only, ignore expiry | Break ties by reward; violates the "expiry-aware tiebreak" criterion | |

**User's choice:** Sooner-expiring first
**Notes:** Secondary tiebreak on higher reward when `expiresIn` also ties (deterministic for tests).

---

## Healing policy

| Option | Description | Selected |
|--------|-------------|----------|
| Heal below full (lives < 3) | Top up whenever lives < 3 and gold ≥ hpot cost; research default; survival-first, maximizes longevity | ✓ |
| Heal only when critical (lives ≤ 1) | Frugal with turns/gold; thin buffer, higher variance | |
| Adaptive (rich vs. poor) | Heal at lives ≤ 2 when gold ≥ 150, else lives ≤ 1; middle ground, extra branch | |

**User's choice:** Heal below full (lives < 3)
**Notes:** Game ends at lives = 0, so longevity is the scoring lever; `hpot` looked up live in shop, not hardcoded.

---

## Upgrade policy

### Healing buffer to reserve

| Option | Description | Selected |
|--------|-------------|----------|
| Reserve 100g (2 potions) | Keep ≥100 gold before any upgrade; research default; balances leveling vs. cushion | ✓ |
| Reserve 150g (3 potions) | More cautious; upgrades less often; slower leveling | |
| Reserve 50g (1 potion) | Minimal cushion; levels fastest; higher variance | |

**User's choice:** Reserve 100g (2 potions) — buy upgrade only when `gold − upgradeCost ≥ 100`

### Which upgrade to buy

| Option | Description | Selected |
|--------|-------------|----------|
| Priciest affordable | Most expensive non-`hpot` item up to 300g; pricier = stronger; turn-efficient | ✓ |
| Cheapest upgrade (100g) | Smaller commitment per buy; keeps gold liquid; less turn-efficient | |
| You decide | Implementation picks a sensible default | |

**User's choice:** Priciest affordable (selected by live cost, not hardcoded id)
**Notes:** Decision ordering captured as heal > upgrade > solve; upgrade only when lives healthy.

---

## No-eligible-ad fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Least-bad gamble | If any ads exist, relax floor and solve highest-EV one; `chooseAd` returns null only on empty board | ✓ |
| Signal 'no eligible ad' → runner decides | Never attempt sub-floor; runner heals/upgrades or ends cleanly; forfeits score when stuck | |
| End the run immediately | No eligible ad → terminal signal; simplest contract, lowest ceiling | |

**User's choice:** Least-bad gamble
**Notes:** Heal/upgrade decisions run first each turn; a forced gamble that may pay off beats forfeiting score. `chooseAd` never throws and never relaxes onto an ad that would 400 (still excludes unhandled-encryption + expired ads).

---

## Claude's Discretion

- Exact function names/signatures for selection, filtering, ranking, the two state-merge helpers, and the shop-decision function(s); whether `chooseAd` returns `Ad | null` or a discriminated union.
- Thresholds expressed as named constants (`PROBABILITY_FLOOR_RANK = 6`, `MAX_LIVES_TO_KEEP = 3`, `HEAL_BUFFER_GOLD = 100`); costs read live from the shop.
- Where/how the EV product is computed (sort vs. reduce) — any readable form.
- Whether the buy-merge consumes a raw `BuyResult` or post-processes `api.ts`'s partial `GameState` (must preserve `score`/`highScore` either way).

## Deferred Ideas

None — discussion stayed within Phase 2 scope. v2 strategy enhancements (STRAT-07 adaptive probability memory, STRAT-08 reputation weighting) remain parked in REQUIREMENTS.md.
