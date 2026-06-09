# Stack Research

**Domain:** Small, single-purpose TypeScript Node.js CLI bot consuming an external REST API (TDD, human-readable leveled logging)
**Researched:** 2026-06-08
**Confidence:** HIGH

## Executive Recommendation

For this project, the modern 2025/2026 "boring is best" stack is: **TypeScript 5.9 (not 6.0) compiled/run with `tsx`, native `fetch` wrapped behind a tiny injected API-client interface, Vitest as the test runner, and Pino + pino-pretty for leveled human-readable logging, with Biome for lint+format.** Every choice below optimizes for the two stated constraints — *keep it simple* and *test-first* — and deliberately avoids anything that adds layers (no axios instances, no nock/msw interceptors, no winston transports, no database, no web server, no DI container).

The single most important architectural decision for testability is **not** which mocking library to pick — it is to define a small `GameApi` interface and inject it. Once you do that, the HTTP library is an implementation detail, network interceptors become unnecessary, and tests are plain in-memory fakes.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Node.js** | **24.x (Active LTS)** | Runtime | Node 24 is the current Active LTS in 2026; Node 22 is in Maintenance LTS. 24 ships stable native `fetch` (undici-backed) and stable type-stripping. Target 24 for the engines field. (Node 26 is Current, not yet LTS until Oct 2026 — don't pin to it.) |
| **TypeScript** | **5.9.x** | Type system | **Pin to 5.9, NOT 6.0.** TS 6.0 (released Mar 2026) is a transition release with "the largest set of breaking changes since 2.0" (removes `moduleResolution: classic`, forces `esModuleInterop`, flips defaults). It is a setup-for-the-Go-rewrite (TS 7.0) release, not a stability win. A tiny greenfield project gains nothing from 6.0's churn — 5.9 is the proven, well-documented baseline every tutorial and tool assumes. |
| **tsx** | **4.x** | Run/execute `.ts` directly | Zero-config, esbuild-powered TS execution. `npm run dev` / `npm start` just work with no build step, watch mode included. See "Why tsx over native Node TS" below — it's the safe simple default in 2026 even though Node can now run `.ts` natively. |
| **ESM** | `"type": "module"` | Module system | ESM is the 2026 default; native `fetch`, `tsx`, Vitest, and Pino all assume it. TS 6.0 even defaults `module` to `esnext`. No reason to use CommonJS for a greenfield CLI. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **Native `fetch`** | built into Node 24 | HTTP client | Use the global `fetch` (undici under the hood). Zero dependencies, standard API, identical to browser/Deno/Bun. Wrap it behind one thin function so the rest of the app never touches it directly. |
| **Vitest** | **4.x** | Test runner | TDD runner of choice for new TS projects in 2026: flawless TS+ESM with zero config, fast watch mode, Jest-compatible `expect`/`vi.fn()` mocking, built-in coverage. |
| **Pino** | **10.x** | Structured logger | Fast, focused, leveled (`trace/debug/info/warn/error/fatal`), ~9M weekly downloads, the 2026 default for new projects. JSON in production, pretty in dev. |
| **pino-pretty** | **13.x** | Human-readable log output | Pino transport that turns JSON logs into colorized, human-readable, leveled lines — exactly the "clear turn-by-turn narration" the brief asks for. Dev dependency. |
| **zod** *(optional)* | 4.x | Runtime validation of API responses | OPTIONAL. Use only if you want to defensively validate the shape of `/game/start`, `/messages`, etc. at the boundary. Pays off because the Mugloar API is external and its `probability` field is free-text. If it feels like over-engineering for v1, skip it and hand-write a narrow parser — but it's a clean, simple fit at exactly one place (the API client). |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **Biome** (`@biomejs/biome` 2.x) | Lint + format in one tool | Single fast Rust binary replacing ESLint+Prettier+plugins. One config file, near-zero setup, no plugin-version-matrix pain. Ideal for "keep it light." Run `biome check --write`. |
| **tsc** (from `typescript`) | Type-check only (`tsc --noEmit`) | Since `tsx` and Node strip types *without* checking them, you still need `tsc --noEmit` in your `typecheck`/CI script to actually catch type errors. This is the one thing the no-build-step approach must not skip. |
| **@tsconfig/node24** | Base tsconfig | Maintained base config matching Node 24 target/lib. Extend it instead of hand-rolling compiler options. |

## Installation

```bash
# (No runtime deps for HTTP — fetch is built in)

# Runtime
npm install pino

# Dev dependencies
npm install -D typescript@~5.9 tsx vitest pino-pretty @biomejs/biome @types/node @tsconfig/node24

# Optional: runtime API-response validation
npm install zod
```

```jsonc
// tsconfig.json
{
  "extends": "@tsconfig/node24/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "noEmit": true,          // tsx runs it; tsc only type-checks
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

```jsonc
// package.json scripts (the whole loop, nothing more)
{
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "start":     "tsx src/index.ts",
    "dev":       "tsx watch src/index.ts",
    "test":      "vitest run",
    "test:watch":"vitest",            // TDD inner loop
    "typecheck": "tsc --noEmit",
    "lint":      "biome check .",
    "fix":       "biome check --write .",
    "check":     "npm run typecheck && npm run lint && npm run test"
  }
}
```

## The One Decision That Matters Most: Inject the API client

Do **not** reach for a network interceptor. The clean, simple, fully-testable pattern is dependency injection of a narrow interface:

```typescript
// src/api/types.ts
export interface GameApi {
  startGame(): Promise<GameState>;
  getMessages(gameId: string): Promise<Ad[]>;
  solveMessage(gameId: string, adId: string): Promise<SolveResult>;
  shop(gameId: string): Promise<ShopItem[]>;
  buy(gameId: string, itemId: string): Promise<BuyResult>;
}

