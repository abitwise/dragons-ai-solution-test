---
quick_id: 260611-khz
title: Add README.md (prerequisites, install, tests, linter, game, CLI options)
status: complete
date: 2026-06-11
---

# Quick Task 260611-khz — Summary

## What was done

Added a concise top-level `README.md` for the Dragons of Mugloar Autoplay Bot.

Sections: intro + "fully AI-built submission" framing · prerequisites (Node 24) · install ·
run the bot (`npm start` / `npm run dev`) with the final-score banner · CLI options
(`-v/--verbose`, `--log-level`, `-h/--help`) and environment (`LOG_LEVEL`, `MUGLOAR_BASE_URL`) ·
exit codes (0/1/2) · tests/typecheck/lint commands · how the bot plays (game + heuristic) ·
flat `src/` project layout · tech stack.

## Accuracy

Every documented command and flag was verified against the source of truth:
- npm scripts (`dev`, `start`, `test`, `test:watch`, `typecheck`, `lint`) ← `package.json`
- CLI flags, env vars, and exit codes ← `src/index.ts` (`parseArgs`, `USAGE`, `exitCodeForReason`)
- Node `>=24` ← `package.json` engines
- Heuristic description ← `src/strategy.ts` (EV selection, floor, shop heal/upgrade)
- Default base URL `https://dragonsofmugloar.com/api/v2` ← `src/api.ts`
- Test count "151 tests across 7 files" ← `npm test` output

## Verification

- `npm test` → 7 files, 151 tests passed.

## Files

- `README.md` (new)
