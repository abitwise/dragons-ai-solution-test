# Phase 4: Logger, CLI & Live Smoke - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase completes the bot by adding the two remaining files plus the
narration that makes the brief's "human-readable, leveled logging" real, and
performing the one and only manual live smoke run:

- **`logger.ts`** — a concrete `ConsoleLogger` implementing the existing
  `Logger` interface (`debug/info/warn/error(message, ...args)` from
  `types.ts`), backed by **Pino + pino-pretty**.
- **`index.ts`** — the CLI composition root: the **only** place real
  `HttpApiClient` + `ConsoleLogger` are constructed and injected into
  `playGame`; reads verbosity config, prints the final-score block, owns the
  error catch, and sets the process exit code.
- **Narration enrichment in `runner.ts`** — adding/adjusting `logger.*` calls
  so each turn's decision and outcome is narrated at the right level (LOG-01).
  The runner still calls only the `Logger` **interface** — never `console`.
- A **manual live smoke run** against the real API (`npm start`) that completes
  a full game and prints the summary.

**In scope (LOG-01, LOG-02):**
- `logger.ts` (Pino-backed `ConsoleLogger`) + its unit-level coverage.
- `index.ts` composition root: dep construction, arg/env verbosity parsing,
  final-score block print, error catch, exit-code mapping.
- Enriching `runner.ts` narration to satisfy "INFO per decision, WARN for
  skips, ERROR for failures" with a DEBUG play-by-play tier.
- The manual live smoke run (the only live network call in the whole project).

**Out of scope (other phases / parked):**
- Any change to `strategy.ts` or `api.ts` — both are feature-complete and
  locked. `index.ts` wires `HttpApiClient`; it does not modify it.
- Changing the `playGame` **signature**, the loop **mechanics**, the termination
  guards, or the `END` reason taxonomy — all locked in Phase 3. Phase 4 only
  ADDS `logger.*` calls inside the existing loop and consumes the returned
  `GameReport`.
- Adding live-network calls to the automated test suite — tests stay 100%
  offline against `FakeApiClient`; the smoke run is manual.
- New gameplay capabilities (adaptive probability memory STRAT-07, reputation
  weighting STRAT-08, multi-game runs/stats RUN-01) — parked in REQUIREMENTS.md
  v2, not this phase.

</domain>

<decisions>
## Implementation Decisions

These resolve Phase 4's behavioral gray areas. Locked carry-forwards (already
decided by Phases 1–3 / success criteria / research) are listed afterward — do
not re-litigate.

### Logger implementation (LOG-01)
- **D-01: `logger.ts` wraps Pino + pino-pretty** behind the existing `Logger`
  interface. Both libs are already in `package.json` `dependencies`, and
  STACK.md / SUMMARY.md both chose them. This **supersedes the ARCHITECTURE.md
  sketch's "tiny console wrapper, no library needed"** note — the user
  explicitly chose Pino. The class is `ConsoleLogger` (the name ARCHITECTURE.md
  and Phase 3 CONTEXT already reference).
- **D-02: Adapt the call shape.** The `Logger` interface is
  `method(message: string, ...args: unknown[])`, but Pino's idiom is
  `method(mergingObject, message)`. `ConsoleLogger` must translate — e.g. fold
  the variadic `...args` into a single merge object (or pass through when one
  object arg is given) and call pino as `pino[level](obj, message)` — so the
  runner's existing calls like `logger.info("game started", { gameId, lives })`
  render as a readable line with the structured fields attached. (Exact
  folding mechanics = planner/Claude discretion.)
- **D-03: Always-pretty transport.** Because the console output IS this bot's
  interface (a take-home demo a reviewer reads), pino-pretty is **always on**,
  not NODE_ENV-gated to dev-only. (Claude's discretion on the exact pino-pretty
  options — colorize, timestamp/`translateTime`, `ignore: pid,hostname` for a
  clean line.)

### Turn narration / level taxonomy (LOG-01)
- **D-04: Phase 4 enriches `runner.ts`'s `logger.*` calls.** This is in-scope:
  the current runner logs only ~4 events (and "solved ad" at DEBUG), which does
  not satisfy success criterion #1. Phase 4 ADDS narration calls inside the
  existing, locked loop (no mechanics change). The runner keeps calling only the
  `Logger` interface — never `console`, `pino`, or `pino-pretty` directly.
