# Pitfalls Research

**Domain:** Dragons of Mugloar autoplay bot (TypeScript / Node CLI, API-consuming, TDD)
**Researched:** 2026-06-08
**Confidence:** HIGH for API/game-mechanics pitfalls (verified against working solution source code); MEDIUM-HIGH for TDD/logging/simplicity pitfalls (general best practice applied to this specific domain)

> **Evidence base.** API and game-mechanics findings below are verified against working
> implementations: `renee-saks/dragons-of-mugloar` (TypeScript, handles encrypted ads),
> `CardoEggert/DragonsOfMugloarPlayer` (Java, documents real-world probability calibration and
> the infinite-loop guard). The official API at `dragonsofmugloar.com/api/v2` was not directly
> reachable from this environment (sandbox returned nginx 404), so endpoint shapes are confirmed
> from source rather than a live call — flagged where it matters.

---

## Reference: Verified API & Game Facts

These underpin the pitfalls. Confirmed from source code (HIGH confidence).

**Endpoints** (base `https://www.dragonsofmugloar.com/api/v2`):
- `POST /game/start` → `{ gameId, lives, gold, level, score, highScore, turn }`
- `GET /{gameId}/messages` → array of ads
- `POST /{gameId}/solve/{adId}` → `{ success, lives, gold, score, highScore, turn, message }`
- `GET /{gameId}/shop` → array of `{ id, name, cost }`
- `POST /{gameId}/shop/buy/{itemId}` → `{ shoppingSuccess, gold, lives, level, ... }`
- `GET /{gameId}/investigate/reputation` → optional reputation breakdown (not required for v1)

**Ad fields:** `adId` (string), `message` (string), `reward` (number, sometimes string-typed in JSON), `expiresIn` (number — decrements each turn), `probability` (text), `encrypted` (`1` = base64, `2` = ROT13, `null`/absent = plaintext).

**Probability ranking (safest → riskiest, 11 levels):** `Sure thing` (~99) > `Piece of cake` (~95) > `Walk in the park` (~85) > `Quite likely` (~75) > `Hmmm....` (~65) > `Gamble` (~55) > `Risky` (~45) > `Rather detrimental` (~35) > `Playing with fire` (~25) > `Suicide mission` (~15) > `Impossible` (0). **Note the literal string `"Hmmm...."` has exactly four dots.** One working bot empirically found `Gamble` plays closer to ~50/50 and `Hmmm....` closer to ~60% — the labels are a ranking, not a calibrated probability.

---

## Critical Pitfalls

### Pitfall 1: Encrypted ads — decoding the wrong fields (or none)

**What goes wrong:**
When `encrypted` is `1` (base64) or `2` (ROT13), **`adId`, `message`, AND `probability` are all encoded**, not just the message. Two failure modes follow: (a) the bot ignores `encrypted` entirely, so it tries to map a base64 `probability` string (e.g. `U3VyZSB0aGluZw==`) against the known probability labels, fails the match, and silently drops every encrypted ad — throwing away some of the highest-reward ads in the game; or (b) the bot decodes `message`/`probability` for display but then POSTs the still-encoded `adId` to `/solve/{adId}`, which 404s or fails. The `CardoEggert` Java bot exhibits failure mode (a): its mapper returns `null` for any ad whose probability text isn't a known label, so encrypted ads never get solved.

**Why it happens:**
The `encrypted` flag is easy to miss in the response, and developers assume only the human-facing `message` is obfuscated. The PROJECT.md even lists "decoding advanced/encrypted ads" as out-of-scope — but base64/ROT13 are the *trivial* cases the brief expects you to handle, and skipping them quietly degrades score rather than failing loudly.

**How to avoid:**
Decode in a single `parseAd` step before the ad ever reaches strategy code: if `encrypted === 1` base64-decode all three fields; if `encrypted === 2` ROT13-decode all three; else pass through. Verified working pattern (renee-saks):
```
if (encrypted === 1) { adId = base64(adId); message = base64(message); probability = base64(probability); }
else if (encrypted === 2) { adId = rot13(adId); message = rot13(message); probability = rot13(probability); }
```
Decide explicitly what counts as "trivial": base64 + ROT13 in, anything else (unknown `encrypted` value) skipped *with a warning log*. Validate base64 with a regex before `atob` so a non-base64 string doesn't silently produce garbage. After decoding `probability`, it must match a known label — if it doesn't, log it; don't silently drop.

