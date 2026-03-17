import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RestStorageAdapter } from "./rest-storage-adapter.js";

// ── fetch mock helpers ─────────────────────────────────────────────────────

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async (url: RequestInfo | URL, init?: RequestInit) =>
      handler(url.toString(), init),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

// ──────────────────────────────────────────────────────────────────────────

describe("RestStorageAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("storeNode", () => {
    it("sends POST /nodes with the correct payload", async () => {
      const spy = mockFetch(() => noContentResponse());
      const adapter = new RestStorageAdapter({ baseUrl: "https://api.example.com" });

      await adapter.storeNode("id-1", "FarmhandPresence", "ctx", '{"a":1}', "farmhand");

      expect(spy).toHaveBeenCalledOnce();
      const [url, init] = spy.mock.calls[0];
      expect(url).toBe("https://api.example.com/nodes");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        id: "id-1",
        type: "FarmhandPresence",
        context: "ctx",
        payload: '{"a":1}',
        sourcePlugin: "farmhand",
      });
    });

    it("includes custom headers in the request", async () => {
      const spy = mockFetch(() => noContentResponse());
      const adapter = new RestStorageAdapter({
        baseUrl: "https://api.example.com",
        headers: { Authorization: "Bearer secret" },
      });

      await adapter.storeNode("x", "T", "", "{}", null);

      const [, init] = spy.mock.calls[0];
      expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret");
    });

    it("throws on HTTP error", async () => {
      mockFetch(() => new Response(null, { status: 500 }));
      const adapter = new RestStorageAdapter({ baseUrl: "https://api.example.com" });

      await expect(adapter.storeNode("x", "T", "", "{}", null)).rejects.toThrow(
        "[storage-rest] POST /nodes → HTTP 500",
      );
    });
  });

  describe("queryNodes", () => {
    it("sends GET /nodes?type=<encoded> and returns the JSON array", async () => {
      const nodes = [{ id: "id-1", type: "FarmhandPresence" }];
      const spy = mockFetch(() => jsonResponse(nodes));
      const adapter = new RestStorageAdapter({ baseUrl: "https://api.example.com" });

      const result = await adapter.queryNodes("FarmhandPresence");

      expect(spy).toHaveBeenCalledOnce();
      const [url] = spy.mock.calls[0];
      expect(url).toBe("https://api.example.com/nodes?type=FarmhandPresence");
      expect(result).toEqual(nodes);
    });

    it("URL-encodes the type parameter", async () => {
      const spy = mockFetch(() => jsonResponse([]));
      const adapter = new RestStorageAdapter({ baseUrl: "https://api.example.com" });

      await adapter.queryNodes("My Type/With Spaces");

      const [url] = spy.mock.calls[0];
      expect(url).toContain("type=My%20Type%2FWith%20Spaces");
    });
  });

  describe("execute / query (SQL passthrough)", () => {
    it("returns [] without making any request when enableSql is false (default)", async () => {
      const spy = mockFetch(() => jsonResponse([]));
      const adapter = new RestStorageAdapter({ baseUrl: "https://api.example.com" });

      const result = await adapter.execute("SELECT 1");

      expect(spy).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("sends POST /sql when enableSql is true", async () => {
      const rows = [{ count: 5 }];
      const spy = mockFetch(() => jsonResponse(rows));
      const adapter = new RestStorageAdapter({
        baseUrl: "https://api.example.com",
        enableSql: true,
      });

      const result = await adapter.execute("SELECT count(*) FROM nodes", []);

      expect(spy).toHaveBeenCalledOnce();
      const [url, init] = spy.mock.calls[0];
      expect(url).toBe("https://api.example.com/sql");
      expect(JSON.parse(init?.body as string)).toEqual({
        sql: "SELECT count(*) FROM nodes",
        args: [],
      });
      expect(result).toEqual(rows);
    });

    it("query<T> delegates to execute", async () => {
      mockFetch(() => jsonResponse([{ id: "x" }]));
      const adapter = new RestStorageAdapter({
        baseUrl: "https://api.example.com",
        enableSql: true,
      });

      const result = await adapter.query<{ id: string }>("SELECT * FROM nodes");
      expect(result[0].id).toBe("x");
    });
  });

  describe("configuration", () => {
    it("strips trailing slash from baseUrl", async () => {
      const spy = mockFetch(() => noContentResponse());
      const adapter = new RestStorageAdapter({ baseUrl: "https://api.example.com/" });

      await adapter.storeNode("x", "T", "", "{}", null);

      const [url] = spy.mock.calls[0];
      expect(url).toBe("https://api.example.com/nodes");
    });

    it("respects custom endpoint paths", async () => {
      const spy = mockFetch(() => jsonResponse([]));
      const adapter = new RestStorageAdapter({
        baseUrl: "https://api.example.com",
        enableSql: true,
        endpoints: { storeNode: "/v2/nodes", sql: "/v2/query" },
      });

      await adapter.queryNodes("T");
      expect(spy.mock.calls[0][0]).toContain("/v2/nodes");

      await adapter.execute("SELECT 1");
      expect(spy.mock.calls[1][0]).toBe("https://api.example.com/v2/query");
    });
  });

  describe("lifecycle no-ops", () => {
    it("ensureSchema resolves without making any request", async () => {
      const spy = mockFetch(() => jsonResponse({}));
      const adapter = new RestStorageAdapter({ baseUrl: "https://api.example.com" });
      await expect(adapter.ensureSchema()).resolves.toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it("close resolves without making any request", async () => {
      const spy = mockFetch(() => jsonResponse({}));
      const adapter = new RestStorageAdapter({ baseUrl: "https://api.example.com" });
      await expect(adapter.close()).resolves.toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it("transaction calls the function and returns its result", async () => {
      const adapter = new RestStorageAdapter({ baseUrl: "https://api.example.com" });
      const result = await adapter.transaction(async () => 42);
      expect(result).toBe(42);
    });
  });
});