- **D-05: Level taxonomy (locked by PITFALLS.md, confirmed here):**
  - **INFO** = decisions & outcomes — the chosen ad and its solve result
    (success/fail with lives/gold/score deltas), each shop buy, the start line,
    and the guard/game-over stop line.
  - **WARN** = skips / nothing-to-do — no eligible ad / empty board (the D-14
    no-progress path), skipped still-encrypted/unhandled ads, a
    `shoppingSuccess:false` buy.
  - **ERROR** = failures — a thrown `Transport/BoundaryError`, logged in
    context (the runner MAY `logger.error` before the error unwinds per Phase 3
    D-11; the authoritative catch lives in `index.ts`).
  - **DEBUG** = the **verbose play-by-play** — the candidate ads considered and
    their EV ranking each turn, the shop catalog seen, fetch boundaries, and any
    full/raw API response objects (PITFALLS: never dump raw arrays above DEBUG).
- **D-06: Verbose-but-scannable.** The user chose "verbose play-by-play" AND
  placed it at **DEBUG** (not INFO). So a **default (`info`) run stays scannable**
  — one readable line per decision/outcome/skip — while `LOG_LEVEL=debug` (or
  `--verbose`) reveals the full reasoning (candidate ads + ranking, catalog,
  fetch boundaries). INFO must not bury the decision narrative.

### Final-score block & exit codes (LOG-02)
- **D-07: Distinct, always-visible final-score block.** `index.ts` prints a
  visually distinct summary block (e.g. a bordered/banner `FINAL SCORE` with
  score / turns / end reason) to **stdout directly (not through pino)**, so it is
  **always visible regardless of log level** — even at `LOG_LEVEL=warn` or buried
  under a wall of debug output. It is separate from the leveled narration, not
  just another `logger.info` line. (Exact banner art/format = Claude's
  discretion.)
- **D-08: 3-way exit-code split.** `index.ts` maps the run outcome to an exit
  code: **`0` = `GAME_OVER`** (lives reached 0 — the natural end), **`1` = guard
  stop** (`TURN_CAP` or `NO_PROGRESS` — graceful but abnormal), **`2` = a thrown
  `Transport/BoundaryError`** (the run crashed out). This refines Phase 3 D-08's
  "GAME_OVER→0, others→non-zero" into a three-bucket contract a script/CI can
  branch on. `index.ts` maps the three `END` reason strings (D-08 closed
  vocabulary) → 0/1, and the catch path → 2.
- **D-09: `index.ts` owns the error path** (Phase 3 D-11). It is the single
  `try/catch` around `await playGame(...)`: on a thrown typed error it prints a
  clear failure message + (D-07-style) outcome line and exits **2**; on a normal
  return it prints the final-score block and exits **0/1** per D-08. `playGame`
  itself still never catches (it rejects verbatim).

### CLI surface & verbosity (LOG-02)
- **D-10: Verbosity via env var + flag, default `info`.** `index.ts` resolves
  the log level from BOTH a `LOG_LEVEL` env var AND a `--verbose`/`-v` flag
  (parsed via built-in `node:util` `parseArgs` — the legitimate first real flag
  per CLAUDE.md; `--log-level <lvl>` and `--help` are reasonable companions).
  Default level is **`info`**. **Precedence: explicit flag > `LOG_LEVEL` env >
  default `info`** (`--verbose` resolves to `debug`). The resolved level is
  passed into `ConsoleLogger` / the pino instance at construction.
- **D-11: No positional args.** The bot takes no positional arguments — it just
  starts a game and plays. The only inputs are the optional verbosity flag/env
  and the existing `MUGLOAR_BASE_URL` env (read in `api.ts`, default non-`www`).
- **D-12: Live smoke = `npm start`.** The manual live smoke run (success
  criterion #4) is simply `npm start` (already `tsx src/index.ts`) against the
  real API — completes a full game and prints the final-score block. No new
  script needed; `LOG_LEVEL=debug npm start` exercises the play-by-play. This is
  the ONLY live network call in the project; the automated suite stays offline.

### Claude's Discretion
The user accepted recommendations / said "you decide" on the mechanics below —
defaults encoded above:
- pino-pretty options (colorize, `translateTime`, `ignore: pid,hostname`) and the
  exact `...args`→merge-object folding in `ConsoleLogger` (D-02/D-03).
- The exact visual format of the final-score block (border style, wording) and
  the failure message wording (D-07/D-09).
- The exact flag set/aliases (`--verbose`/`-v`, `--log-level`, `--help`) and
  `parseArgs` config, as long as flag > env > `info` precedence holds (D-10).
- Whether the runner emits `logger.error` itself before an error unwinds, vs
  letting `index.ts`'s catch be the sole error logger (Phase 3 D-11 allows
  either; D-09 makes `index.ts` authoritative regardless).
- Whether `index.ts` carries a `#!/usr/bin/env node` shebang / `bin` entry (the
  brief is run-locally; a shebang is harmless but optional — SUMMARY.md mentions
  it).

## Locked Carry-Forwards (already decided — do NOT re-ask)