**Warning signs:**
Final scores are systematically lower than expected; logs show many ads "skipped" or "unrecognized probability"; a manual `GET /messages` shows ads with `encrypted: 1` that never appear in solve logs; intermittent 404s from `/solve/`.

**Phase to address:**
API client / ad-parsing phase (before strategy). The decode step is part of normalizing the ad into the internal model.

---

### Pitfall 2: adId not URL-safe in the solve path (especially after decoding)

**What goes wrong:**
The bot builds `/{gameId}/solve/{adId}` by raw string concatenation. Decoded (or even raw) `adId` values can contain characters that are unsafe in a URL path segment — base64 alphabet includes `+`, `/`, and `=`; decoded ids may contain `/`. A literal `/` in the adId silently changes the route; `=`/`+` may be misinterpreted. The result is a 404 or a "solve" against the wrong/garbage ad. Both reference bots concatenate the id directly (`gameId + "/solve/" + id`) with no encoding — fine for plain alphanumeric ids, a latent bug the moment an id contains a special char.

**Why it happens:**
Plain-text adIds in early turns look like clean alphanumerics, so concatenation "works on my machine." The problem only surfaces with certain encrypted/decoded ids later in a game — easy to miss in a quick test run.

**How to avoid:**
Always `encodeURIComponent(adId)` when building the solve and any id-bearing URL. Centralize URL construction in the API client so every call goes through the same encoder. Add a unit test with an adId containing `/`, `+`, `=`.

**Warning signs:**
Sporadic 404/400 on `/solve/` for specific ads while others succeed; failures correlate with encrypted ads; the failing adId in logs contains `/`, `+`, or `=`.

**Phase to address:**
API client phase (URL building lives here).

---

### Pitfall 3: Ignoring `expiresIn` decay — solving stale ads / chasing expiring high-value ads wrong

**What goes wrong:**
`expiresIn` is a per-ad countdown that **decrements every turn** (every solve/shop action). Two opposite mistakes: (a) the bot re-fetches `/messages` after every action (correct) but a strategy that "remembers" ads across turns operates on stale `expiresIn`, selecting an ad that has since expired → solve fails or the ad is gone; (b) the bot over-weights `expiresIn`, prioritizing a soon-to-expire ad over a much safer/more valuable one, lowering total score. A subtler version: a high-reward ad with `expiresIn: 1` is effectively un-gettable if you must heal/shop first (each of those consumes the turn).

**Why it happens:**
`expiresIn` looks like seconds but is *turns*. Developers either ignore it or treat it as a hard deadline to race, not a soft tiebreaker. Caching the message board to reduce API calls (a tempting optimization) makes the decay invisible.

**How to avoid:**
Re-fetch `/messages` after every action that consumes a turn (solve, buy) — never reuse a prior turn's list for selection. Treat `expiresIn` as a tiebreaker, not the primary sort key. Primary sort = expected value (`reward × probabilityWeight`); break ties toward lower `expiresIn`. Drop ads with `expiresIn <= 0` defensively even if the API still lists them.

**Warning signs:**
Solve calls fail with "ad expired"/not-found for ads that were valid last turn; the bot repeatedly picks low-value ads "because they're about to expire"; score plateaus while easy high-value ads time out unused.

**Phase to address:**
Strategy phase (selection ordering); API client phase enforces fresh fetch per turn.

---

### Pitfall 4: Attempting Suicide mission / Impossible (and not healing first)

