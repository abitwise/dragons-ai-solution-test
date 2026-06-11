# Dragons of Mugloar — Autoplay Bot

A TypeScript command-line bot that autonomously plays [*Dragons of Mugloar*](https://dragonsofmugloar.com)
through its public HTTP API. Each turn it reads the available quests ("ads"), picks which to solve
using a readable expected-value heuristic, heals and buys upgrades from the shop when sensible, and
keeps playing until game-over — narrating every decision and printing the final score.

It's a solution to the well-known Dragons of Mugloar coding test, built test-first (TDD) with a
deliberately simple architecture.

> **Fully AI-built submission.** This entire repository — design, tests, implementation, and docs —
> was produced end-to-end by AI (Claude Code, driven by a structured, test-first workflow). The
> commit history reflects that phase-by-phase, TDD process.

## Prerequisites

- **Node.js 24 LTS** or newer (`>=24`) — uses native `fetch` and ESM.
- **npm** (ships with Node).

No build step and no API key: the bot talks to the live, public Mugloar API at runtime.

## Install

```bash
npm install
```

## Run the bot

```bash
npm start          # play one full game against the live API, then exit
npm run dev        # development watch loop (tsx watch) — see note below
```

`npm start` plays a single game to completion and **exits** on its own.

`npm run dev` is a **development watch loop**: it does *not* exit after a game — `tsx watch`
stays running and starts a fresh game whenever you change a source file or press **Enter**.
Stop it with **Ctrl-C**. Use `npm start` (not `dev`) to just play one game.

Either way, the bot plays a complete game and prints a final-score banner:

```
+------------------------------------+
|  FINAL SCORE : 1234                |
|  TURNS PLAYED: 42                  |
|  END REASON  : game over: lives reached 0 |
+------------------------------------+
```

### CLI options

Flags are passed after a `--` separator so npm forwards them to the bot:

```bash
npm start -- --verbose
npm start -- --log-level debug
npm start -- --help
```

| Option | Description |
|--------|-------------|
| `-v`, `--verbose` | Set the log level to `debug` (verbose, turn-by-turn play-by-play). |
| `--log-level <lvl>` | Set the level explicitly: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`. Wins over `--verbose`. |
| `-h`, `--help` | Print usage and exit without starting a game. |

### Environment

| Variable | Description |
|----------|-------------|
| `LOG_LEVEL` | Fallback log level when no flag is given (default: `info`). |
| `MUGLOAR_BASE_URL` | Override the API base URL (default: `https://dragonsofmugloar.com/api/v2`). |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Natural game-over (lives reached 0). |
| `1` | Stopped by a safety guard (turn cap or no-progress). |
| `2` | A transport/boundary error (the API was unreachable or returned an unexpected shape). |

## Tests, type-checking & linting

```bash
npm test           # run the full unit suite once (Vitest)
npm run test:watch # re-run tests on change
npm run typecheck  # tsc --noEmit (type-strip runners don't type-check, so run this)
npm run lint       # Biome check + autofix (format + lint in one pass)
```

The suite is **151 tests across 7 files**, fully offline and deterministic — they run against an
injected fake API client, so no network is touched.

## How it plays

The game gives the bot **gold**, **lives**, a **score**, and a board of ads (quests). Each ad has a
reward, a free-text probability label (e.g. `"Sure thing"` … `"Suicide mission"`), and an expiry.
Solving an ad can succeed or fail; failures cost a life; the game ends when lives hit 0. A shop sells
healing potions and upgrades.

The bot's heuristic (in `src/strategy.ts`, kept as pure functions):

- **Pick an ad by expected value** — `reward × probability-rank`, only attempting ads at or above a
  safety floor (`"Hmmm...."` or safer), tie-breaking on sooner expiry then higher reward. If nothing
  clears the floor it takes the *least-bad gamble* rather than stalling.
- **Manage the shop first each turn** — buy a healing potion when lives are low, otherwise buy the
  priciest affordable upgrade while keeping a gold buffer in reserve for healing.
- **Decode encrypted ads** — some ads arrive Base64- or ROT13-encoded; these are decoded at the API
  boundary before the strategy sees them.

The game loop (`src/runner.ts`) is a thin imperative shell: fetch → decide → act → fold result into
state, repeat. Two guards (a turn cap and a no-progress detector) make non-termination impossible.

## Project layout

A flat `src/` directory — functional core / imperative shell, with dependency injection done by
passing one argument (no DI container). See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the
dependency graph, layer boundaries, and the rationale for keeping `src/` flat.

| File | Responsibility |
|------|----------------|
| `index.ts` | CLI entrypoint: parse flags, build the real client + logger, run one game, map exit codes. |
| `runner.ts` | The game loop (imperative shell) — the one place that sequences I/O. |
| `strategy.ts` | Pure decision logic — which ad to solve, what to buy, how to fold results into state. |
| `api.ts` | The live HTTP client (`fetch`, zod validation, bounded retry). |
| `fake-api-client.ts` | Scripted in-memory client used to run the whole game offline in tests. |
| `decode.ts` | Base64 / ROT13 decoding for encrypted ads. |
| `logger.ts` | Leveled, human-readable logging (Pino + pino-pretty). |
| `types.ts` | Shared types and the injectable `ApiClient` / `Logger` interfaces. |

Each source file has a matching `*.test.ts` beside it.

## Tech stack

Node.js 24 · TypeScript 5.9 · [tsx](https://tsx.is) (run TS directly, no build) · native `fetch` ·
[Vitest](https://vitest.dev) · [Pino](https://getpino.io) · [Biome](https://biomejs.dev) ·
[zod](https://zod.dev) (API-boundary validation).
