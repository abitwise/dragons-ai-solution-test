# Architecture

This bot is a small, deliberately simple program: a **functional core wrapped in a thin imperative
shell**, wired together at a single composition root. It follows the *ports-and-adapters* (hexagonal)
shape — pure decision logic in the middle, I/O pushed to the edges — but without any of the ceremony
(no DI container, no framework, no folders). Dependency injection here means *passing one argument
to a function*.

This document explains how the pieces fit, the rules that keep them decoupled, and why `src/` is
kept flat. For how the bot *plays*, see the [README](../README.md).

## At a glance

`src/` is a flat directory of 8 production modules plus one test double, each with a colocated
`*.test.ts`. Every module declares its own boundaries in a header comment.

| Layer | Module(s) | Responsibility | May import |
|-------|-----------|----------------|------------|
| **Leaf** | `types.ts` | Domain models + the two ports (`ApiClient`, `Logger`). No logic, no runtime values. | nothing |
| **Pure core** | `strategy.ts`, `decode.ts` | Deterministic decision logic and the encrypted-ad decoder. No I/O, never throws. | `types` |
| **Adapters (edges)** | `api.ts`, `logger.ts` | The two I/O edges: the live HTTP client (`fetch` + zod) and the leveled logger (Pino). | `types` (+ their own lib) |
| **Orchestration** | `runner.ts` | The game loop — the one place that sequences I/O. | `strategy`, `types` |
| **Composition root** | `index.ts` | CLI entry: parse flags, construct the real client + logger, run one game, map exit codes. | everything |
| **Test infrastructure** | `fake-api-client.ts` | Scripted in-memory `ApiClient` so the whole game runs offline in tests. | `types` |

## Dependency graph

The graph is acyclic and points strictly **inward**, toward `types.ts` (the single sink). Nothing in
the pure core or the adapters depends on the orchestration or the composition root.

```
index.ts ──┬─► api.ts ──► decode.ts ─► types.ts
           ├─► logger.ts ───────────► types.ts
           ├─► runner.ts ─► strategy.ts ─► types.ts
           └──────────────────────────► types.ts

fake-api-client.ts (test double) ─► types.ts
```

External libraries are confined to the edges — they never leak into the core:

| Library | Reaches only |
|---------|--------------|
| `zod` | `api.ts` (validates each endpoint's raw wire shape) |
| `pino` + `pino-pretty` | `logger.ts` |
| `node:util` (`parseArgs`) | `index.ts` |

So `strategy.ts` and `runner.ts` — the logic you most want to read and test — know nothing about
HTTP, JSON, retries, or log transports.

## The two seams

Decoupling rides on two interfaces declared in `types.ts`:

- **`ApiClient`** — the injectable API seam. `runner.ts` depends on this interface, never on
  `HttpApiClient`. Production wires the real `HttpApiClient` (the *only* `fetch` caller) in
  `index.ts`; tests wire `FakeApiClient`. No HTTP-mocking library is used.
- **`Logger`** — the runner logs through this interface, never through `console` or `pino` directly,
  so tests can pass a silent/spy logger and CI stays quiet.

Both real implementations (`HttpApiClient`, `ConsoleLogger`) are constructed in exactly **one place**
— `index.ts`. That single construction site is what makes the rest of the program trivially testable.

## Boundary rules

These are the invariants that keep the layering honest. They're enforced today by import discipline
and the module header comments (not by tooling), and they're worth preserving:

1. **`types.ts` is the leaf.** Types and interfaces only — no logic, no runtime values, no library
   imports. Everything else imports its shapes from here.
2. **`fetch` lives only in `api.ts`.** It's the single trust boundary: zod validation, the
   `TransportError` / `BoundaryError` taxonomy, bounded retry for idempotent reads, and the
   `MUGLOAR_BASE_URL` read all live here and nowhere else.
3. **Logging libraries live only in `logger.ts`.** Same idea as the HTTP edge — one swappable place.
4. **The pure core stays pure.** `strategy.ts` and `decode.ts` perform no I/O, import no libraries,
   and never throw — an unknown probability label ranks worst, a malformed ad is filtered out, a bad
   decode passes the ad through unchanged. One adversarial input can't crash the loop.
5. **State advances only through merge helpers.** `runner.ts` never assigns a raw API result to game
   state; it folds each result via `applySolveResult` / `applyBuyResult`, which preserve the field the
   other response omits (the deliberate solve/buy asymmetry documented in `types.ts`).
6. **`index.ts` owns the only `try/catch`.** The runner adds no error handling; a thrown
   `TransportError` / `BoundaryError` propagates verbatim and the composition root maps it to exit
   code `2`.

## Why `src/` is flat (and should stay that way)

The flat layout is a deliberate decision, not an accident — `index.ts` even keeps its two pure
helpers inline specifically to preserve "the flat source-file shape." For a program this size, flat
is the right call:

- **The architecture is already enforced** by the inward-pointing import graph and the per-module
  boundary comments. Folders would add no boundary check here — no lint rule keys off directory
  layout — so they'd be cost without a new guarantee.
- **Simplicity is a project mandate**, not an afterthought ("keep it simple — minimal layers, no
  over-engineering").
- **One `ls src/` shows the whole system.** With 8 modules, navigation isn't a problem folders solve.
- **Folders would mean churn for zero functional gain** — rewriting every relative import under
  NodeNext resolution.

Folders typically start earning their keep around 15–20+ source modules, or when genuinely distinct
bounded contexts appear. This project has neither.

### If it ever grows

If the module count roughly doubles, mirror the **existing** layers rather than inventing new ones:

```
src/
  index.ts            # composition root stays at the root (conventional)
  domain/             # leaf + pure core — no I/O, no libraries
    types.ts  strategy.ts  decode.ts
  adapters/           # the edges — external libraries live ONLY here
    api.ts    logger.ts
  app/
    runner.ts         # orchestration / use-case shell
  testing/
    fake-api-client.ts
```

Tests would stay colocated with their subject. The ports (`ApiClient`, `Logger`) would stay in
`types.ts` — splitting them into a separate `ports/` directory is exactly the kind of premature
abstraction the project avoids.

## Testing model

Every source module has a colocated `*.test.ts`. The suite is fully offline and deterministic: it
wires `FakeApiClient` (a scripted, fail-loud test double) into `runner.ts` and a spy `Logger`, so a
complete game can be driven turn-by-turn with no network. The pure core (`strategy.ts`, `decode.ts`)
is tested directly as plain functions over plain objects. Because the real client and logger are
constructed only in `index.ts`, nothing else needs the network to be exercised.