**What goes wrong:**
A naive "highest reward" strategy picks the biggest-reward ad regardless of probability — and the biggest rewards cluster on `Suicide mission` / `Impossible` / `Playing with fire` ads. These almost always fail, **cost a life on failure**, and burn the turn (decaying every other ad's `expiresIn`). With only ~3 starting lives, two or three such attempts can end the game with near-zero score. A related mistake: attempting a risky-but-acceptable ad while at 1 life instead of buying a healing potion first.

**Why it happens:**
"Maximize reward" is the obvious first heuristic and is wrong here because reward and risk are positively correlated. The textual probability is easy to print but easy to forget to *gate* on.

**How to avoid:**
Gate selection on a minimum probability tier — never attempt `Impossible`, `Suicide mission`, or `Playing with fire`; treat `Risky`/`Rather detrimental` as last-resort only. Among acceptable ads, rank by expected value (`reward × weight`), not raw reward. Add a "heal before risk" rule: if `lives <= threshold` and gold ≥ potion cost, buy a healing potion before attempting anything below the safest tier. The CardoEggert bot only attempts low-probability ads as an explicit fallback when no safe ad exists.

**Warning signs:**
Games end in very few turns with low score; logs show the bot selecting `Suicide mission`/`Impossible` ads; lives drop in a straight line with no healing; high variance in final score across runs.

**Phase to address:**
Strategy phase (probability gating + EV ranking + heal-before-risk rule).

---

### Pitfall 5: Infinite loop when no solvable ad exists

**What goes wrong:**
The play loop is `while (lives > 0) { pickAd(); solve(); }`. If every available ad is below the bot's acceptable-probability threshold (and the heal/shop path can't change that — e.g. no gold, or shop has no useful item), `pickAd()` returns nothing, no turn is consumed, lives never change, and the loop spins forever (or hammers the API). Empty/short message lists trigger the same hang. The CardoEggert bot guards this with a hard `timeToLive = 200` iteration cap — evidence the hang is a real, encountered failure.

**Why it happens:**
The loop's only exit condition is `lives === 0`, but there are states where lives don't decrease and no progress is made. Developers test against games that always have a safe ad and never hit the degenerate state.

**How to avoid:**
Two independent guards: (1) a hard max-turn / max-iteration cap that terminates with the current score; (2) a "no progress" detector — if a loop pass consumes no turn (no solve, no purchase), break and report. Always have a defined fallback when no safe ad exists (attempt the *least bad* ad, which at least consumes a turn and changes state), and define behavior for an empty message list (re-fetch once, then terminate gracefully).

**Warning signs:**
The CLI never prints a final score / never exits; CPU pegged; API call rate spikes; logs repeat the same turn with unchanged lives/gold; tests that feed an "all-risky" or empty board hang instead of returning.

**Phase to address:**
Game-loop phase (loop guards + termination); strategy phase (defined fallback for no-safe-ad).

---

### Pitfall 6: Misranking probability — string-equality fragility & mis-calibration

**What goes wrong:**
Strategy compares probability via brittle string checks. Failure modes: (a) exact-string maps that miss the literal `"Hmmm...."` (four dots — easy to type three or trailing-space variants); (b) treating the labels as accurate probabilities when they're not — one working bot found `Gamble` is ~50/50 (not "better than half") and `Hmmm....` ~60% (not ~78%), so an EV calc using face-value percentages over-attempts those tiers; (c) a partially-built map silently returning `undefined`/`null` for an unmapped label, which then sorts as 0 or NaN and either drops the ad or corrupts the ranking.

**Why it happens:**
The labels read like English idioms and developers eyeball an ordering; the four-dot `Hmmm....` and the gap between label and true odds aren't obvious without empirical testing.

**How to avoid:**
Define the full ordered label set as a single typed map (TS `as const` / enum) so an unknown label is a compile-time or explicit-runtime error, not a silent 0. Copy the labels verbatim including `"Hmmm...."`. Treat the map as a **rank**, not a calibrated percentage; if you do EV math, use conservative tier weights and gate on tier rather than trusting exact percentages. Unit-test every label maps to a value and an unknown label throws/logs.