From success criteria, PROJECT.md, research docs, and Phases 1–3 CONTEXT/code:
- **File layout & composition root:** `logger.ts` (the `Logger` impl) and
  `index.ts` (the CLI entrypoint / composition root) are the two files this
  phase adds; `index.ts` is the **only** place real `HttpApiClient` +
  `ConsoleLogger` are constructed and injected (ARCHITECTURE.md / Phase 1).
  Six flat files under `src/`, manual DI, ESM.
- **Interfaces already exist in `types.ts`:** `Logger`
  (`debug/info/warn/error(message, ...args): void`) and `GameReport`
  (`{ score, turns, reason }`). Phase 4 implements/consumes them; it does not
  change them.
- **`playGame(api, logger)` is locked** (Phase 3). The loop mechanics, the two
  termination guards, and the `END` reason vocabulary (`GAME_OVER` /
  `TURN_CAP` / `NO_PROGRESS`, exactly three) are fixed. Phase 4 only ADDS
  `logger.*` calls inside it and reads the returned `GameReport`.
- **Error/retry behavior is fixed in `api.ts`** (Phase 1): reads retry ~3×,
  `solve`/`buy` never retry; `TransportError` vs `BoundaryError`. The runner
  adds no retry/catch; `index.ts` owns the single catch (Phase 3 D-11).
- **Base URL:** default non-`www` (`https://dragonsofmugloar.com/api/v2`),
  overridable via `MUGLOAR_BASE_URL`, read once in `api.ts` — `www.` returned
  nginx 404s in live testing (STATE.md blocker / SUMMARY.md).
- **Stack:** Node 24 LTS / TS 5.9 / tsx / native `fetch` / Vitest / **Pino 10 +
  pino-pretty 13** / Biome; `tsc --noEmit` for type-checking.
- **Scoring context (informational, not a gate):** the well-known target is
  score ≥ 1000; the game ends at `lives === 0`; there is no hard "win".

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & scope
- `.planning/ROADMAP.md` § "Phase 4: Logger, CLI & Live Smoke" — the goal and
  the **4 success criteria** this phase is judged against.
- `.planning/REQUIREMENTS.md` § "Logging & Output" (LOG-01, LOG-02) — the exact
  requirements this phase implements.
- `.planning/PROJECT.md` — Core Value, the "human-readable, leveled logging"
  constraint, and the "keep it simple" ceiling.

### Logging behavior & UX (HIGH value — read before coding the logger/narration)
- `.planning/research/PITFALLS.md` § "Logging / output UX" — **locks the level
  taxonomy** (INFO=decisions/outcomes, WARN=skips/unrecognized/retries,
  ERROR=transport failures/termination, raw objects only at DEBUG) and the
  too-noisy / too-quiet / wrong-level anti-patterns (D-05/D-06).
- `.planning/research/STACK.md` — the Pino + pino-pretty rows and the explicit
  "tiny custom console logger" alternative the user rejected (D-01); ESM/tsx
  `start`/`dev` scripts.
- `.planning/research/SUMMARY.md` § "Phase 4: Logger, CLI Entry, and Live Smoke"
  — `logger.ts` (leveled Pino wrapper), `index.ts` (composition root with
  shebang, minimal flag parsing, `GameReport` print, exit code), and the
  manual-smoke-run-is-the-only-live-call note.

### Architecture & the seam (the contracts Phase 4 composes)
- `.planning/research/ARCHITECTURE.md` — the six-file layout; the `logger.ts`
  and `index.ts` rows (composition root constructs `HttpApiClient` +
  `ConsoleLogger`, calls `playGame`, prints report, sets exit code); dependency
  direction (everything points inward). NOTE: its "tiny console wrapper, no
  library" line for `logger.ts` is **superseded by D-01** (Pino chosen).
- `src/types.ts` — the `Logger` interface (the exact method signatures
  `logger.ts` implements) and `GameReport` (`{ score, turns, reason }`,
  what `index.ts` prints / maps to exit codes).
- `src/runner.ts` — `playGame(api, logger)` and the existing (sparse) `logger.*`
  call sites Phase 4 enriches; the `END` reason constants
  (`GAME_OVER`/`TURN_CAP`/`NO_PROGRESS`) `index.ts` maps to exit codes (D-08).
- `src/api.ts` — `HttpApiClient` (what `index.ts` constructs) and the
  `TransportError` / `BoundaryError` classes `index.ts`'s catch handles → exit 2
  (D-08/D-09).

### Prior decisions Phase 4 depends on
- `.planning/phases/03-game-loop-shop-integration/03-CONTEXT.md` — esp. D-08
  (the closed three-reason `END` vocabulary → exit-code mapping), D-10/D-11
  (no `API_ERROR` reason; errors propagate; `index.ts` owns the catch), and the
  "logging rendering / final-score printing / exit codes / live smoke = Phase 4"
  hand-off.
