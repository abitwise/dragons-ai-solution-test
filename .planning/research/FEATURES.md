# Feature Research

**Domain:** Game-playing autopilot bot (TypeScript CLI) for the Dragons of Mugloar v2 HTTP API
**Researched:** 2026-06-09
**Confidence:** HIGH (API surface, fields, probability strings, shop items, and encryption all verified live against the production API on 2026-06-09; effect semantics confirmed empirically by playing real games)

---

## Verified API Surface

Base URL: `https://dragonsofmugloar.com/api/v2`

> NOTE (verified 2026-06-09): from this network, the bare host `dragonsofmugloar.com`
> answered correctly while `www.dragonsofmugloar.com` returned nginx 404s. Treat the base
> URL as configurable and default to the non-`www` host. All endpoints below were exercised
> live.

| # | Method | Path | Purpose | Confidence |
|---|--------|------|---------|------------|
| 1 | POST | `/game/start` | Start a new game | HIGH (live) |
| 2 | GET | `/{gameId}/messages` | List current ads/quests | HIGH (live) |
| 3 | POST | `/{gameId}/solve/{adId}` | Attempt to solve an ad | HIGH (live) |
| 4 | GET | `/{gameId}/shop` | List shop items | HIGH (live) |
| 5 | POST | `/{gameId}/shop/buy/{itemId}` | Buy a shop item | HIGH (live) |
| 6 | POST | `/{gameId}/investigate/reputation` | Get reputation (`people`/`state`/`underworld`) | HIGH (live) |

All bodies are JSON; no request body or auth required. `solve` with an unknown `adId`
returns **HTTP 400 Bad Request** (plain HTML body, not JSON) — error handling must not assume
JSON on non-2xx.

### Response field reference (exact names — verified live)

**`POST /game/start`** and the game-info object the bot threads through turns:
```
gameId: string   lives: number   gold: number   level: number
score: number    highScore: number   turn: number
```
Initial values observed: `lives:3, gold:0, level:0, score:0, highScore:0, turn:0`.

**`GET /{gameId}/messages`** → array of ad objects:
```
adId: string        message: string     reward: number (gold)
expiresIn: number   encrypted: number | null   probability: string
```
`expiresIn` is a countdown in turns; it decrements each turn and the ad disappears at 0.
`encrypted` is `null` for plaintext ads, otherwise `1` or `2` (see Encryption below).

**`POST /{gameId}/solve/{adId}`** → solve result:
```
success: boolean   lives: number   gold: number   score: number
highScore: number  turn: number     message: string
```
On success, `gold` and `score` increase by ~the ad reward; on failure, `lives` decreases.
Every solve attempt (success or fail) consumes one `turn` and decrements all ads' `expiresIn`.

**`GET /{gameId}/shop`** → array of items: `{ id: string, name: string, cost: number }`.

**`POST /{gameId}/shop/buy/{itemId}`** → buy result:
```
shoppingSuccess: boolean   gold: number   lives: number
level: number              turn: number
```
NOTE: buy result has **no** `score`/`highScore`; it returns `level` (which `solve` does not).
A purchase also **consumes a turn**. A buy with insufficient gold returns
`shoppingSuccess:false` and leaves state unchanged (no error).

**`POST /{gameId}/investigate/reputation`** → `{ people: number, state: number, underworld: number }`.

### Probability strings → success likelihood (verified list, ordered best→worst)

The `probability` field is descriptive text. Full enumeration confirmed from the live API and
two independent public implementations. Map to a numeric rank for the heuristic:

| Rank (higher = safer) | Probability string | Approx. success | Notes |
|---|---|---|---|
| 10 | `Sure thing` | ~95–100% | Safest |
| 9 | `Piece of cake` | ~90% | |
| 8 | `Walk in the park` | ~80% | |
| 7 | `Quite likely` | ~75% | |
| 6 | `Hmmm....` | ~55–60% | Note the trailing dots and 4 m's — match exact string |
| 5 | `Gamble` | ~45–50% | Real-world closer to coin-flip than the name implies |
| 4 | `Risky` | ~35% | |
| 3 | `Rather detrimental` | ~15–25% | |
| 2 | `Playing with fire` | ~10% | |
| 1 | `Suicide mission` | ~5% | |
| 0 | `Impossible` | <5% | |

Confidence: HIGH that this is the complete set and ordering. The exact percentages are
MEDIUM (community estimates; the API never returns a numeric probability). For a simple bot,
only the **ordering** matters — implement it as an explicit lookup map keyed by the exact
string, with an unknown string treated as "worst/skip" so a new label can't crash the bot.

