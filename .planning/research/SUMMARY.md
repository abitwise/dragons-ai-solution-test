# Project Research Summary

**Project:** Dragons of Mugloar Autoplay Bot
**Domain:** TypeScript/Node CLI bot consuming an external REST game API (TDD, human-readable logging)
**Researched:** 2026-06-09
**Confidence:** HIGH

## Executive Summary

This is a single-run, sequential CLI bot that plays the Dragons of Mugloar game autonomously
via its public REST API, scores as high as possible before game-over (target ≥ 1000), and logs
every decision in human-readable form. All four researchers independently converged on the same
build order and architecture: a thin, injectable `ApiClient` interface as the TDD seam, a pure
`strategy.ts` functional core holding all decision logic, and a thin `runner.ts` orchestrator
loop — six flat source files total, no folders, no DI container, no database, no web server.
The single most important design decision is defining the `ApiClient` interface in step one so
that every downstream piece can be tested offline against a hand-written fake.

The recommended "boring is best" stack is Node 24 LTS + TypeScript 5.9 (explicitly NOT 6.0,
which is a breaking-change transition release) + tsx for zero-config execution + Vitest for TDD
+ Pino/pino-pretty for leveled human-readable output + Biome for lint/format. Native `fetch`
replaces axios; there is no case for a network-interceptor library (nock/msw) once the client
is injectable. The API surface was verified live on 2026-06-09: six endpoints, non-`www` base
URL, eleven probability strings ordered best-to-worst (treated as a rank not a calibration),
two encryption schemes (Base64 for `encrypted:1`, ROT13 for `encrypted:2`), and a solve/buy
field asymmetry that requires careful state merging.

The three highest-risk areas are: (1) encrypted ads — all three fields (`adId`, `message`,
`probability`) must be decoded together or the bot silently fails on high-reward ads and/or
receives HTTP 400 from the solve endpoint; (2) infinite loops — the loop must have both a
max-turn safety cap and a no-progress guard, not just `while (lives > 0)`; (3) probability
mis-ranking — the label `"Hmmm...."` has exactly four dots and `Gamble` plays closer to 50/50
than its name implies, so the map must be treated as a rank, not a calibrated percentage. All
three risks are LOW recovery cost if the seam and structure are established first.

## Key Findings

### Recommended Stack

The stack is intentionally minimal. Node 24 Active LTS ships stable native `fetch` and stable
type-stripping; tsx wraps it with zero config and handles enum/namespace transforms that bare
Node stripping cannot. TypeScript 5.9 is the safe, well-documented baseline; 6.0 (released
March 2026) is a breaking-change transition release for the upcoming Go rewrite and should be
avoided for a greenfield project with no upside from the churn. Vitest provides fast TDD with
native ESM/TS support, Jest-compatible ergonomics, and watch mode. Pino + pino-pretty gives
proper log levels and colorized human-readable output for the per-turn narration the brief
requires. Biome replaces ESLint + Prettier in one binary with near-zero configuration.

**Core technologies:**
- **Node.js 24 LTS**: runtime — Active LTS in 2026, stable native `fetch`, target for `engines` field
- **TypeScript 5.9** (pin `~5.9`, avoid 6.0): type system — 6.0 is a breaking-change transition release, gains nothing here
- **tsx 4.x**: zero-config TS execution — handles enums/decorators that bare Node stripping skips; no build step
- **Native `fetch`** (built into Node 24): HTTP client — zero dependencies; wrap once behind `GameApi` interface
- **Vitest 4.x**: TDD test runner — flawless ESM+TS, fast watch mode, Jest-compatible, built-in coverage
- **Pino 10.x + pino-pretty 13.x**: leveled logging — JSON in prod, colorized human-readable in dev; child loggers for turn tagging
- **Biome 2.x**: lint + format — single Rust binary, one config file, replaces ESLint+Prettier
- **@tsconfig/node24**: base tsconfig — maintained Node 24 baseline, extend rather than hand-roll options