- `.planning/phases/01-foundation-types-api-client-test-seam/01-CONTEXT.md` —
  the base-URL config surface (non-`www` default, `MUGLOAR_BASE_URL`) and the
  retry/error taxonomy `index.ts` relies on but must not duplicate.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (exist; Phase 4 consumes/wires, does not reinvent)
- **`src/types.ts`** — `Logger` interface (`debug/info/warn/error(message,
  ...args)`) and `GameReport` (`{score, turns, reason}`) already declared. No new
  shared types needed (an internal exit-code map in `index.ts` is local).
- **`src/runner.ts`** — `playGame(api, logger)` is complete and locked; it
  already threads state and returns a `GameReport`. It currently emits
  `logger.info("game started", …)`, `logger.debug("solved ad", …)`,
  `logger.info("game stopped by guard", report)`, `logger.info("game over",
  report)`. Phase 4 enriches these (promote solve to INFO, add per-ad-choice,
  shop-buy, and skip/WARN lines, add the DEBUG play-by-play) — see D-04/D-05/D-06.
- **`src/api.ts`** — `HttpApiClient` (the only `fetch` caller) + `TransportError`
  / `BoundaryError`. `index.ts` constructs `HttpApiClient` and catches these two
  classes (D-09). Base URL via `MUGLOAR_BASE_URL`, read in `api.ts`.
- **`package.json`** — `pino@^10`, `pino-pretty@^13`, `zod@^4` already in
  `dependencies`; `start`/`dev` scripts already run `tsx src/index.ts`. Node 24
  / `node:util parseArgs` available for D-10.

### Established Patterns (honor these)
- **Functional core / imperative shell** — `logger.ts` and `index.ts` are part
  of the shell. `index.ts` is the sole composition root; `logger.ts` depends on
  pino but exposes only the `Logger` interface to the rest of the app.
- **Depend on interfaces, never impls** — the runner depends on `Logger`, never
  `console`/`pino`. Only `logger.ts` touches pino; only `api.ts` touches `fetch`;
  only `index.ts` constructs the real pair.
- **Tests offline** — `runner.test.ts` already passes a silent/spy logger; new
  `logger.ts` coverage must not require a network and the suite stays at zero
  live calls (the live smoke is manual, D-12).

### Integration Points
- **`index.ts → api.ts`** — constructs `HttpApiClient` (the real `ApiClient`).
- **`index.ts → logger.ts`** — constructs `ConsoleLogger` at the resolved level
  (D-10) and injects it into `playGame`.
- **`index.ts → runner.ts`** — `await playGame(api, logger)`; prints the
  final-score block (D-07), maps `GameReport.reason` → exit code (D-08), catches
  thrown errors → exit 2 (D-09).
- **`logger.ts → pino/pino-pretty`** — the only module importing them.
- **`runner.ts → Logger` interface** — Phase 4 adds the narration calls here.

### A subtlety to honor
- The `Logger` interface puts the **message first** (`info(message, ...args)`)
  while pino puts the **merge object first** (`info(obj, msg)`). `ConsoleLogger`
  must bridge this (D-02) so existing call sites like
  `logger.info("game started", { gameId, lives })` render correctly — do not
  change the interface or the runner's call ordering to match pino.

</code_context>

<specifics>
## Specific Ideas

- The final-score block should read like a deliberate report, not log noise —
  a bordered `FINAL SCORE` banner with `score`, `turns`, and the human end
  reason (the `END` string), printed to stdout so it survives any log level
  (D-07).
- `LOG_LEVEL=debug npm start` is the intended way to watch the full
  play-by-play (candidate ads + EV ranking, shop catalog, fetch boundaries)
  during the live smoke run; default `npm start` shows the scannable
  one-line-per-decision INFO narrative (D-06/D-12).
- Exit codes are a real contract: `0` natural game-over, `1` guard stop, `2`
  crashed-out error — worth a one-line comment in `index.ts` so the mapping is
  self-documenting (D-08).
- `logger.ts` coverage can assert the level→method routing and the
  message+args→pino call shape with a spy/stub (no network), keeping TEST-01's
  "offline only" guarantee intact.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 4 scope. Multi-game runs with
stats aggregation (RUN-01), adaptive probability memory (STRAT-07), and
reputation weighting (STRAT-08) remain parked in REQUIREMENTS.md v2, out of
scope for v1. A `bin` entry / global install is optional polish noted under
Claude's discretion, not a deferral.

</deferred>

---

*Phase: 4-Logger, CLI & Live Smoke*
*Context gathered: 2026-06-10*