### Encryption (verified live — both variants captured and decoded)

When `encrypted` is non-null, **all three string fields** (`adId`, `message`, `probability`)
are encoded with the same scheme; you must decode `adId` and `probability` to act on the ad,
and decode `message` only for logging.

| `encrypted` value | Scheme | Decode |
|---|---|---|
| `1` | Base64 | `Buffer.from(s, "base64").toString("utf-8")` |
| `2` | ROT13 | rotate letters by 13 (`a↔n … z↔m`, case-preserved, non-letters untouched) |

Verified examples captured 2026-06-09:
- `encrypted:1`, message `SW5maWx0cmF0ZSBUaGUgSmFja2Fscy4uLg==` → `Infiltrate The Jackals...`; probability `UmF0aGVyIGRldHJpbWVudGFs` → `Rather detrimental`.
- `encrypted:2`, message `Xvyy Frssben Cnefbaf...` → `Kill Seffora Parsons...`; probability `Fhvpvqr zvffvba` → `Suicide mission`.

Important: a public Java solution documents that submitting the **raw (still-encoded)** `adId`
to `/solve` yields HTTP 400 — so you must either decode the `adId` before solving, or skip
encrypted ads entirely. Both are valid; see the Differentiators / Anti-Features split below.

### Win / loss condition (verified + community consensus)

- **Loss:** game ends when `lives` reaches `0`. There is **no explicit "win"**; the game has
  no hard end other than death. The bot should also self-cap with a max-turns guard so a buggy
  loop can never run forever.
- **Objective:** maximize final `score` (reputation) before death. The well-known target this
  take-home is graded against is **score ≥ 1000** (MEDIUM-HIGH confidence: stated explicitly in
  multiple public solution repos, e.g. jcarlosvale/dragonsOfMugloar). `level` rises as you buy
  upgrades and unlocks higher-reward ads.

### Shop items (full live list — effects are not returned by the API)

Verified live catalog. The API only returns `id/name/cost`; **effects are not documented in
the response** and were inferred empirically + from community lore:

| id | name | cost | Effect (inferred) |
|---|---|---|---|
| `hpot` | Healing potion | 50 | +1 life (the only survival item) |
| `cs` | Claw Sharpening | 100 | Upgrade → raises `level` (verified: 0→1), boosts win odds/rewards |
| `gas` | Gasoline | 100 | Upgrade (level boost) |
| `wax` | Copper Plating | 100 | Upgrade (level boost) |
| `tricks` | Book of Tricks | 100 | Upgrade (level boost) |
| `wingpot` | Potion of Stronger Wings | 100 | Upgrade (level boost) |
| `ch` | Claw Honing | 300 | Stronger upgrade |
| `rf` | Rocket Fuel | 300 | Stronger upgrade |
| `iron` | Iron Plating | 300 | Stronger upgrade |
| `mtrix` | Book of Megatricks | 300 | Stronger upgrade |
| `wingpotmax` | Potion of Awesome Wings | 300 | Stronger upgrade |

Empirically confirmed: buying `cs` for 100 gold returned `shoppingSuccess:true`, gold 150→50,
`level` 0→1, and ad rewards on the board increased afterward. Item `id`s appear stable, but the
bot should **look items up by `id` (preferring `hpot` for healing) from the live shop list**
rather than hardcoding — costs and the exact set could change.

---

## Feature Landscape

### Table Stakes (the bot cannot work without these)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Typed API client for all 5 core endpoints (start, messages, solve, shop, buy) | Nothing works without it | LOW | Thin `fetch` wrapper; inject it so tests use a mock |
| Game-state model threaded across turns (`lives/gold/score/level/turn/gameId`) | Every decision reads this | LOW | Update from each solve/buy response; buy lacks score, solve lacks level — merge carefully |
| Probability string → rank lookup map (exact-string keyed) | The whole heuristic depends on ordering | LOW | Unknown string → "worst", never throw |
| Main autoplay loop until `lives === 0` (+ max-turn safety cap) | "Autoplay to game-over, no human input" is the core value | LOW | Cap iterations so a bug can't loop forever |
| Ad-selection heuristic (safe + high reward) | Picking ads IS the product | MEDIUM | See heuristic below |
| Solve the chosen ad and apply the result | Score only grows by solving | LOW | Re-fetch messages after each solve (ad list changes) |
| Skip / filter ads the bot won't attempt | Encrypted-but-undecoded or `expiresIn === 0` ads cause 400s / waste turns | LOW | At minimum filter `encrypted != null` and expiring ads |
| Buy a Healing potion (`hpot`) when low on lives and affordable | Without healing, the bot dies fast and scores poorly | LOW | Look up `hpot` in live shop; threshold e.g. `lives < 3 && gold >= 50` |
| Graceful API/transport error handling | Live dependency; brief requires "no crash" | MEDIUM | Non-2xx may be HTML not JSON; bounded retry then clean exit |
| Human-readable, leveled turn-by-turn logging | Explicit brief requirement | LOW | Log each decision + outcome; print final score on exit |
| Report final score on game-over | Stated deliverable | LOW | One clear summary line |
| TDD unit tests against a mocked client | Explicit constraint | MEDIUM | Mock returns canned solve/buy/messages payloads |