**Warning signs:**
A probability label appears in raw API logs but never in ranked-selection logs (it's mapping to null); the bot over-attempts `Gamble`/`Hmmm....` and fails often; ranking flips unexpectedly when a new label appears mid-game.

**Phase to address:**
Strategy phase (probability model). Lock the label set in the ad-model/parsing phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Concatenate adId into URL without `encodeURIComponent` | Less code | Breaks on encrypted/decoded ids with `/ + =` → 404s | Never — one-liner to fix |
| Skip the `encrypted` flag ("out of scope") | Faster MVP | Silently drops high-reward ads, lowers score, looks like a strategy bug | Only if you log every skip loudly; base64/ROT13 are trivial — handle them |
| Cache message board across turns to cut API calls | Fewer requests | Stale `expiresIn`, solving expired ads, race conditions | Never for selection — always re-fetch after a turn-consuming action |
| Use face-value probability percentages in EV math | Simple formula | Over-attempts mis-calibrated tiers (`Gamble`, `Hmmm....`) | OK if you use conservative weights and gate on tier first |
| Hard-code base URL with trailing-slash assumptions | Works once | `www` vs no-`www`, leading-`/` route producing `//path` — observed to differ between solutions | Centralize URL building; never duplicate the base string |
| No max-turn cap on the loop | Less code | Infinite spin / API hammering in degenerate states | Never — always cap |
| Parse JSON by field *count* (e.g. `length === 7`) | Quick guard | Breaks the instant the API adds/removes a field | Never — match by key, not count (CardoEggert does this; it's fragile) |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `POST /game/start` | Sending it as GET; assuming a body is required | POST with empty body; capture `gameId` exactly as returned (don't trim/normalize) |
| `GET /{gameId}/messages` | Assuming always a non-empty array; assuming `reward` is a number | Handle empty list and single-object responses; coerce `reward` (it can arrive as a string) before arithmetic |
| `POST /{gameId}/solve/{adId}` | Treating any 2xx as success; ignoring the `success` boolean | Read the `success` field in the body; lives can drop on `success: false`; always read the returned `lives/gold/score/turn` as the new source of truth |
| `POST /{gameId}/shop/buy/{itemId}` | Confusing shop **item `id`** with the ad **`adId`**; buying before re-checking gold | Use the shop's own `id` field; re-fetch state after purchase; verify the buy succeeded (`shoppingSuccess`/returned gold) |
| `encrypted` field | Decoding only `message`, leaving `adId`/`probability` encoded | Decode all three fields together based on the flag value |
| HTTP transport | No timeout / no retry → bot hangs or crashes on a transient 5xx or network blip | Per-request timeout + bounded retry with backoff on 5xx/network; treat repeated failure as clean termination, not a crash (PROJECT.md requires graceful handling) |
| Rate / request volume | Re-fetching shop + messages on every micro-step; no pacing | Re-fetch only after turn-consuming actions; consider a small inter-request delay; do not busy-loop |
| Base URL | `www.` vs no-`www`, trailing slash + leading-slash route → `//` | Pick one canonical base, build paths through one helper, test the resulting URL string |

## Performance Traps

This is a single-game, single-user CLI — classic "scale" is irrelevant. The real traps are about turns and API calls, not throughput.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Premature EV-math optimization (search/lookahead, learning across games) | Lots of strategy code, hard to test, marginal score gain | Ship the simple gated-EV heuristic first; PROJECT.md explicitly caps ambition at a readable heuristic | Whenever effort exceeds a sortable list — it's over-engineering by design constraint |
| Over-fetching (shop/messages every iteration even when no turn consumed) | Slow run, high request count, possible throttling | Fetch only after solve/buy; cache within a single turn only | Long games (hundreds of turns) make redundant calls add up |
| Re-deriving the whole strategy on a cached stale board | Solving expired ads | Re-fetch per turn (see Pitfall 3) | Any game where ads churn quickly |

## Security Mistakes

Low-stakes domain (a public game API, no auth, no secrets). Domain-specific notes only:

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging the entire raw API response object every turn | Noisy logs bury the decision narrative; can dump large message arrays | Log a summarized, human-readable line per decision; full objects only at DEBUG level |
| `atob`/base64-decoding untrusted ad fields without validation | Garbage strings, exceptions, or mis-decoded ids used in URLs | Validate against a base64 regex before decoding; fall back to as-is + warn (renee-saks pattern) |
| Treating `gameId` as a trusted path component without encoding | Malformed URL if gameId ever contains odd chars | `encodeURIComponent` all path segments uniformly |

## UX Pitfalls

"UX" here is the console output a reviewer reads. PROJECT.md requires human-readable, leveled logging and a clear final score.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Too noisy — full JSON dumped every turn | Reviewer can't follow the bot's reasoning | One concise INFO line per decision: turn, chosen ad, probability, reward, why; raw data at DEBUG |
| Too quiet — only prints final score | Can't tell *why* the bot did well/poorly; can't debug a bad run | Narrate each decision and its outcome (success/fail, lives/gold delta) |
| Wrong log levels — errors at INFO, decisions at ERROR | Real failures hidden; log filtering useless | INFO = decisions/outcomes; WARN = skipped/unrecognized ads, retries; ERROR = transport failures / termination |
| No clear final-score summary | Reviewer hunts through scrollback for the result | Print a distinct end-of-game block: final score, turns played, reason for end (lives=0 / cap hit) |
| `console.log` string-soup with no structure | Hard to scan, impossible to grep by level | Use leveled logging (even a thin wrapper over console) with consistent prefixes |
| Logging decoded ad content but not flagging it was encrypted | Reviewer confused why some ads look different | Tag encrypted ads in the log (e.g. `[decoded:base64]`) |

## TDD / Testing Pitfalls (domain-specific)

| Pitfall | Why it bites here | Better Approach |
|---------|-------------------|------------------|
| Testing against the live API | Flaky (network), slow, non-deterministic (random outcomes), pollutes real games; PROJECT.md forbids it | Define a mockable API-client seam (interface) injected into the game loop; unit tests use a fake client returning canned responses |
| No clear client seam — `fetch`/HTTP called inline in strategy | Can't test strategy without network; can't fake encrypted ads, empty boards, errors | Strategy and loop depend on an `ApiClient` interface, never on `fetch` directly |
| Non-deterministic strategy / randomness without a seam | The *game* is random (solves can fail), but your *selection* must be deterministic to test; if you add any randomness (tie-breaking), tests flake | Make selection a pure function of (ads, state); if randomness is needed, inject the RNG/seed so tests pin it |
| Over-mocking | Mocking internal pure functions (probability map, EV calc) tests the mock, not behavior | Mock only the API boundary; test pure strategy functions directly with real inputs |
| Asserting on log strings | Brittle — wording changes break tests; couples tests to UX copy | Assert on the *decision* (which adId was chosen, whether buy happened, final state), not on logged text |
| Not testing the degenerate cases | Hangs/crashes ship undetected | Add tests: empty message list, all-risky board (forces fallback/termination), encrypted ad (decode + solve), API error (graceful handling), loop cap reached |
| Testing the loop with a client that never ends the game | Infinite test hang | Fake client that decrements lives / returns game-over, plus an iteration cap, so the loop provably terminates |

## "Looks Done But Isn't" Checklist

- [ ] **Encrypted ads:** Often only `message` decoded — verify `adId` and `probability` are decoded too, and the decoded adId is what gets POSTed to `/solve/`.
- [ ] **adId in URL:** Often raw-concatenated — verify `encodeURIComponent` covers a `/`-containing id (test it).
- [ ] **Loop termination:** Often only exits on `lives === 0` — verify it also exits on max-turns and on no-progress, and that the CLI actually prints a final score and returns.
- [ ] **`expiresIn`:** Often ignored or raced — verify messages are re-fetched each turn and selection doesn't use a stale board.
- [ ] **Risk gating:** Often "max reward" — verify the bot never attempts `Impossible`/`Suicide mission` and heals before risky moves.
- [ ] **`success` field on solve:** Often inferred from HTTP 200 — verify the body's `success` boolean and the returned state are used as truth.
- [ ] **Empty / single-object responses:** Often assumes a non-empty array — verify empty `messages` and single-object shapes don't crash.
- [ ] **`reward` type:** Sometimes a string in JSON — verify arithmetic coerces it.
- [ ] **API errors:** Often crashes on first 5xx/timeout — verify timeout + bounded retry + graceful termination (no stack-trace exit).
- [ ] **Final-score summary:** Often buried — verify a distinct end block with score, turns, and end reason.
- [ ] **Tests are offline:** Verify the suite runs with no network and is deterministic across runs.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Encrypted ads silently dropped | LOW | Add decode step in the parse layer; add unit test with `encrypted: 1` and `2`; re-run |
| adId not URL-encoded | LOW | Route all URL building through one helper with `encodeURIComponent`; add `/`-in-id test |
| Infinite loop in production | LOW-MEDIUM | Add max-turn cap + no-progress guard to the loop; add a degenerate-board test that must terminate |
| Stale board / ignored `expiresIn` | LOW | Move re-fetch to after every turn-consuming action; demote `expiresIn` to tiebreaker |
| Strategy attempts suicide ads | LOW | Add probability gate + heal-before-risk before EV ranking; unit-test selection on a mixed board |
| Mis-calibrated probability weights | LOW | Treat map as rank, gate on tier; tune weights conservatively (don't trust face-value %) |
| Tests coupled to live API / log strings | MEDIUM | Introduce ApiClient interface seam; rewrite tests to fake the client and assert on decisions, not logs |

## Pitfall-to-Phase Mapping

Suggested phases: **(P1) API client & ad model** → **(P2) Strategy / decision logic** → **(P3) Game loop & shop integration** → **(P4) Logging & CLI output**. TDD applies across all; the client seam must exist from P1 so P2+ are testable offline.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Encrypted-ad field decoding (1) | P1 (API client / ad model) | Unit test: `encrypted:1` and `:2` ads decode all three fields; decoded adId solves |
| adId not URL-safe (2) | P1 (URL building in client) | Unit test: adId with `/ + =` produces a correctly-encoded URL |
| Ignoring `expiresIn` decay (3) | P3 loop (fresh fetch) + P2 (tiebreaker) | Test: board re-fetched after each turn; selection ignores stale list; `expiresIn<=0` dropped |
| Suicide/Impossible & no healing (4) | P2 (gating + heal rule) | Test: never selects `Impossible`/`Suicide mission`; heals when `lives<=threshold` |
| Infinite loop / no solvable ad (5) | P3 (loop guards) + P2 (fallback) | Test: all-risky and empty boards terminate; CLI prints final score and exits |
| Probability misranking / mis-calibration (6) | P2 (typed probability model) | Test: full label set incl. `"Hmmm...."` maps; unknown label throws/logs; rank order correct |
| Over-noisy / wrong-level logging | P4 (logging) | Inspect output: one decision line per turn at INFO, raw at DEBUG, distinct final block |
| Live-API / log-string-coupled tests | P1+ (client seam) | Suite runs offline, deterministic; assertions target decisions/state, not log text |
| Over-engineered strategy | P2 (keep-it-simple gate) | Strategy is a pure, sortable, readable function; no search/learning/optimizer (per PROJECT.md scope) |
| Transport error crashes | P1 (client) + P3 (loop) | Test: 5xx/timeout → bounded retry then graceful termination, no crash |

## Sources

- `renee-saks/dragons-of-mugloar` (GitHub, TypeScript, updated 2025) — verified encrypted-ad handling: `parseTasks` decodes `adId`/`message`/`probability` for `encrypted` 1 (base64) and 2 (ROT13); `decodeBase64` regex-validates before `atob`; canonical 11-level `taskProbabilities` map (`Sure thing`…`Impossible`); EV selection `reward * taskProbabilities[probability]`; endpoint route helpers. HIGH confidence (working source).
- `CardoEggert/DragonsOfMugloarPlayer` (GitHub, Java) — verified probability label constants and real-world calibration notes (`Gamble` ~50/50, `Hmmm....` ~60% vs face value), `timeToLive = 200` infinite-loop guard, heal-before-risk and risky-as-fallback strategy, field-count-based JSON parsing (fragile), README note that 1000 points is not always reachable due to variance. HIGH confidence (working source + author notes).
- `jcarlosvale/dragonsOfMugloar` (GitHub, Java) — "sort by reward and expiration priority" strategy; corroborates reward+expiry ranking. MEDIUM (README-level).
- Official API doc `https://dragonsofmugloar.com/api/v2` / `dragonsofmugloar.com/doc/` — endpoint shapes corroborated via source; live page is JS-rendered and the API was not directly reachable from this environment (nginx 404 through sandbox). MEDIUM for live behavior, HIGH for shapes confirmed across two independent implementations.
- TDD/logging/simplicity pitfalls — general best practice applied to this domain (mockable client seam, deterministic pure strategy, leveled logging), aligned with PROJECT.md constraints. MEDIUM-HIGH.

---
*Pitfalls research for: Dragons of Mugloar autoplay bot (TypeScript / Node CLI, TDD)*
*Researched: 2026-06-08*