**Do not use:** TypeScript 6.0, axios/got/ky (unnecessary for 5 endpoints), nock/msw (the
injected interface makes them redundant), winston (too heavy), ts-node (superseded by tsx),
any DI container (overkill; "DI" here means passing one argument), CommonJS, Node 26 (Current,
not LTS until Oct 2026).

### Expected Features

The API surface is fully verified live (2026-06-09). Six endpoints: start, messages, solve,
shop, buy, investigate/reputation. Key asymmetry: solve responses include `score`/`highScore`
but not `level`; buy responses include `level` but not `score` — state must be merged, not
replaced. `reward` can arrive as a string in JSON; coerce before arithmetic. Non-2xx from
`/solve` returns HTML, not JSON. The base URL must use the non-`www` host
(`https://dragonsofmugloar.com/api/v2`) — the `www` variant returned nginx 404s in live
testing.

**Must have (v1 table stakes):**
- Typed API client for all 5 core endpoints (start / messages / solve / shop / buy) — nothing works without it
- In-memory game-state model threaded across turns (`lives / gold / score / level / turn / gameId`) — every decision needs it
- Probability string → rank lookup, exact-string keyed, unknown = worst, never throw — drives the heuristic
- Ad filtering: drop `expiresIn <= 0` and any `encrypted` value not handled (avoids 400s and wasted turns)
- Ad-selection heuristic: sort by `(probabilityRank desc, reward desc)` or `reward × rank`, solve the top — the core loop
- Heal: buy `hpot` when `lives < 3 && gold >= 50` — basic survival
- Autoplay loop to `lives === 0` with a max-turn safety cap (e.g. 1000) and a no-progress guard
- Bounded retry (3 attempts, backoff) + graceful termination on errors — handle non-JSON error bodies
- Leveled, human-readable per-turn logging + distinct final-score block — explicit brief requirement
- TDD unit tests over the heuristic + state updates against a mocked client — explicit constraint

**Should have (v1.x differentiators — add after v1 is stable):**
- Decode encrypted ads: Base64 for `encrypted:1`, ROT13 for `encrypted:2`; decode all three fields (`adId`, `message`, `probability`) together — highest ROI differentiator, both schemes are trivial
- Buy level-raising upgrades (100g cheapest, 300g stronger) when flush with gold and a heal buffer is reserved — raises ad rewards
- Expiry-aware tie-breaking (`expiresIn` as secondary sort) and EV ranking (`reward × rank`)

**Defer to v2+:**
- Adaptive within-game probability memory (borderline over-engineering vs "keep it simple")
- Multi-game runs and score stats aggregation (explicitly out of scope in PROJECT.md)
- Reputation-aware ad weighting via `/investigate/reputation` (unclear payoff for v1)

**Anti-features — do not build:**
- ML / search / Monte-Carlo optimizer (out of scope, hard to test, no probability data)
- Hardcoded shop item costs/effects (brittle; read the live shop list, select by `id`)
- Persistent storage / database (in-memory for one run, by design)
- Web UI / frontend (CLI only)
- Concurrency / parallel game solving (no scoring benefit; adds race conditions)

### Architecture Approach

The right shape is a **functional core / imperative shell** in six flat source files under
`src/` with no subfolders. All decision logic lives in pure functions in `strategy.ts` (no
`await`, no `fetch`, no `console`). All I/O lives in the shell (`api.ts`, `runner.ts`,
`logger.ts`, `index.ts`). The `ApiClient` interface declared in `types.ts` is the critical TDD
seam: production wires `HttpApiClient`, tests wire a hand-written `FakeApiClient`. The
`index.ts` composition root is the only place real implementations are constructed. State is a
single `let state` variable threaded through the loop — no mutation, no event bus, no database.