### Differentiators (smarter play / nice-to-haves — keep a couple, skip the rest)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Decode encrypted ads (Base64 for `1`, ROT13 for `2`) | Unlocks more solvable ads → higher ceiling | LOW–MEDIUM | Decode `adId`+`probability` to act, `message` to log. Highest-ROI differentiator; both schemes are trivial |
| Buy `level`-raising upgrades when flush with gold | Higher level → higher-reward ads → faster to 1000 | MEDIUM | Only after a healing buffer is reserved (e.g. keep ≥100 gold / 2 potions). Each buy costs a turn |
| Expiry-aware selection (prefer/skip near-expiry ads) | Avoids wasting turns on ads about to vanish | LOW | Tie-break or filter on `expiresIn` |
| Reward-density / expected-value ranking (`reward × successRank`) | Better long-run score than naive "safest first" | LOW | Still a readable one-liner, not an optimizer |
| Adaptive probability memory (prefer labels that succeeded, avoid ones that failed) | Self-corrects when text labels mislead | MEDIUM | jcarlosvale does exactly this. Borderline over-engineering for v1 |
| Configurable thresholds (max lives to keep, heal trigger, save-for-upgrade floor) | Tunable without code edits | LOW | Plain constants/CLI flags |
| Multi-game run + score stats | Benchmarks strategy quality | MEDIUM | Out of scope for v1 per PROJECT.md; possible future toggle |

### Anti-Features (deliberately do NOT build — "keep it simple")

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| ML / search / Monte-Carlo strategy optimizer | "Maximize score" tempts optimization | Explicitly out of scope; huge complexity, opaque, hard to test, no probability data to train on | A readable rank-based heuristic clears the ~1000 bar |
| Brute-force probability calibration (statistical sampling of label→% across many games) | "Know the real win rates" | Needs many live games, slow/flaky tests, marginal benefit over fixed ordering | Hardcode the ordering; optionally adapt within a single game |
| Hardcoding shop item ids/costs/effects | Saves a GET call | Brittle if the catalog changes; effects aren't even returned | Read the live shop list; select by `id` (`hpot` for heal, cheapest/affordable for upgrades) |
| Decoding/handling exotic future `encrypted` values beyond 1 & 2 | "Be robust" | Speculative; only `1`/`2` exist | Skip any ad whose `encrypted` value isn't a known scheme |
| Persistent storage / DB of game history | "Track progress" | Out of scope; one in-memory run per CLI invocation | In-memory state only |
| Web UI / frontend | "See it play" | Backend CLI exercise; scope creep | Leveled console logging is the UI |
| Hitting the live API from the test suite | "Test the real thing" | Flaky, slow, non-deterministic, rate-pressure | Mocked client in unit tests; manual/live smoke run separate |
| Concurrency / parallel game solving | "Faster / higher score" | Adds race conditions and complexity for no scoring benefit (one game is sequential) | Single sequential loop |
| Aggressive retry storms on errors | "Resilience" | Can hammer the API and mask real failures | Small bounded retry (e.g. 3, backoff) then clean termination |

---

## Recommended Simple Heuristic (concrete enough to implement)

**Per-turn loop** (repeat while `lives > 0` and `turn < SAFETY_CAP`):

1. **Heal first if needed.** If `lives < MAX_LIVES_TO_KEEP` (e.g. 3) and `gold >= 50`,
   look up `hpot` in the live shop and buy it. (Healing buy consumes a turn.)
