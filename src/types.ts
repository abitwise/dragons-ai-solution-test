/**
 * Shared data models and the two injectable interfaces (`ApiClient`, `Logger`)
 * for the Dragons of Mugloar autoplay bot.
 *
 * This file is the LEAF of the dependency graph: it contains ONLY type
 * declarations — no logic, no runtime values, and no runtime imports
 * (never `fetch`, `zod`, or `pino`). Every other module imports its
 * dependencies' shapes from here, and tests fake the same `ApiClient`
 * interface that production wires to `HttpApiClient`.
 */

/**
 * The game-info object threaded across turns. Created by `startGame`, then
 * re-derived (not mutated) from each solve/buy result.
 *
 * Field asymmetry to be aware of when merging results:
 *   - a solve result omits `level`
 *   - a buy result omits `score`/`highScore`
 * so state must be MERGED, not replaced (the merge itself — `applyResult` —
 * lands in Phase 2; the typed models that make it possible are defined here).
 */
export interface GameState {
  gameId: string;
  lives: number;
  gold: number;
  level: number;
  score: number;
  highScore: number;
  turn: number;
}

/**
 * A single ad/quest from `GET /{gameId}/messages`.
 *
 * `reward` is already coerced to a number by the API boundary (the raw wire
 * value can be a string; the coercion happens in `api.ts`, not here).
 *
 * `probability` is free-text descriptive label (e.g. "Sure thing", "Hmmm....",
 * "Suicide mission"). It is deliberately typed as a plain `string`, NOT a
 * string-literal union, so an unknown/new label still type-checks — the rank
 * lookup (Phase 2) treats unknown labels as "worst" rather than crashing.
 *
 * `encrypted` is an OPTIONAL number (per D-02), NOT a strict `1 | 2` union, so
 * an unknown scheme still validates rather than throwing. On the wire it is
 * `null` for plaintext ads, otherwise `1` (Base64) or `2` (ROT13). After a
 * successful `decodeAd`, a handled ad has this cleared (undefined/0); an
 * unhandled ad retains its flag so the strategy filter (Phase 2) can drop it.
 */
export interface Ad {
  adId: string;
  message: string;
  reward: number;
  expiresIn: number;
  probability: string;
  encrypted?: number;
}

/** A single shop catalog item from `GET /{gameId}/shop`. */
export interface ShopItem {
  id: string;
  name: string;
  cost: number;
}

/**
 * The result of `POST /{gameId}/solve/{adId}`.
 *
 * NOTE: a solve result has NO `level` field — that is the half of the
 * solve/buy asymmetry handled at merge time. The body's `success` boolean
 * (not the HTTP status) is the source of truth for whether the ad was solved.
 */
export interface SolveResult {
  success: boolean;
  lives: number;
  gold: number;
  score: number;
  highScore: number;
  turn: number;
  message: string;
}

/**
 * The raw wire shape of `POST /{gameId}/shop/buy/{itemId}`.
 *
 * NOTE: a buy result has NO `score`/`highScore` but DOES carry `level` — the
 * mirror image of `SolveResult`. `ApiClient.buy()` returns this RAW shape; the
 * caller folds it into the threaded `GameState` via `applyBuyResult` (which
 * carries the prior `score`/`highScore` forward), mirroring how `solve()`
 * returns a raw `SolveResult` folded by `applySolveResult`. `shoppingSuccess`
 * is `false` when gold is insufficient (state unchanged, no error).
 */
export interface BuyResult {
  shoppingSuccess: boolean;
  gold: number;
  lives: number;
  level: number;
  turn: number;
}

/** The final summary returned when a game ends (lives reach 0 or a guard trips). */
export interface GameReport {
  score: number;
  turns: number;
  reason: string;
}

/**
 * The injectable API seam — the single most important interface in the
 * codebase. Consumers (runner, strategy) depend on THIS interface, never on
 * `HttpApiClient`. Production wires `HttpApiClient` (the only `fetch` caller);
 * tests wire a hand-written `FakeApiClient`. No HTTP-mocking library is used.
 *
 * `buy` returns the raw `BuyResult` (`shoppingSuccess`/`gold`/`lives`/`level`/
 * `turn`); the caller (the Phase-3 runner) folds it into the threaded
 * `GameState` via `applyBuyResult`, mirroring `solve()` → `applySolveResult`.
 * All methods return typed models, never raw JSON.
 */
export interface ApiClient {
  startGame(): Promise<GameState>;
  getMessages(gameId: string): Promise<Ad[]>;
  solve(gameId: string, adId: string): Promise<SolveResult>;
  getShop(gameId: string): Promise<ShopItem[]>;
  buy(gameId: string, itemId: string): Promise<BuyResult>;
}

/**
 * Leveled, human-readable logging interface. The runner depends on this
 * interface, not on `console`, so tests can pass a silent/spy logger and CI
 * stays quiet. Each method takes a message plus optional structured args.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