**The six components:**
1. `types.ts` — all shared interfaces and data models (`GameState`, `Ad`, `ShopItem`, `SolveResult`, `GameReport`, `ApiClient`, `Logger`); no logic; no imports
2. `api.ts` — `ApiClient` interface + `HttpApiClient` (the only `fetch` caller) + retry-at-the-edge; maps raw JSON to typed models
3. `strategy.ts` — pure decision functions: `scoreProbability`, `chooseAd`, `applyResult`, `decideBuys`, `shouldShop`; the bulk of the test surface
4. `runner.ts` — `playGame(api, logger)`: the turn loop; calls API, hands plain values to strategy, applies decisions, logs each step, stops at `lives === 0` or cap
5. `logger.ts` — leveled console `Logger` implementing the `Logger` interface; thin wrapper
6. `index.ts` — CLI composition root; wires real deps, parses minimal flags, prints `GameReport`, sets exit code

**Direction of dependencies:** `types.ts` <- `api.ts`, `strategy.ts`, `logger.ts` <- `runner.ts` <- `index.ts`. Everything points inward. `strategy.ts` imports nothing but types.

### Critical Pitfalls

1. **Encrypted ads: decode all three fields or none** — when `encrypted` is `1` (Base64) or `2` (ROT13), `adId`, `message`, AND `probability` are all encoded. Decoding only `message` leaves an encoded `adId` that produces HTTP 400 from `/solve`; decoding nothing silently drops high-reward ads. Fix: a single `parseAd` step in the API client decodes all three fields together before the ad reaches strategy code.

2. **`adId` must be URL-encoded in the solve path** — decoded (or even raw) `adId` values can contain `/`, `+`, `=` that corrupt the path. Use `encodeURIComponent(adId)` everywhere a path segment is built; centralize URL construction in the API client; add a unit test with a `/`-containing id.

3. **Infinite loop when no solvable ad exists** — `while (lives > 0)` is not sufficient. If every ad is below the probability floor and no shop action can change that, the loop spins forever. Fix: a hard max-turn cap (e.g. 1000) AND a no-progress guard (if a pass consumes no turn, break). Always define a fallback for an empty or all-risky board.

4. **Probability mis-ranking / string fragility** — the label `"Hmmm...."` has exactly four dots and four m's. Typed maps with a single wrong character silently mismatch. Treat the map as an ordered rank, not a calibrated percentage (`Gamble` is empirically ~50/50). Use an exact-string `as const` map; unknown labels log a warning and rank worst, never throw.

5. **`success` field, not HTTP status, is the truth** — a failed solve (life lost) returns HTTP 200 with `success: false`. Non-2xx responses (including 400 from a bad `adId`) return HTML, not JSON. Always read the body's `success` boolean and use the returned `lives/gold/score/turn` as the new source of truth.

## Implications for Roadmap

All four researchers independently arrived at the same inside-out build order. The following
phase structure directly reflects their convergent recommendation. Build the testable core
before the I/O shell; establish the `ApiClient` seam in phase 1 so all later phases can be
tested offline.

### Phase 1: Foundation — Types, API Client, and Test Seam

**Rationale:** Every other phase depends on the shared types and the injectable `ApiClient`
interface. The TDD seam must exist first; without it, strategy and loop tests require a network.
This phase also bakes in the two critical API-client pitfalls (decode all three encrypted
fields, `encodeURIComponent` all path segments) before any strategy code is written.

**Delivers:** `types.ts` (all interfaces and models), `api.ts` (`HttpApiClient` with retry and
encryption decoding), the `FakeApiClient` test double in `tests/`. Suite passes offline.

**Features addressed:** Typed API client for all 5 core endpoints; encrypted-ad decoding
(Base64 / ROT13) of all three fields; `expiresIn` filtering; bounded retry; non-JSON
error-body handling; `reward` coercion; `encodeURIComponent` on path segments.