2. **Fetch + filter ads.** `GET /messages`. Drop ads with `expiresIn <= 0`. For encrypted ads:
   either decode them (differentiator) or drop any with `encrypted != null` (simplest).
   Also drop ads whose `probability` rank is below a floor (e.g. skip `Risky` and worse).
3. **Rank the survivors.** Compute `rank = probabilityRank[probability]`. Sort by
   `(rank desc, reward desc)` — i.e. safest first, highest reward as tie-break.
   (Optional EV variant: sort by `reward × rank` descending for a touch more aggression.)
4. **Solve the top ad.** `POST /solve/{adId}`; apply `success/lives/gold/score/turn` to state.
   If no eligible ad exists, fall back to the highest-reward survivor regardless of safety
   (or end the run if the board is empty).
5. **Spend surplus on upgrades (optional).** If `gold >= cheapest_upgrade (100)` AND a healing
   buffer remains (e.g. `gold - upgradeCost >= 2 × 50`), buy the most expensive affordable
   non-`hpot` item to raise `level`. Skip if you'd rather race to 1000 on rewards alone.
6. Repeat. On any unexpected API error: bounded retry, then log final score and exit cleanly.

Thresholds to expose as constants: `MAX_LIVES_TO_KEEP=3`, `HEAL_COST=50` (read live),
`PROBABILITY_FLOOR` (e.g. rank ≥ `Hmmm....`), `CHEAPEST_UPGRADE=100`, `SAFETY_CAP` (e.g. 1000 turns).

---

## Feature Dependencies

```
[Typed API client]
    └──requires──> (nothing; foundation)

[Game-state model] ──requires──> [Typed API client]

[Probability rank map]
    └──enables──> [Ad-selection heuristic]

[Ad-selection heuristic] ──requires──> [Game-state model] + [Probability rank map]
        └──requires──> [Ad filtering (expiry + encrypted skip)]

[Autoplay loop] ──requires──> [Ad-selection heuristic] + [Solve + apply result]

[Heal purchase] ──requires──> [Shop list read] + [Buy call] + [Game-state model]
[Upgrade purchase] ──requires──> [Heal purchase] (heal buffer must be reserved first)

[Decode encrypted ads] ──enhances──> [Ad filtering]  (decode instead of skip)
[EV ranking] ──enhances──> [Ad-selection heuristic]
[Adaptive prob memory] ──enhances──> [Ad-selection heuristic]

[TDD unit tests] ──requires──> [Mockable API client]  (inject the client)
[ML optimizer] ──conflicts──> ["keep it simple" constraint]  → do not build
```

### Dependency Notes

- **Heuristic requires the rank map and state:** you can't compare ads without an ordering or
  know affordability without `gold`.
- **Upgrade purchase depends on heal purchase:** never spend the gold that keeps you alive;
  reserve a potion buffer before buying upgrades.
- **Decode enhances (replaces) the encrypted-skip filter:** v1 can skip; v1.x can decode.
- **Tests require an injectable client:** design the client as a dependency from day one so the
  mock drops in without refactoring.

---

## MVP Definition

### Launch With (v1)

- [ ] Typed client for start / messages / solve / shop / buy — nothing works without it
- [ ] In-memory game-state model threaded across turns — every decision needs it
- [ ] Probability string → rank lookup (exact-string keyed, unknown = worst) — drives selection
- [ ] Ad filtering: drop `expiresIn <= 0` and `encrypted != null` — avoids wasted turns / 400s
- [ ] Heuristic: sort eligible ads by (safety desc, reward desc), solve the top — the core loop
- [ ] Heal: buy `hpot` when `lives < 3 && gold >= 50` — basic survival
- [ ] Autoplay loop to `lives === 0` with a max-turn safety cap — the headline deliverable
- [ ] Bounded retry + clean termination on API errors (handle non-JSON error bodies) — "no crash"
- [ ] Leveled, human-readable per-turn logging + final score line — explicit requirement
- [ ] TDD unit tests over the heuristic + state updates against a mocked client — explicit constraint

### Add After Validation (v1.x)

- [ ] Decode encrypted ads (Base64 / ROT13) — trigger: v1 reliably finishes games; this raises the ceiling
- [ ] Buy `level`-raising upgrades with surplus gold (heal buffer reserved) — trigger: bot survives but plateaus below ~1000
- [ ] EV ranking (`reward × rank`) and/or expiry-aware tie-break — trigger: want more score per game

### Future Consideration (v2+)

