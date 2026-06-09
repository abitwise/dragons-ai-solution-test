/**
 * RED→GREEN tests for `HttpApiClient` — the ONLY module that calls `fetch`.
 *
 * Every test STUBS `globalThis.fetch` (via `vi.spyOn`) — there is NO live
 * network, no nock/msw, no real HTTP. The backoff `delay` is injected as a
 * no-op so the retry suite stays instant and offline.
 *
 * Coverage (mirrors the plan's <behavior>):
 *   - reward coercion: a string `reward` becomes a number Ad.reward
 *   - encrypted decode integration: an `encrypted:1` ad arrives Base64-decoded
 *   - encodeURIComponent: a `/`-containing adId is %2F-encoded in the solve URL
 *   - retry policy: reads (messages/shop/startGame) retry on 5xx; solve/buy do NOT
 *   - error taxonomy: HTML (non-JSON) error body → typed BoundaryError, not SyntaxError
 *   - ZodError is terminal: a schema-failing 200 body bypasses retry (exactly 1 fetch)
 *   - success-is-a-body-field: HTTP 200 + `success:false` resolves as a failed SolveResult
 *   - base URL: defaults to the non-www host; MUGLOAR_BASE_URL overrides it
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoundaryError, HttpApiClient, TransportError } from "./api.js";

/** A no-op backoff so retry tests don't actually sleep. */
const noDelay = () => Promise.resolve();

/**
 * Build a `Response`-like object good enough for the client: status, ok, and
 * `text()`/`json()`. The client reads non-2xx bodies as TEXT (tolerating HTML)
 * and 2xx bodies as JSON, so both are provided.
 */
