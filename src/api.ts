/**
 * `HttpApiClient` — the ONE module that touches `fetch`, and the production
 * implementation of the injectable `ApiClient` seam.
 *
 * This is the external-API edge. ALL of the following live here and NOWHERE
 * else, so strategy/runner never learn about HTTP, retry, or coercion:
 *   - one co-located zod schema per endpoint (D-01), validating the RAW wire
 *     shape with light coercion only (D-02): `z.coerce.number()` for the
 *     string-typed `reward`; `encrypted` typed as an OPTIONAL number (not a
 *     strict 1|2 union) so an unknown scheme validates rather than throwing;
 *   - a small error taxonomy: `TransportError` (retryable 5xx/network) vs
 *     `BoundaryError` (terminal: non-2xx body, JSON-parse failure, or ZodError);
 *   - a single private `request<T>` helper — the ONLY `fetch` call site —
 *     with a per-request AbortSignal timeout (T-01-07) and bounded
 *     retry-with-backoff for idempotent reads only (D-04), never for
 *     solve/buy (D-05);
 *   - `encodeURIComponent` on EVERY path segment (PITFALLS #2, T-01-10) so a
 *     `/`/`+`/`=` in an id cannot alter the route;
 *   - the non-www base URL with a `MUGLOAR_BASE_URL` env override read ONCE at
 *     construction — never from an API response (SSRF guard, T-01-08);
 *   - the `success` body field (NOT the HTTP status) as the source of truth for
 *     a solve — a 200 with `success:false` is a well-formed FAILED result, not
 *     an error (PITFALLS #5);
 *   - decode integration: `getMessages` maps each validated ad through
 *     `decodeAd` (a SEPARATE step after zod, per D-03) before returning.
 */

import { z } from "zod";
import { decodeAd } from "./decode.js";
import type { Ad, ApiClient, GameState, ShopItem, SolveResult } from "./types.js";

/** The non-www host — `www.` returned nginx 404s in live testing (locked carry-forward). */
const DEFAULT_BASE_URL = "https://dragonsofmugloar.com/api/v2";

/** Retry budget for idempotent reads (D-04): the initial try plus retries. */
const MAX_READ_ATTEMPTS = 3;

/** Per-attempt backoff base; attempt N waits N * this (kept short; injectable in tests). */
const BACKOFF_MS = 250;

/** Per-request timeout so a hung connection can't stall the bot forever (T-01-07). */
const REQUEST_TIMEOUT_MS = 10_000;

// --------------------------------------------------------------------------
// Error taxonomy (D-06)
// --------------------------------------------------------------------------

/**
 * A RETRYABLE failure at the transport layer: a 5xx response or a thrown
 * network error. Reads retry on this; solve/buy surface it immediately.
 */
export class TransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TransportError";
  }
}

/**
 * A TERMINAL failure at the trust boundary: a non-2xx response (whose body may
 * be HTML, not JSON), a JSON-parse failure, or a zod validation failure (schema
 * drift). NEVER retried — it bubbles to the caller for a clean game-over (D-06).
 */
export class BoundaryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "BoundaryError";
  }
}

// --------------------------------------------------------------------------
// Per-endpoint zod schemas (D-01/D-02) — co-located, raw wire shape only
// --------------------------------------------------------------------------

/** `POST /game/start` → the game-info object threaded across turns. */
const gameStartSchema = z.object({
  gameId: z.string(),
  lives: z.number(),
  gold: z.number(),
  level: z.number(),
  score: z.number(),
  highScore: z.number(),
  turn: z.number(),
});

/**
 * A single ad from `GET /{gameId}/messages`. `reward` is coerced from a possibly
 * string-typed wire value (D-02); `encrypted` is an OPTIONAL number tolerating
 * an unknown scheme — `null` (plaintext) is normalized away so the Ad model
 * carries `encrypted?: number`.
 */
const adSchema = z.object({
  adId: z.string(),
  message: z.string(),
  reward: z.coerce.number(),
  expiresIn: z.number(),
  probability: z.string(),
  encrypted: z
    .number()
    .nullish()
    .transform((v) => v ?? undefined),
});

const messagesSchema = z.array(adSchema);

/**
 * `POST /{gameId}/solve/{adId}`. `success` is validated as a boolean and the
 * full result state — a `success:false` body is a SUCCESSFUL parse yielding a
 * SolveResult whose `success` is false (never inferred from the HTTP status).
 */
const solveSchema = z.object({
  success: z.boolean(),
  lives: z.number(),
  gold: z.number(),
  score: z.number(),
  highScore: z.number(),
  turn: z.number(),
  message: z.string(),
});

/** `GET /{gameId}/shop` → catalog items. */
const shopItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  cost: z.number(),
});

const shopSchema = z.array(shopItemSchema);

/**
 * `POST /{gameId}/shop/buy/{itemId}`. Note the solve/buy asymmetry: buy returns
 * `level` and has NO `score`/`highScore`.
 */
const buySchema = z.object({
  shoppingSuccess: z.boolean(),
  gold: z.number(),
  lives: z.number(),
  level: z.number(),
  turn: z.number(),
});

// --------------------------------------------------------------------------
// HttpApiClient
// --------------------------------------------------------------------------

/** Constructor options — all optional; sensible offline-friendly defaults. */
export interface HttpApiClientOptions {
  /**
   * Override the base URL explicitly. Precedence: this option > the
   * `MUGLOAR_BASE_URL` env var > the non-www default. Read ONCE here; never
   * from an API response (SSRF guard, T-01-08).
   */
  baseUrl?: string;
  /** Injectable backoff so tests run instantly; defaults to a real timed sleep. */
  delay?: (ms: number) => Promise<void>;
}