- [ ] Adaptive within-game probability memory — defer: borderline over-engineering vs "keep it simple"
- [ ] Multi-game runs + score stats aggregation — defer: out of scope per PROJECT.md
- [ ] Reputation-aware ad weighting via `/investigate/reputation` — defer: unclear payoff, adds API calls

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Typed API client | HIGH | LOW | P1 |
| Game-state model | HIGH | LOW | P1 |
| Probability rank map | HIGH | LOW | P1 |
| Ad filtering (expiry + encrypted skip) | HIGH | LOW | P1 |
| Ad-selection heuristic | HIGH | MEDIUM | P1 |
| Solve + apply result | HIGH | LOW | P1 |
| Heal purchase (`hpot`) | HIGH | LOW | P1 |
| Autoplay loop + safety cap | HIGH | LOW | P1 |
| Error handling / bounded retry | HIGH | MEDIUM | P1 |
| Leveled logging + final score | HIGH | LOW | P1 |
| TDD unit tests (mocked client) | HIGH | MEDIUM | P1 |
| Decode encrypted ads | MEDIUM | LOW | P2 |
| Upgrade purchasing | MEDIUM | MEDIUM | P2 |
| EV / expiry-aware ranking | MEDIUM | LOW | P2 |
| Adaptive probability memory | LOW | MEDIUM | P3 |
| Multi-game stats | LOW | MEDIUM | P3 |
| Reputation-aware weighting | LOW | MEDIUM | P3 |

**Priority key:** P1 = must have for launch · P2 = should have, add when possible · P3 = future.

---

## Competitor Feature Analysis (reference implementations)

| Feature | jcarlosvale (Java, targets 1000) | CardoEggert (Java) | Our Approach (TS, keep simple) |
|---------|----------------------------------|--------------------|-------------------------------|
| Ad selection | Sort by `expiresIn` then `reward`; adaptive preferred/avoid probability sets | Bucket by reputation-impact × success-rate, pick safest+richest, "suicide" fallback | Sort by (safety rank desc, reward desc); optional EV variant |
| Encrypted ads | **Skips** them (`encrypted != null` filtered out; notes raw adId → 400) | n/a | v1 skip; v1.x decode (Base64 `1`, ROT13 `2`) |
| Healing | Buys cheapest items when `lives < 3` until a life is gained | Buys `Healing potion` (50) while `lives < 3` and gold allows | Buy `hpot` when `lives < 3 && gold >= 50` |
| Upgrades | Buys affordable items to gain lives/level | Buys most expensive affordable item, but keeps ≥2 potions of gold in reserve | Optional v1.x: buy upgrade only if heal buffer preserved |
| Loop end | `while lives > 0` | `while alive && timeToLive > 0` (200-turn cap) | `while lives > 0 && turn < cap` |

---

## Sources

- Live production API, exercised 2026-06-09 (`https://dragonsofmugloar.com/api/v2`): start, messages, solve, shop, buy, investigate/reputation — all fields, the full probability-string set, the complete shop catalog, both encryption variants (decoded), the 400-on-bad-adId behavior, and the level-up-on-upgrade effect were observed directly. **Confidence: HIGH.**
- Official game / API doc landing: https://dragonsofmugloar.com/doc/ (client-rendered SPA; endpoint paths cross-checked against source below). **Confidence: MEDIUM** (page is JS-rendered).
- jcarlosvale/dragonsOfMugloar (Java, explicitly targets score ≥ 1000): endpoint paths, DTO field names, encrypted-ad skip + raw-adId-400 note, expiry/reward sort, adaptive probability memory. https://github.com/jcarlosvale/dragonsOfMugloar — **Confidence: HIGH** (matches live API exactly).
- CardoEggert/DragonsOfMugloarPlayer (Java): full probability-string enum and ordering, shop item name "Healing potion", thresholds (heal at lives<3, potion cost 50, cheapest upgrade 100, reserve gold), 200-turn safety cap. https://github.com/CardoEggert/DragonsOfMugloarPlayer — **Confidence: HIGH** (strings match live).
- vahurvar/dragons-of-mugloar (Java reference). https://github.com/vahurvar/dragons-of-mugloar — **Confidence: MEDIUM** (referenced for cross-checking).
- Approximate success percentages per probability label: community estimates only; the API never returns numeric odds. **Confidence: LOW/MEDIUM — only the ordering should be relied upon.**

---
*Feature research for: Dragons of Mugloar autoplay bot (TypeScript CLI)*
*Researched: 2026-06-09*