function makeResponse(status: number, body: unknown): Response {
  const ok = status >= 200 && status < 300;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

/** Spy installed on `globalThis.fetch` in each test; restored after. */
let fetchSpy: ReturnType<typeof vi.spyOn>;

function stubFetch(): ReturnType<typeof vi.spyOn> {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  return fetchSpy;
}

beforeEach(() => {
  // Default to the non-www base by clearing any inherited override.
  delete process.env.MUGLOAR_BASE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MUGLOAR_BASE_URL;
});

/** Base64-encode a string for building encrypted-ad fixtures (inverse of decode). */
function base64Encode(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

describe("HttpApiClient", () => {
  describe("schemas & coercion", () => {
    it("coerces a string reward to a number before it enters the Ad model", async () => {
      stubFetch().mockResolvedValueOnce(
        makeResponse(200, [
          {
            adId: "a1",
            message: "Help",
            reward: "100", // string on the wire — must become number 100
            expiresIn: 3,
            encrypted: null,
            probability: "Sure thing",
          },
        ]),
      );

      const client = new HttpApiClient({ delay: noDelay });
      const ads = await client.getMessages("g1");

      expect(ads).toHaveLength(1);
      expect(ads[0]?.reward).toBe(100);
      expect(typeof ads[0]?.reward).toBe("number");
    });

    it("tolerates an unknown encrypted scheme (optional number, not a 1|2 union)", async () => {
      stubFetch().mockResolvedValueOnce(
        makeResponse(200, [
          {
            adId: "a1",
            message: "Help",
            reward: 50,
            expiresIn: 2,
            encrypted: 7, // unknown scheme — must validate, not throw
            probability: "Gamble",
          },
        ]),
      );

      const client = new HttpApiClient({ delay: noDelay });
      const ads = await client.getMessages("g1");

      // Unknown scheme stays flagged (decodeAd passes it through unchanged).
      expect(ads[0]?.encrypted).toBe(7);
    });
  });

  describe("decode integration (getMessages → decodeAd)", () => {
    it("Base64-decodes an encrypted:1 ad across all three fields and clears the flag", async () => {
      stubFetch().mockResolvedValueOnce(
        makeResponse(200, [
          {
            adId: base64Encode("ad-42"),
            message: base64Encode("Slay the dragon"),
            reward: 200,
            expiresIn: 4,
            encrypted: 1,
            probability: base64Encode("Sure thing"),
          },
        ]),
      );

      const client = new HttpApiClient({ delay: noDelay });
      const ads = await client.getMessages("g1");

      expect(ads[0]?.adId).toBe("ad-42");
      expect(ads[0]?.message).toBe("Slay the dragon");
      expect(ads[0]?.probability).toBe("Sure thing");
      // Flag cleared after a handled decode.
      expect(ads[0]?.encrypted ?? 0).toBe(0);
    });
  });

  describe("URL encoding (encodeURIComponent on path segments)", () => {
    it("encodes a /-, +-, =-containing adId so the solve URL segment is %2F-safe", async () => {
      const spy = stubFetch().mockResolvedValueOnce(
        makeResponse(200, {
          success: true,
          lives: 3,
          gold: 100,
          score: 50,
          highScore: 50,
          turn: 1,
          message: "Done",
        }),
      );

      const client = new HttpApiClient({ delay: noDelay });
      await client.solve("g1", "a/b+c=d");

      const url = String(spy.mock.calls[0]?.[0]);
      // The adId is encodeURIComponent'd: no raw "/" in the id segment.
      expect(url).toContain(encodeURIComponent("a/b+c=d"));
      expect(url).toContain("%2F");
      // The path up to "/solve/" stays literal; the id after it is encoded.
      expect(url).not.toContain("solve/a/b");
    });

    it("encodes the gameId segment too", async () => {
      const spy = stubFetch().mockResolvedValueOnce(makeResponse(200, []));

      const client = new HttpApiClient({ delay: noDelay });
      await client.getMessages("g/1");

      const url = String(spy.mock.calls[0]?.[0]);
      expect(url).toContain(encodeURIComponent("g/1"));
    });
  });

  describe("retry policy (D-04/D-05)", () => {
    it("retries idempotent reads on 5xx: 500, 500, then 200 succeeds", async () => {
      const spy = stubFetch()
        .mockResolvedValueOnce(makeResponse(500, "<html>err</html>"))
        .mockResolvedValueOnce(makeResponse(500, "<html>err</html>"))
        .mockResolvedValueOnce(makeResponse(200, []));

      const client = new HttpApiClient({ delay: noDelay });
      const ads = await client.getMessages("g1");

      expect(ads).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it("retries on a thrown network/transport error, then succeeds", async () => {
      const spy = stubFetch()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce(makeResponse(200, [{ id: "hpot", name: "Healing potion", cost: 50 }]));

      const client = new HttpApiClient({ delay: noDelay });
      const shop = await client.getShop("g1");

      expect(shop[0]?.id).toBe("hpot");
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("startGame is an idempotent read and retries on 5xx", async () => {
      const spy = stubFetch()
        .mockResolvedValueOnce(makeResponse(500, "<html>err</html>"))
        .mockResolvedValueOnce(
          makeResponse(200, {
            gameId: "g1",
            lives: 3,
            gold: 0,
            level: 0,
            score: 0,
            highScore: 0,
            turn: 0,
          }),
        );

      const client = new HttpApiClient({ delay: noDelay });
      const state = await client.startGame();

      expect(state.gameId).toBe("g1");
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("eventually throws a TransportError when every read attempt 5xxes", async () => {
      const spy = stubFetch().mockResolvedValue(makeResponse(500, "<html>err</html>"));

      const client = new HttpApiClient({ delay: noDelay });
      await expect(client.getMessages("g1")).rejects.toBeInstanceOf(TransportError);
      // Bounded: a fixed number of attempts (~3), not an unbounded loop.
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it("does NOT retry solve on 5xx — exactly one fetch call, then surfaces", async () => {
      const spy = stubFetch().mockResolvedValue(makeResponse(500, "<html>err</html>"));

      const client = new HttpApiClient({ delay: noDelay });
      await expect(client.solve("g1", "a1")).rejects.toBeDefined();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry buy on 5xx — exactly one fetch call, then surfaces", async () => {
      const spy = stubFetch().mockResolvedValue(makeResponse(500, "<html>err</html>"));

      const client = new HttpApiClient({ delay: noDelay });
      await expect(client.buy("g1", "hpot")).rejects.toBeDefined();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("error taxonomy & HTML bodies (D-06, PITFALLS #5)", () => {
    it("surfaces a 400 with an HTML body as a BoundaryError, not a raw SyntaxError", async () => {
      stubFetch().mockResolvedValueOnce(
        makeResponse(400, "<html><body>Bad Request</body></html>"),
      );

      const client = new HttpApiClient({ delay: noDelay });
      await expect(client.solve("g1", "bad")).rejects.toBeInstanceOf(BoundaryError);
    });

    it("treats a ZodError (schema drift on a 200 body) as terminal — bypasses retry (1 fetch)", async () => {
      // 200 OK but the body is the wrong shape (missing required ad fields).
      const spy = stubFetch().mockResolvedValue(makeResponse(200, [{ nope: true }]));

      const client = new HttpApiClient({ delay: noDelay });
      await expect(client.getMessages("g1")).rejects.toBeInstanceOf(BoundaryError);
      // No retry on a parse failure — exactly one fetch despite this being a read.
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("solve success is a body field, not HTTP status (PITFALLS #5)", () => {
    it("HTTP 200 + body success:false resolves as a FAILED SolveResult (no throw)", async () => {
      stubFetch().mockResolvedValueOnce(
        makeResponse(200, {
          success: false,
          lives: 2,
          gold: 10,
          score: 0,
          highScore: 0,
          turn: 5,
          message: "You failed",
        }),
      );

      const client = new HttpApiClient({ delay: noDelay });
      const result = await client.solve("g1", "a1");

      expect(result.success).toBe(false);
      expect(result.lives).toBe(2);
      expect(result.gold).toBe(10);
      expect(result.turn).toBe(5);
      expect(result.message).toBe("You failed");
    });

    it("HTTP 200 + body success:true resolves as a successful SolveResult", async () => {
      stubFetch().mockResolvedValueOnce(
        makeResponse(200, {
          success: true,
          lives: 3,
          gold: 110,
          score: 60,
          highScore: 60,
          turn: 6,
          message: "Well done",
        }),
      );

      const client = new HttpApiClient({ delay: noDelay });
      const result = await client.solve("g1", "a1");

      expect(result.success).toBe(true);
      expect(result.score).toBe(60);
    });
  });

  describe("buy → merged GameState", () => {
    it("folds the buy result (level, no score) into a GameState", async () => {
      stubFetch().mockResolvedValueOnce(
        makeResponse(200, {
          shoppingSuccess: true,
          gold: 50,
          lives: 3,
          level: 1,
          turn: 7,
        }),
      );

      const client = new HttpApiClient({ delay: noDelay });
      const state = await client.buy("g1", "cs");

      expect(state.gameId).toBe("g1");
      expect(state.level).toBe(1);
      expect(state.gold).toBe(50);
      expect(state.lives).toBe(3);
      expect(state.turn).toBe(7);
    });
  });

  describe("base URL config (non-www default + MUGLOAR_BASE_URL override)", () => {
    it("defaults to the non-www host https://dragonsofmugloar.com/api/v2", async () => {
      const spy = stubFetch().mockResolvedValueOnce(makeResponse(200, []));

      const client = new HttpApiClient({ delay: noDelay });
      await client.getMessages("g1");

      const url = String(spy.mock.calls[0]?.[0]);
      expect(url.startsWith("https://dragonsofmugloar.com/api/v2")).toBe(true);
      expect(url).not.toContain("www.");
    });

    it("uses MUGLOAR_BASE_URL when set (read once at construction)", async () => {
      process.env.MUGLOAR_BASE_URL = "https://example.test/api/v2";
      const spy = stubFetch().mockResolvedValueOnce(makeResponse(200, []));

      const client = new HttpApiClient({ delay: noDelay });
      await client.getMessages("g1");

      const url = String(spy.mock.calls[0]?.[0]);
      expect(url.startsWith("https://example.test/api/v2")).toBe(true);
    });

    it("an explicit baseUrl option overrides both env and default", async () => {
      const spy = stubFetch().mockResolvedValueOnce(makeResponse(200, []));

      const client = new HttpApiClient({ baseUrl: "https://override.test/api/v2", delay: noDelay });
      await client.getMessages("g1");

      const url = String(spy.mock.calls[0]?.[0]);
      expect(url.startsWith("https://override.test/api/v2")).toBe(true);
    });
  });
});