// src/api/http-client.ts  — the ONLY file that touches fetch
export function createHttpGameApi(baseUrl = "https://www.dragonsofmugloar.com/api/v2"): GameApi { /* fetch(...) */ }

// tests/  — a hand-written fake, no nock/msw needed
const fakeApi: GameApi = { startGame: async () => ({ ... }), /* ... */ };
```

The decision loop, heuristic, and shop logic receive a `GameApi` and never know HTTP exists. Tests pass a fake (or `vi.fn()` stubs) — deterministic, instant, zero network. This is simpler *and* more robust than intercepting undici.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Native `fetch` | **axios** 1.17 | Only if you need automatic retry/interceptor middleware, broad legacy-Node support, or auto JSON-throw-on-4xx out of the box. For one base URL and ~5 endpoints, it's a dependency you don't need. |
| Native `fetch` | **got** 15 / **ky** | got = powerful streaming/retry for heavy HTTP workloads; ky = tiny fetch-wrapper with retries. Reasonable, but still more than this bot needs once you wrap fetch yourself. |
| **DI fake client** | **nock** 14 / **msw** 2 | Interceptors shine for integration tests that must exercise the *real* HTTP serialization path, or for large apps with many call sites. For this project they add a moving part that the injected-interface approach eliminates. |
| **Vitest** | **node:test** | Genuinely good for a zero-dependency CLI/library. Choose it only if "no test deps at all" is a hard goal — you lose Vitest's watch DX, ergonomic mocking, and snapshot/coverage polish, and need extra setup for TS. For TDD ergonomics, Vitest wins. |
| **Vitest** | **Jest** 30 | Jest is fine but heavier ESM/TS config and slower; no advantage here over Vitest. |
| **tsx** | **Native Node type-stripping** | Viable for scripts. Choose it to drop even the tsx dependency — but only if you avoid TS `enum`/`namespace`/decorators (Node strips, doesn't transform them) and accept that Node ignores `tsconfig` `paths`. tsx removes those footguns for one small dev-dep. |
| **tsx** | **`tsc` build → `node dist/`** | Use if you must ship compiled JS artifacts (publishing to npm, container without dev deps). Add `"build": "tsc"` then. For run-and-play locally, the build step is pure ceremony. |
| **Biome** | **ESLint 10 + Prettier 3** | Use if you need a specific ESLint plugin Biome lacks (e.g., niche framework rules). For a tiny CLI, Biome's one-tool simplicity wins. |
| **Pino** | **winston** 3 | Use winston only for complex multi-transport routing pipelines. Its flexibility is overhead here. |
| **Pino + pino-pretty** | **tiny custom console logger** | A ~20-line leveled `console` wrapper is a legitimate "ultra-minimal" choice and has zero deps. Pino is recommended because it gives proper levels, child loggers (great for tagging turns), and pretty output essentially for free, without the temptation to slowly reinvent a logger. If you truly want zero logging deps, the custom wrapper is acceptable. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **TypeScript 6.0** | Largest breaking-change release since 2.0 (Mar 2026); a transition release for the TS 7 Go rewrite. Pure churn risk for a greenfield toy project. | TypeScript **5.9** |
| **Node 26 / pinning to "latest"** | Node 26 is *Current*, not LTS until Oct 2026. CI/runtime should sit on Active LTS. | Node **24 LTS** |
| **ts-node** | Slower, ESM config is fiddly, effectively superseded. The ecosystem moved to tsx/native stripping. | **tsx** |
| **axios / got / ky** | Extra dependency + a second HTTP abstraction to learn and mock, for ~5 endpoints against one base URL. | Native **`fetch`**, wrapped once |
| **nock / msw** | Network interceptors add a layer that the injected-interface design makes unnecessary; they couple tests to HTTP mechanics. | **Inject a `GameApi`**, use a fake / `vi.fn()` |
| **winston** | Heavier, slower, transport machinery aimed at large apps. | **pino** + **pino-pretty** |
| **A database / ORM (Prisma, sqlite, etc.)** | PROJECT.md says state lives in memory for one run, by design. | Plain in-memory objects |
| **A web framework (Express/Fastify/Nest)** | This is a CLI; there is no server. | A plain `src/index.ts` entrypoint |
| **A DI container (tsyringe, inversify)** | Massive over-engineering. "Dependency injection" here = passing one argument to a function. | Constructor/function parameters |
| **CommonJS (`require`)** | Legacy; fights tsx, Vitest, fetch, and TS 6 defaults. | **ESM** (`"type": "module"`) |
| **An arg-parsing framework (oclif, yargs) for v1** | The CLI takes effectively no args ("start a game and play"). | `process.argv` or nothing; add `node:util parseArgs` only if a flag appears |

## Stack Patterns by Variant

**If you want the absolute minimum dependency footprint:**
- Drop `tsx` → run via `node --experimental-strip-types src/index.ts` (or unflagged on Node 24+).
- Drop `pino`/`pino-pretty` → a tiny leveled `console` wrapper.
- Keep Vitest (the TDD ergonomics are worth one dev dep) and keep `tsc --noEmit`.
- Constraint: no TS `enum`/`namespace`/decorators (use string-literal unions / `const` objects instead — which you'd want anyway).

**If you later ship a distributable artifact (npm package / slim container):**
- Add `"build": "tsc"` (emit to `dist/`, flip `noEmit` off in a build config) and a `bin` entry.
- Production install excludes dev deps; pino stays as the only runtime dep.

**If the API's free-text `probability` parsing gets flaky in practice:**
- Introduce `zod` *only* at the API-client boundary to validate/normalize responses. Keep it out of the decision loop.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Node 24 LTS | tsx 4, Vitest 4, pino 10 | All target/support active LTS; native `fetch` stable on 24. |
| TypeScript 5.9 | @tsconfig/node24, Vitest 4, Biome 2 | Avoid TS 6.0 until the project has a reason; tooling configs widely assume 5.x. |
| tsx 4 | ESM + Node 24 | Strips & transforms TS (handles enums/decorators) — superset of Node's native stripping. |
| pino 10 + pino-pretty 13 | each other | pino-pretty is a peer transport; versions track together. |
| Vitest 4 | ESM, native fetch | Mock fetch via injected client or `vi.spyOn(globalThis, "fetch")`; no interceptor lib needed. |

## Confidence Assessment

| Choice | Confidence | Basis |
|--------|------------|-------|
| Node 24 LTS / avoid 26 pin | HIGH | Node release schedule + endoflife (official) |
| TypeScript 5.9 over 6.0 | HIGH | Official TS 6.0 release notes confirm breaking-change scope |
| tsx as runner | HIGH | npm version + Node docs on type-stripping limitations |
| Native fetch + injected client | HIGH | undici/Node docs; DI is the testability lever |
| Vitest for TDD | HIGH | Multiple 2026 comparisons + Vitest docs |
| Pino + pino-pretty | HIGH | 2026 logging comparisons + npm versions |
| Biome for lint/format | MEDIUM | Strong 2026 trend; ESLint+Prettier remains a valid fallback |
| zod as optional boundary validation | MEDIUM | Sound pattern; "optional" by design to honor simplicity |

## Sources

- Node.js release schedule / LTS — https://nodejs.org/en/about/previous-releases , https://endoflife.date/nodejs , https://www.infoq.com/news/2026/06/nodejs-release-changes/ (HIGH)
- Node native TypeScript type-stripping & limitations — https://nodejs.org/api/typescript.html , https://dev.to/benriemer/nodejs-24-ships-native-typescript-the-end-of-build-steps-440f (HIGH)
- TypeScript 6.0 breaking changes — https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ , https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html (HIGH)
- Vitest vs node:test vs Jest (2026) + mocking/DI — https://www.pkgpulse.com/guides/node-test-vs-vitest-vs-jest-native-test-runner-2026 , https://vitest.dev/guide/mocking (HIGH/MEDIUM)
- Native fetch / undici + testability — https://undici.nodejs.org/ , https://github.com/nodejs/undici , https://www.pkgpulse.com/guides/axios-alternatives-2026-got-ky-undici , https://codewithhugo.com/node-test-native-fetch-intercept-undici/ (HIGH/MEDIUM)
- Pino vs Winston + pino-pretty (2026) — https://www.pkgpulse.com/guides/pino-vs-winston-2026 , https://betterstack.com/community/guides/logging/best-nodejs-logging-libraries/ (MEDIUM/HIGH)
- npm registry version checks (typescript 6.0.3→use ~5.9, tsx 4.22, vitest 4.1, pino 10.3, pino-pretty 13.1, biome 2.4, @types/node 25) — `npm view` 2026-06-08 (HIGH)

---
*Stack research for: TypeScript Node.js CLI bot (Dragons of Mugloar autoplay)*
*Researched: 2026-06-08*
