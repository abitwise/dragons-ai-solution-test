---
phase: 04-logger-cli-live-smoke
plan: 01
subsystem: infra
tags: [pino, pino-pretty, logging, typescript, esm, tdd, vitest]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "the Logger interface (types.ts:131-136) and the inject-a-dep + factory-with-defaults house pattern (api.ts realDelay/HttpApiClientOptions)"
provides:
  - "ConsoleLogger — the concrete Logger backed by Pino + pino-pretty (D-01)"
  - "createConsoleLogger(level) — the production factory wiring the synchronous pretty stream"
  - "foldArgs — the pure message-first → pino object-first bridge (D-02)"
  - "the sole pino/pino-pretty importer; every other module stays on the Logger interface"
affects: [04-02-runner-narration, 04-03-index-cli, 04-04-live-smoke]

# Tech tracking
tech-stack:
  added: []  # pino@^10 / pino-pretty@^13 already in package.json from prior phases; no installs
  patterns:
    - "Inject the pino instance into ConsoleLogger; build the real stream in a separate createConsoleLogger factory (mirrors api.ts delay/realDelay split) — keeps the unit test offline"
    - "Synchronous pretty stream: pino(opts, pinoPretty({ sync: true })) — NOT the worker-thread transport form (deterministic flush on a short-lived CLI)"
    - "D-02 fold: caller values ride as STRUCTURED pino fields, never concatenated into the message (log-injection mitigation T-04-01)"

key-files:
  created:
    - src/logger.ts
    - src/logger.test.ts
  modified: []

key-decisions:
  - "ConsoleLogger takes an injected pino.Logger; createConsoleLogger(level) is the only place the real synchronous pino-pretty stream is built (mirrors api.ts realDelay/factory split)"
  - "foldArgs has three branches: 0 args → message-only; exactly one non-null non-array object → that object as pino's merge object; everything else (multi/mixed/primitive/lone-array) → wrapped under one `args` key so the message stays the headline"
  - "Used the synchronous pretty-stream form (sync: true) over the worker-thread transport form to remove the logs-lost-on-exit risk class by construction"

patterns-established:
  - "Sole-adapter-behind-an-interface: logger.ts is the only pino/pino-pretty importer, exactly as api.ts is the only fetch caller"
  - "Offline logger test: spy over an output-disabled pino (pino({ enabled: false })) and assert CALL SHAPE only, never the rendered pretty string"

requirements-completed: [LOG-01]

# Metrics
duration: 3min
completed: 2026-06-10
---

# Phase 4 Plan 01: ConsoleLogger Summary

**`ConsoleLogger` bridges the message-first `Logger` interface to pino's object-first idiom via a pure `foldArgs`, with a `createConsoleLogger` factory wiring a synchronous pino-pretty stream — the codebase's sole pino importer, proven by 5 offline spy tests.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-10T20:45:16Z
- **Completed:** 2026-06-10T20:48:07Z
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments
- `ConsoleLogger implements Logger` — routes each of debug/info/warn/error to the same-named pino method via a single private `emit`.
- Pure `foldArgs` bridges `method(message, ...args)` → pino's `method(mergeObj, message)` across all three branches (zero-args, single-object, multi/mixed-wrapped), with arrays wrapped under `args` rather than mistaken for a merge object.
- `createConsoleLogger(level)` production factory builds the real synchronous pino-pretty stream (`sync: true`), the only place the real stream is constructed.
- 5 offline spy tests (zero network) cover routing + every fold branch; full suite stays green at 134 tests; `logger.ts` is the sole pino/pino-pretty importer.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing ConsoleLogger fold + routing tests** - `843f662` (test)
2. **Task 1 (GREEN): implement ConsoleLogger fold + level routing** - `c66d176` (feat)
3. **Task 2: add createConsoleLogger production factory (sync pretty stream)** - `d517db5` (feat)

_TDD Task 1 produced the test→feat pair; the refactor (comment tidy) was folded into the GREEN commit before it landed, so no separate refactor commit._

## Files Created/Modified
- `src/logger.ts` - `ConsoleLogger` class (implements `Logger`), pure `foldArgs` helper, and `createConsoleLogger(level)` factory. The ONLY module importing pino/pino-pretty.
- `src/logger.test.ts` - Offline spy coverage: D-02 fold (object-first), zero-args message-only, per-level routing, multi/mixed wrap, array-wrap-not-spread.

## Decisions Made
- Injected pino instance + separate `createConsoleLogger` factory (mirrors `api.ts` `delay`/`realDelay`) so the unit test never touches a real stream/output.
- Synchronous pretty stream (`pino(opts, pinoPretty({ sync: true }))`) chosen over the worker-thread `transport` form — removes the tail-line-loss-on-exit risk class by construction for a short-lived CLI (per RESEARCH Pattern 1 / Pitfall 1).
- `foldArgs` keeps caller values as structured pino fields, never concatenated into the message string — this is the T-04-01 log-injection mitigation (untrusted API strings cannot forge new log lines).

## Deviations from Plan

None - plan executed exactly as written.

_(Two JSDoc comments were reworded so the acceptance-criteria greps — `grep -c "enum"` and `grep -c "transport:"` must be `0` — match cleanly; the words "enum" and "transport:" only ever appeared inside explanatory comments, never as code. This is a wording adjustment, not a behavioral deviation.)_

## Issues Encountered
None. The plan's verified code shapes (RESEARCH Patterns 1-2, PATTERNS analogs) matched the installed pino@10.3.1 / pino-pretty@13.1.3 exactly; typecheck, lint, and tests passed on first implementation.

## Threat Surface
- **T-04-01 (log injection) — mitigated as planned:** `foldArgs` routes caller-supplied (potentially untrusted, API-sourced) values into pino's STRUCTURED merge object, never into the message string, so embedded ANSI/newline sequences cannot forge log lines. No new security surface beyond the plan's threat model.

## User Setup Required
None - no external service configuration required. (The live smoke against the real API is a later plan, Plan 04, and is a manual step.)

## Next Phase Readiness
- `createConsoleLogger(level)` is ready for `index.ts` (Plan 03) to construct as the composition-root logger.
- `ConsoleLogger`'s `Logger` interface is ready for `runner.ts` narration enrichment (Plan 02) — the runner keeps calling only the interface, never pino directly.
- No blockers. The existing non-`www` base-URL blocker (STATE.md) is unrelated to this plan and only bites the live smoke (Plan 04).

## Self-Check: PASSED

- FOUND: src/logger.ts
- FOUND: src/logger.test.ts
- FOUND: .planning/phases/04-logger-cli-live-smoke/04-01-SUMMARY.md
- FOUND commit: 843f662 (test RED)
- FOUND commit: c66d176 (feat GREEN)
- FOUND commit: d517db5 (feat factory)

---
*Phase: 04-logger-cli-live-smoke*
*Completed: 2026-06-10*
