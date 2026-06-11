---
quick_id: 260611-khz
title: Add README.md (prerequisites, install, tests, linter, game, CLI options)
mode: quick
status: complete
date: 2026-06-11
---

# Quick Task 260611-khz: Add README.md

## Description

Add a concise top-level `README.md` for the Dragons of Mugloar Autoplay Bot. Not too long.
Cover: what this is (a fully AI-built submission of the Dragons of Mugloar coding test),
prerequisites, install, how to run the bot, how to run tests / typecheck / linter, a short
explanation of the game and the bot's heuristic, and the CLI options.

## Task

**Files:** `README.md` (new)

**Action:** Write a single Markdown README at the repo root with these sections:
- One-line intro + "fully AI-built submission" framing.
- Prerequisites (Node 24 LTS, npm).
- Install (`npm install`).
- Run the bot (`npm start`, `npm run dev`).
- CLI options & environment (`-v/--verbose`, `--log-level`, `-h/--help`, `LOG_LEVEL`,
  `MUGLOAR_BASE_URL`, exit codes) — sourced from `src/index.ts`.
- Tests / typecheck / lint (`npm test`, `npm run test:watch`, `npm run typecheck`,
  `npm run lint`).
- How it plays (the game + the readable heuristic) — sourced from `src/strategy.ts`,
  `src/runner.ts`.
- Project layout (flat `src/` functional-core / imperative-shell).

**Verify:** Every command and flag in the README maps to a real `package.json` script
or a real `parseArgs` option in `src/index.ts`. `npm test` passes (151 tests).

**Done:** `README.md` exists at repo root, is accurate against the codebase, and is
committed.

## must_haves

- **truths:**
  - README documents only real npm scripts: `dev`, `start`, `test`, `test:watch`,
    `typecheck`, `lint`.
  - README documents only real CLI flags: `-v/--verbose`, `--log-level <lvl>`, `-h/--help`,
    and env `LOG_LEVEL`, `MUGLOAR_BASE_URL`.
  - Prerequisite Node version matches `package.json` engines (`>=24`).
- **artifacts:**
  - `README.md` at repo root.
- **key_links:**
  - `package.json` (scripts, engines)
  - `src/index.ts` (CLI options, exit codes)
  - `src/strategy.ts` / `src/runner.ts` (heuristic + loop, for the "how it plays" section)