**Pitfalls addressed:** Encrypted-ad field decoding (#1), `adId` URL encoding (#2), transport
error handling, `reward` type coercion.

### Phase 2: Strategy Core — Pure Decision Logic (TDD)

**Rationale:** The pure functions in `strategy.ts` are the most valuable, most bug-prone code.
They can be fully test-driven with zero mocks (inputs are plain objects). Building and testing
this before the loop means the loop integrates already-proven logic.

**Delivers:** `strategy.ts` with `scoreProbability` (full 11-label map including `"Hmmm...."`),
`chooseAd` (safety gate + EV sort), `applyResult` (careful merge of solve/buy field
asymmetry), `decideBuys` (heal-first, upgrade-with-buffer), `shouldShop`. Comprehensive
`strategy.test.ts` covering all probability labels, mixed boards, empty boards, heal trigger,
upgrade guard.

**Features addressed:** Probability rank map; ad-selection heuristic; risk gating
(`Impossible`/`Suicide mission` never attempted); heal-before-risk rule; `expiresIn`
tiebreaker; upgrade purchasing logic.

**Pitfalls addressed:** Probability mis-ranking and `"Hmmm...."` string fragility (#4);
suicide/impossible attempts; probability used as rank not calibration.

### Phase 3: Game Loop and Shop Integration

**Rationale:** With a proven `ApiClient` seam and proven `strategy.ts`, `runner.ts` becomes
thin integration glue. The `FakeApiClient` from Phase 1 drives `runner.test.ts` to verify loop
behavior without touching the network.

**Delivers:** `runner.ts` (`playGame(api, logger)` with full turn loop, shop integration,
safety cap, no-progress guard, graceful termination on error), `runner.test.ts` covering normal
play, game-over-on-lives-zero, cap-triggered termination, all-risky board, empty board, API
error.

**Features addressed:** Autoplay loop to game-over; max-turn safety cap; no-progress guard;
heal purchase; upgrade purchase; state threading; error recovery.

**Pitfalls addressed:** Infinite loop (#3); stale board / `expiresIn` decay — messages
re-fetched after every turn-consuming action; `success` field vs HTTP status (#5).

### Phase 4: Logger, CLI Entry, and Live Smoke

**Rationale:** With the core fully tested, this phase is wiring and presentation. `logger.ts`
is trivial. `index.ts` is the composition root. The only validation requiring the live API is a
manual smoke run here.

**Delivers:** `logger.ts` (leveled Pino wrapper), `index.ts` (composition root with shebang,
minimal flag parsing, `GameReport` print with score / turns / end reason, exit code), live
smoke run against the real API.

**Features addressed:** Human-readable leveled logging (INFO per decision, WARN for skips,
ERROR for failures); distinct final-score block; `npm run start` runs a complete game.

**Pitfalls addressed:** Over-noisy vs too-quiet logging; wrong log levels; no clear final-score
summary; tests remain offline — smoke run is the only live call.

### Phase Ordering Rationale

- `types.ts` is the leaf of the dependency graph — it has no imports and everything else
  imports from it; it must exist first.
- The `ApiClient` interface (defined in Phase 1) is what makes Phases 2 and 3 testable offline;
  encryption decoding belongs in the client where raw JSON is first touched.
- Strategy is built and tested before the loop so bugs surface at the smallest scope; the loop
  integrates already-proven logic.
- The CLI entry (Phase 4) adds no new testable logic — it is purely wiring.
- This order catches infinite loops and bad probability maps in unit tests (Phases 2–3) before
  a single live API call is made (Phase 4).

### Research Flags

Phases with standard, well-documented patterns (research-phase not needed during planning):
- **Phase 2 (strategy):** Pure function TDD is well-understood; the probability map and
  heuristic are fully specified in FEATURES.md.
- **Phase 3 (loop):** Standard sequential bot loop; `FakeApiClient` pattern is documented in
  ARCHITECTURE.md.
- **Phase 4 (logger/CLI):** Pino + pino-pretty and Biome setup are trivial and well-documented.

Phases that may benefit from a targeted review during planning:
- **Phase 1 (API client):** The live API has confirmed quirks (non-`www` hostname, HTML 400
  bodies, `reward` sometimes string-typed, `encrypted` applies to all three ad fields). Worth a
  re-read of the FEATURES.md verification notes during task breakdown. Low research cost —
  findings are already documented here.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Node 24/TS 5.9/tsx/Vitest/Pino versions confirmed via npm registry 2026-06-09; TS 6.0 avoidance backed by official release notes |
| Features | HIGH | Full API surface exercised live 2026-06-09; probability strings, encryption variants, shop catalog, and solve/buy field asymmetry all verified directly |
| Architecture | HIGH | Functional core/imperative shell is a well-established pattern; the 6-file flat structure and `ApiClient` seam are independently validated by all four researchers |
| Pitfalls | HIGH | Encrypted-ad and infinite-loop pitfalls verified against two working reference implementations (renee-saks TS, CardoEggert Java); API field behaviors observed live |

**Overall confidence:** HIGH

### Gaps to Address

- **Probability approximate percentages** (MEDIUM/LOW): The API never returns numeric odds. The
  full label ordering is HIGH confidence; the approximate percentages are community estimates.
  Resolution: treat the map as a pure rank (0–10 integer) for all heuristic math; gate on tier;
  use rank only as a weight multiplier if EV math is desired.

- **Shop effects are inferred, not documented** (MEDIUM): The API returns only `id/name/cost`;
  effects were confirmed empirically but not in the API response. Resolution: select `hpot` for
  healing by `id`; watch the `level` field in buy responses for upgrade confirmation — no
  hardcoding of effects needed.

- **Non-`www` hostname caveat** (MEDIUM): Live testing found `www.` returned nginx 404s. The
  base URL must be configurable (an env var or constant, not duplicated). PROJECT.md references
  the `www.` form; implementation should default to the non-`www` form and document the
  distinction.

- **`reward` field type coercion** (LOW): In some responses `reward` arrives as a JSON string.
  Always coerce with `Number(ad.reward)` in the API client before the value enters the typed
  model. Caught at the client boundary; zero risk to strategy logic.

## Sources

### Primary (HIGH confidence)

- Live Dragons of Mugloar API (`https://dragonsofmugloar.com/api/v2`), exercised 2026-06-09 —
  all six endpoints, full probability string set, both encryption variants decoded, complete
  shop catalog, solve/buy field asymmetry, HTTP 400 HTML body on bad adId, non-`www` hostname
- `renee-saks/dragons-of-mugloar` (TypeScript, 2025) — encrypted-ad three-field decoding,
  base64 regex validation before `atob`, canonical 11-label probability map, EV selection
- `CardoEggert/DragonsOfMugloarPlayer` (Java) — probability labels with empirical calibration
  notes, `timeToLive = 200` infinite-loop guard, heal-before-risk strategy
- Node.js 24 release schedule — https://nodejs.org/en/about/previous-releases
- TypeScript 6.0 breaking changes — https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- npm registry version checks for all packages (2026-06-09)

### Secondary (MEDIUM confidence)

- `jcarlosvale/dragonsOfMugloar` (Java) — reward+expiry sort strategy, score >= 1000 target
- Official API doc `https://dragonsofmugloar.com/doc/` — endpoint paths cross-checked (JS-rendered SPA)
- Vitest vs node:test vs Jest 2026 — https://www.pkgpulse.com/guides/node-test-vs-vitest-vs-jest-native-test-runner-2026
- Pino vs Winston 2026 — https://www.pkgpulse.com/guides/pino-vs-winston-2026

### Tertiary (LOW confidence)

- Approximate success percentages per probability label — community estimates only; the API
  never returns numeric odds; treat ordering as the only reliable signal

---
*Research completed: 2026-06-09*
*Ready for roadmap: yes*
