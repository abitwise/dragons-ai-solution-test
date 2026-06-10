# Phase 4: Logger, CLI & Live Smoke - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 4-Logger, CLI & Live Smoke
**Areas discussed:** Logger backend, Turn narration, Final score + exit codes, CLI flags & verbosity

---

## Logger backend

| Option | Description | Selected |
|--------|-------------|----------|
| Pino + pino-pretty | Both already installed as runtime deps; STACK.md/SUMMARY.md chose them. ConsoleLogger wraps pino with pino-pretty transport; adapter maps Logger's (message, ...args) onto pino's (obj, msg). | ✓ |
| Tiny console wrapper | ~20-line leveled wrapper over console, zero logging deps (the ARCHITECTURE.md sketch). Simpler, but reinvents leveling/coloring and contradicts the installed deps. | |
| You decide | Let Claude pick the recommended option. | |

**User's choice:** Pino + pino-pretty
**Notes:** Resolves the ARCHITECTURE.md ("no library needed") vs SUMMARY.md/STACK.md ("Pino wrapper") conflict in favor of Pino — the deps are already in package.json. Claude noted always-pretty transport (vs NODE_ENV-gated) since the console output is the demo's interface; user did not object.

---

## Turn narration

| Option | Description | Selected |
|--------|-------------|----------|
| One line per decision | Per turn: INFO for chosen ad + solve outcome (deltas), INFO per buy, WARN for skips, ERROR for failures; raw arrays only at DEBUG. | |
| Verbose play-by-play | The above PLUS candidate ads + EV ranking, shop catalog, fetch boundaries each turn. | ✓ |
| Minimal | Keep today's sparse calls, just promote levels. | |

**User's choice:** Verbose play-by-play
**Follow-up question — where should the verbose detail sit?**

| Option | Description | Selected |
|--------|-------------|----------|
| Play-by-play at DEBUG | Decisions/outcomes + skips at INFO (clean default run); candidate-ads/EV-ranking/catalog play-by-play at DEBUG, revealed with LOG_LEVEL=debug. | ✓ |
| Play-by-play at INFO | Full reasoning prints on a normal run; raw API objects still DEBUG. | |
| You decide | Let Claude place each line. | |

**User's choice:** Play-by-play at DEBUG
**Notes:** Net effect — verbose reasoning is available but gated to DEBUG so a default `info` run stays scannable (one line per decision/outcome/skip). Confirmed that Phase 4 enriches runner.ts's logger.* calls (in-scope), still interface-only.

---

## Final score + exit codes

**Final-score presentation:**

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct printed block | index.ts prints a bordered/banner FINAL SCORE block to stdout, separate from leveled pino narration; always visible regardless of level. | ✓ |
| Leveled info line | Reuse the logger: one logger.info('game over', report) line. | |
| You decide | Let Claude pick the recommended block. | |

**User's choice:** Distinct printed block

**Exit-code mapping (GAME_OVER → 0 already locked by Phase 3 D-08):**

| Option | Description | Selected |
|--------|-------------|----------|
| 3-way split (0/1/2) | 0 = GAME_OVER, 1 = guard stop (TURN_CAP/NO_PROGRESS), 2 = thrown Transport/BoundaryError. | ✓ |
| Binary (0/1) | 0 = GAME_OVER, 1 = everything else. | |
| You decide | Let Claude pick the 3-way split. | |

**User's choice:** 3-way split (0/1/2)
**Notes:** index.ts maps the three END reason strings → 0/1 and its catch path → 2; a script/CI can distinguish a graceful guard stop from an API crash.

---

## CLI flags & verbosity

| Option | Description | Selected |
|--------|-------------|----------|
| LOG_LEVEL env var only | Read process.env.LOG_LEVEL (default info); LOG_LEVEL=debug npm start for play-by-play. Zero arg parsing. | |
| Env var + --verbose flag | Also honor --verbose/-v (and maybe --log-level/--help) via node:util parseArgs; nicer ergonomics. | ✓ |
| Fixed info level | No knob at all. | |

**User's choice:** Env var + --verbose flag
**Notes:** Default level info; precedence flag > LOG_LEVEL env > default. No positional args. Live smoke run = `npm start` against the real API (settled, not a fork) — the only live network call; suite stays offline.

---

## Claude's Discretion

- pino-pretty options (colorize, translateTime, ignore: pid,hostname) and the exact `...args`→merge-object folding in ConsoleLogger.
- The visual format of the final-score banner and the failure-message wording.
- The exact flag set/aliases (--verbose/-v, --log-level, --help) and parseArgs config, as long as flag > env > info precedence holds.
- Whether the runner emits logger.error itself before an error unwinds (index.ts's catch is authoritative regardless).
- Whether index.ts carries a `#!/usr/bin/env node` shebang / bin entry (optional polish).
- Always-pretty transport (vs NODE_ENV-gated) — accepted by the user implicitly.

## Deferred Ideas

None — discussion stayed within Phase 4 scope. Multi-game runs/stats (RUN-01), adaptive probability memory (STRAT-07), and reputation weighting (STRAT-08) remain parked in REQUIREMENTS.md v2. A bin entry / global install is optional polish, not a deferral.