/** The real sleep used in production; tests inject a no-op. */
function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(options: HttpApiClientOptions = {}) {
    // Base URL is resolved ONCE, here, from operator-controlled sources only.
    this.baseUrl = (options.baseUrl ?? process.env.MUGLOAR_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.delay = options.delay ?? realDelay;
  }

  async startGame(): Promise<GameState> {
    // game/start is idempotent (a failed start just yields a fresh game) → retry.
    return this.request("POST", "/game/start", gameStartSchema, { retry: true });
  }

  async getMessages(gameId: string): Promise<Ad[]> {
    const path = `/${seg(gameId)}/messages`;
    const ads = await this.request("GET", path, messagesSchema, { retry: true });
    // Decode is a SEPARATE step AFTER zod validation (D-03): each validated ad
    // is mapped through decodeAd so a handled encrypted ad arrives decoded and
    // an unhandled one stays flagged for the strategy filter.
    return ads.map(decodeAd);
  }

  async solve(gameId: string, adId: string): Promise<SolveResult> {
    // POST /solve is turn-consuming and non-idempotent → NEVER auto-retried (D-05).
    const path = `/${seg(gameId)}/solve/${seg(adId)}`;
    return this.request("POST", path, solveSchema, { retry: false });
  }

  async getShop(gameId: string): Promise<ShopItem[]> {
    const path = `/${seg(gameId)}/shop`;
    return this.request("GET", path, shopSchema, { retry: true });
  }

  async buy(gameId: string, itemId: string): Promise<GameState> {
    // POST /buy is turn-consuming and non-idempotent → NEVER auto-retried (D-05).
    const path = `/${seg(gameId)}/shop/buy/${seg(itemId)}`;
    const result = await this.request("POST", path, buySchema, { retry: false });
    // Fold the buy result (level/gold/lives/turn — NO score) into a GameState.
    // score/highScore are not returned by buy, so they are merged elsewhere
    // (applyResult, Phase 2); here they default to 0 for the standalone shape.
    return {
      gameId,
      lives: result.lives,
      gold: result.gold,
      level: result.level,
      score: 0,
      highScore: 0,
      turn: result.turn,
    };
  }

  /**
   * The ONE place `fetch` is called. Builds the full URL from the base URL plus
   * `path` (whose segments the caller already `encodeURIComponent`'d), applies
   * an AbortSignal timeout, and:
   *   - on a 5xx or thrown network error, retries up to MAX_READ_ATTEMPTS with
   *     bounded backoff WHEN `retry` is true (reads), and not at all when false
   *     (solve/buy) — wrapping the final failure as a TransportError;
   *   - on a non-2xx response, reads the body as TEXT (tolerating HTML — never
   *     assume JSON on non-2xx) and throws a terminal BoundaryError;
   *   - on a 2xx response, parses JSON and runs the zod schema, wrapping any
   *     ZodError (or JSON-parse failure) as a terminal BoundaryError so it
   *     bypasses retry (D-06).
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    opts: { retry: boolean },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const maxAttempts = opts.retry ? MAX_READ_ATTEMPTS : 1;
    let lastTransportError: TransportError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (cause) {
        // A thrown fetch = network/transport failure → retryable.
        lastTransportError = new TransportError(
          `Network error calling ${method} ${path}`,
          undefined,
          {
            cause,
          },
        );
        if (attempt < maxAttempts) {
          await this.delay(attempt * BACKOFF_MS);
          continue;
        }
        throw lastTransportError;
      }

      // 5xx is a retryable transport-layer failure.
      if (response.status >= 500) {
        lastTransportError = new TransportError(
          `Server error ${response.status} calling ${method} ${path}`,
          response.status,
        );
        if (attempt < maxAttempts) {
          await this.delay(attempt * BACKOFF_MS);
          continue;
        }
        throw lastTransportError;
      }

      // Any other non-2xx (e.g. 400) is TERMINAL. Read as TEXT — the body may be
      // HTML, not JSON — and surface a typed BoundaryError (never crash on a
      // JSON.parse of an HTML page).
      if (!response.ok) {
        const body = await safeText(response);
        throw new BoundaryError(
          `Boundary error ${response.status} calling ${method} ${path}: ${truncate(body)}`,
          response.status,
        );
      }

      // 2xx: parse JSON then validate. A JSON-parse failure or a ZodError is
      // TERMINAL (schema drift) — wrap and throw, bypassing retry (D-06).
      let json: unknown;
      try {
        json = await response.json();
      } catch (cause) {
        throw new BoundaryError(`Malformed JSON from ${method} ${path}`, response.status, {
          cause,
        });
      }

      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new BoundaryError(
          `Schema validation failed for ${method} ${path}: ${parsed.error.message}`,
          response.status,
          { cause: parsed.error },
        );
      }
      return parsed.data;
    }

    // Unreachable in practice (the loop always returns or throws), but satisfies
    // the type checker and guards against a misconfigured attempt count.
    throw lastTransportError ?? new TransportError(`Request failed: ${method} ${path}`);
  }
}

/** `encodeURIComponent` one path segment (PITFALLS #2 / T-01-10). */
function seg(value: string): string {
  return encodeURIComponent(value);
}

/** Read a response body as text without throwing (used on the non-2xx path). */
async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** Truncate an (untrusted, possibly large HTML) error body for a clean message. */
function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
