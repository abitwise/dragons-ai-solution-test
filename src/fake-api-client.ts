/**
 * `FakeApiClient` — the hand-written, scripted test double implementing the
 * injectable `ApiClient` seam (D-07). It is the ONLY thing later phases wire in
 * tests (never `HttpApiClient`), so the entire downstream suite (Phases 2-3)
 * runs offline with ZERO live network calls — no `fetch`, no nock/msw.
 *
 * Design (D-07): the double is SCRIPTED / PROGRAMMABLE, NOT a stateful game
 * simulator. Its constructor takes one optional per-method response source for
 * each `ApiClient` method. A source is either:
 *   - an ARRAY of pre-built return values (a FIFO queue, dequeued via `shift`), or
 *   - a FUNCTION producing the next return value from the call's arguments.
 *
 * Each test scripts exactly the responses it needs — including a final
 * `lives: 0` solve result to drive Phase 3's "play to game-over" scenario. NO
 * game logic lives inside the double (no probability math, no state mutation, no
 * decode), so the double itself never needs trusting or testing for game
 * behavior; the included tests cover only its mechanical contract.
 *
 * Fail-loud (T-01-06): calling a method whose queue is exhausted (or was never
 * scripted) THROWS a clearly-named error rather than returning `undefined`, so a
 * mis-scripted test fails obviously instead of producing misleading green/garbage.
 *
 * This file performs NO I/O: no `fetch`, no `console`, no network anywhere. It is
 * test infrastructure and is never wired by the production composition root.
 */

import type { Ad, ApiClient, BuyResult, GameState, ShopItem, SolveResult } from "./types.js";

/**
 * A scripted source for one method: either a FIFO queue of pre-built values, or
 * a function producing the next value from the call's arguments.
 */
type Source<TArgs extends unknown[], TReturn> = TReturn[] | ((...args: TArgs) => TReturn);

/**
 * The constructor script: one optional per-method source. Every field is
 * optional — a method whose source is omitted throws if it is ever called, so a
 * test only scripts the methods it actually exercises.
 */
export interface FakeApiScript {
  startGame?: Source<[], GameState>;
  getMessages?: Source<[gameId: string], Ad[]>;
  solve?: Source<[gameId: string, adId: string], SolveResult>;
  getShop?: Source<[gameId: string], ShopItem[]>;
  buy?: Source<[gameId: string, itemId: string], BuyResult>;
}

/** A single recorded call — so a test can assert e.g. `solve` got the right adId. */
export interface RecordedCall {
  method: keyof FakeApiScript;
  args: unknown[];
}

export class FakeApiClient implements ApiClient {
  /**
   * Ordered log of every method call (method name + arguments), so a test can
   * assert "solve was called with adId X" without the double containing any
   * game logic. Optional to consume — present for tests that want it.
   */
  readonly calls: RecordedCall[] = [];

  constructor(private readonly script: FakeApiScript = {}) {}

  // Each method is `async` so a fail-loud throw inside `next` (exhausted/absent
  // queue) surfaces as a REJECTED promise — the idiomatic contract for a
  // Promise-returning API — instead of a synchronous throw that an `await`ing
  // caller could not `.catch`.
  async startGame(): Promise<GameState> {
    return this.next("startGame", []);
  }

  async getMessages(gameId: string): Promise<Ad[]> {
    return this.next("getMessages", [gameId]);
  }

  async solve(gameId: string, adId: string): Promise<SolveResult> {
    return this.next("solve", [gameId, adId]);
  }

  async getShop(gameId: string): Promise<ShopItem[]> {
    return this.next("getShop", [gameId]);
  }

  async buy(gameId: string, itemId: string): Promise<BuyResult> {
    return this.next("buy", [gameId, itemId]);
  }

  /**
   * Records the call, then resolves the next scripted value for `method`:
   *   - function source → invoked with the call's args,
   *   - array source    → `shift`ed (FIFO),
   *   - missing source / empty queue → THROWS naming the method (fail loud).
   */
  private next<K extends keyof FakeApiScript>(method: K, args: unknown[]): SourceReturn<K> {
    this.calls.push({ method, args });

    const source = this.script[method];
    if (source === undefined) {
      throw new Error(
        `FakeApiClient: no scripted response for ${method} (method was never scripted)`,
      );
    }

    if (typeof source === "function") {
      // Cast is local and safe: FakeApiScript pairs each method key with a
      // function whose params/return match this method's signature.
      return (source as (...a: unknown[]) => SourceReturn<K>)(...args);
    }

    if (source.length === 0) {
      throw new Error(`FakeApiClient: no scripted response for ${method} (queue exhausted)`);
    }

    // `shift` is non-undefined here: the length check above guarantees an element.
    return source.shift() as SourceReturn<K>;
  }
}

/** The return type produced by the source for a given method key. */
type SourceReturn<K extends keyof FakeApiScript> = K extends "startGame"
  ? GameState
  : K extends "getMessages"
    ? Ad[]
    : K extends "solve"
      ? SolveResult
      : K extends "getShop"
        ? ShopItem[]
        : K extends "buy"
          ? BuyResult
          : never;
