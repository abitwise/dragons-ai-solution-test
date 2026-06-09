# Requirements: Dragons of Mugloar Autoplay Bot

**Defined:** 2026-06-09
**Core Value:** The bot autonomously plays a full game of Dragons of Mugloar to completion and reports its final score — driven by a simple, correct, well-tested decision loop.

## v1 Requirements

Requirements for the initial release. Each maps to a roadmap phase.

### Game API Integration

- [x] **API-01**: Bot can start a new game and capture initial state (gameId, lives, gold, level, score, turn)
- [x] **API-02**: Bot can fetch the current ads/messages with all fields (adId, message, reward, expiresIn, encrypted, probability)
- [x] **API-03**: Bot can solve a chosen ad and read its result (success, lives, gold, score, turn)
- [x] **API-04**: Bot can fetch the shop catalog and buy an item by id
- [x] **API-05**: Bot decodes encrypted ads (Base64 for `encrypted:1`, ROT13 for `encrypted:2`) across adId, message, and probability
- [x] **API-06**: API client is robust to real-world quirks — URL-encodes path segments (adId/itemId), coerces string `reward` to number, tolerates non-JSON (HTML) error bodies, retries transient failures with bounded backoff, and terminates cleanly without crashing

### Decision Strategy

- [x] **STRAT-01**: Bot maps each probability string to a rank via exact-string lookup; an unknown string ranks worst and never throws
- [x] **STRAT-02**: Bot filters out ineligible ads (expired `expiresIn <= 0`, below the probability floor, or unhandled encryption)
- [x] **STRAT-03**: Bot selects the best ad by expected value (reward × success rank) with an expiry-aware tiebreak
- [x] **STRAT-04**: Bot buys a healing potion (`hpot`) when lives are low and gold allows
- [x] **STRAT-05**: Bot buys level-raising upgrades from surplus gold only after reserving a healing buffer
- [x] **STRAT-06**: Bot merges solve and buy responses into game state correctly (solve omits `level`, buy omits `score`)

### Autoplay Loop

- [ ] **LOOP-01**: Running the CLI plays one full game autonomously with no human input
- [ ] **LOOP-02**: The loop runs until lives reach 0, enforcing a max-turn safety cap and a no-progress guard so it can never run forever
- [ ] **LOOP-03**: Ads are re-fetched after each turn-consuming action (expiry stays current), and a defined fallback is applied when no eligible ad exists

### Logging & Output

- [ ] **LOG-01**: Each turn's decision and outcome is logged in human-readable, leveled output
- [ ] **LOG-02**: A clear final-score summary (score, turns, end reason) is printed on game end, and the CLI exits with a status code reflecting the run outcome

### Testing (TDD)

- [x] **TEST-01**: Core logic (strategy, state updates, and loop) is built test-first and covered by fast, deterministic unit tests against a mocked/faked API client — no live network in the suite

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

### Strategy Enhancements

- **STRAT-07**: Adaptive within-game probability memory (prefer labels that have been succeeding, avoid ones that have been failing)
- **STRAT-08**: Reputation-aware ad weighting via `POST /{gameId}/investigate/reputation`

### Run Modes

- **RUN-01**: Multi-game runs with score statistics aggregation (average/best) for benchmarking the strategy

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| ML / search / Monte-Carlo strategy optimizer | Out of scope per brief ("keep it simple"); opaque, hard to test, no probability data to train on — a readable heuristic clears the bar |
| Hardcoded shop item ids / costs / effects | Brittle if the catalog changes, and effects aren't returned by the API — read the live shop and select by `id` |
| Persistent storage / database | One in-memory run per CLI invocation, by design |
| Web UI / frontend | Backend CLI exercise; leveled console logging is the interface |
| Hitting the live API from the test suite | Flaky, slow, non-deterministic — use a mocked client; live runs are a separate manual smoke check |
| Concurrency / parallel game solving | No scoring benefit for a sequential game; adds race conditions |
| Decoding exotic `encrypted` values beyond `1` and `2` | Speculative — only schemes `1`/`2` exist; skip any ad with an unknown scheme |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| API-01 | Phase 1 | Complete |
| API-02 | Phase 1 | Complete |
| API-03 | Phase 1 | Complete |
| API-04 | Phase 1 | Complete |
| API-05 | Phase 1 | Complete |
| API-06 | Phase 1 | Complete |
| STRAT-01 | Phase 2 | Complete |
| STRAT-02 | Phase 2 | Complete |
| STRAT-03 | Phase 2 | Complete |
| STRAT-04 | Phase 2 | Complete |
| STRAT-05 | Phase 2 | Complete |
| STRAT-06 | Phase 2 | Complete |
| LOOP-01 | Phase 3 | Pending |
| LOOP-02 | Phase 3 | Pending |
| LOOP-03 | Phase 3 | Pending |
| LOG-01 | Phase 4 | Pending |
| LOG-02 | Phase 4 | Pending |
| TEST-01 | Phase 2 | Complete |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18 ✓
- Unmapped: 0

**By phase:**
- Phase 1 (Foundation — Types, API Client & Test Seam): 6 (API-01..06)
- Phase 2 (Strategy Core — Pure Decision Logic, TDD): 7 (STRAT-01..06, TEST-01)
- Phase 3 (Game Loop & Shop Integration): 3 (LOOP-01..03)
- Phase 4 (Logger, CLI & Live Smoke): 2 (LOG-01..02)

---
*Requirements defined: 2026-06-09*
*Last updated: 2026-06-09 after roadmap creation (traceability populated)*
