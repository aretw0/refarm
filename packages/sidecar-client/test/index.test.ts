import { describe, expect, it, vi } from "vitest";
import {
	createPressureClient,
	createSidecarGraphClient,
	fetchSidecarJson,
	fetchSidecarWithTimeout,
	resolveSidecarRequestTimeoutMs,
	SIDECAR_REQUEST_TIMEOUT_ENV_VAR,
	SidecarHttpError,
} from "../src/index.js";

describe("sidecar-client", () => {
	it("resolves the sidecar timeout from its own env var, else the default", () => {
		expect(
			resolveSidecarRequestTimeoutMs({ [SIDECAR_REQUEST_TIMEOUT_ENV_VAR]: "1200" }),
		).toBe(1200);
		expect(resolveSidecarRequestTimeoutMs({})).toBe(500);
	});

	it("fetches through the injected fetch impl (domain-owned, no reimplementation)", async () => {
		const fetchMock = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => new Response("ok", { status: 200 }),
		);
		const res = await fetchSidecarWithTimeout(
			"http://127.0.0.1:42001/efforts",
			{},
			{ fetch: fetchMock as unknown as typeof fetch },
		);
		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url] = fetchMock.mock.calls[0]!;
		expect(String(url)).toBe("http://127.0.0.1:42001/efforts");
	});

	it("reads JSON through the sidecar timeout wrapper", async () => {
		const fetchImpl = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) =>
				new Response(JSON.stringify({ ok: true, value: 42 }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);

		await expect(
			fetchSidecarJson<{ ok: boolean; value: number }>(
				"http://sidecar.test/status",
				{},
				{ fetch: fetchImpl as unknown as typeof fetch },
			),
		).resolves.toEqual({ ok: true, value: 42 });
		expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
			"http://sidecar.test/status",
		);
	});

	it("throws a status-labelled error when JSON requests fail", async () => {
		const fetchImpl = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => new Response(JSON.stringify({ error: "nope" }), { status: 503 }),
		);

		await expect(
			fetchSidecarJson("http://sidecar.test/status", {}, {
				errorLabel: "custom HTTP",
				fetch: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toThrow("custom HTTP 503");

		await expect(
			fetchSidecarJson("http://sidecar.test/status", {}, {
				errorLabel: "custom HTTP",
				fetch: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({
			constructor: SidecarHttpError,
			errorLabel: "custom HTTP",
			status: 503,
		});
	});

	it("reads graph nodes from the sidecar node endpoint", async () => {
		const node = {
			"@context": "https://schema.org/",
			"@id": "urn:graph:one",
			"@type": "Config",
		};
		const fetchImpl = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) =>
				new Response(JSON.stringify({ node }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const graph = createSidecarGraphClient("http://sidecar.test/", {
			fetch: fetchImpl as unknown as typeof fetch,
		});

		await expect(graph.getNode("urn:graph:one")).resolves.toEqual(node);
		expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
			"http://sidecar.test/nodes/urn%3Agraph%3Aone",
		);
	});

	it("returns null when a graph node is not present", async () => {
		const fetchImpl = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => new Response("", { status: 404 }),
		);
		const graph = createSidecarGraphClient("http://sidecar.test", {
			fetch: fetchImpl as unknown as typeof fetch,
		});

		await expect(graph.getNode("urn:graph:missing")).resolves.toBeNull();
	});

	it("queries graph nodes by type with an explicit limit", async () => {
		const nodes = [
			{
				"@context": "https://schema.org/",
				"@id": "urn:graph:one",
				"@type": "Config",
			},
			{
				"@context": "https://schema.org/",
				"@id": "urn:graph:two",
				"@type": "Config",
			},
		];
		const fetchImpl = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) =>
				new Response(JSON.stringify({ nodes, total: 2 }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const graph = createSidecarGraphClient("http://sidecar.test", {
			fetch: fetchImpl as unknown as typeof fetch,
		});

		// This mocked response (like `total` above) carries no `stored`/`truncated` —
		// the live shape of a sidecar built before those fields shipped. They must
		// come back `undefined`, not defaulted; see the dedicated block below.
		await expect(graph.queryNodes("Config", { limit: 2 })).resolves.toEqual({
			nodes,
			stored: undefined,
			truncated: undefined,
		});
		expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
			"http://sidecar.test/nodes?type=Config&limit=2",
		);
	});

	// ── queryNodes: stored/truncated, three states not two ──────────────────────
	//
	// `GET /nodes` now reports `stored` (the true count of this @type in storage)
	// and `truncated` (whether this page left rows out) alongside `nodes`
	// (docs/SOVEREIGN_RECORD_ORDERING.md). A sidecar built before that shipped
	// omits both keys — a live case, not a hypothetical one — and a caller
	// talking to that node has no basis to say the page is complete. The
	// defect this guards against already happened once this session
	// (`apps/refarm/src/commands/budget.ts` briefly defaulted `truncated` to
	// `false` and `stored` to `nodes.length` in exactly this gap): absent must
	// stay absent, never rounded to a boolean or derived from the page size.
	describe("queryNodes reports stored/truncated without defaulting", () => {
		const oneNode = {
			"@context": "https://schema.org/",
			"@id": "urn:graph:one",
			"@type": "Config",
		};

		function fetchReturning(body: Record<string, unknown>) {
			return vi.fn(
				async (
					_input: Parameters<typeof fetch>[0],
					_init?: Parameters<typeof fetch>[1],
				) =>
					new Response(JSON.stringify(body), {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
			);
		}

		it("carries stored and truncated through when the sidecar reports both", async () => {
			const graph = createSidecarGraphClient("http://sidecar.test", {
				fetch: fetchReturning({
					nodes: [oneNode],
					stored: 5,
					truncated: true,
				}) as unknown as typeof fetch,
			});

			await expect(graph.queryNodes("Config")).resolves.toEqual({
				nodes: [oneNode],
				stored: 5,
				truncated: true,
			});
		});

		it("reports stored and truncated as undefined — never defaulted — when an older sidecar omits both", async () => {
			const graph = createSidecarGraphClient("http://sidecar.test", {
				fetch: fetchReturning({ nodes: [oneNode] }) as unknown as typeof fetch,
			});

			const result = await graph.queryNodes("Config");
			expect(result.nodes).toEqual([oneNode]);
			// The trap: a defaulting implementation would report `truncated: false`
			// and/or `stored: result.nodes.length` here. Neither is correct — nobody
			// said either thing, so the answer is "unknown", not "no".
			expect(result.stored).toBeUndefined();
			expect(result.truncated).toBeUndefined();
		});

		it("keeps truncated as reported even when stored is absent", async () => {
			const graph = createSidecarGraphClient("http://sidecar.test", {
				fetch: fetchReturning({
					nodes: [oneNode],
					truncated: true,
				}) as unknown as typeof fetch,
			});

			const result = await graph.queryNodes("Config");
			expect(result.truncated).toBe(true);
			expect(result.stored).toBeUndefined();
		});
	});

	it("rejects malformed graph node responses with a useful message", async () => {
		const fetchImpl = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) =>
				new Response(JSON.stringify({ node: { "@id": "urn:graph:one" } }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const graph = createSidecarGraphClient("http://sidecar.test", {
			fetch: fetchImpl as unknown as typeof fetch,
		});

		await expect(graph.getNode("urn:graph:one")).rejects.toThrow(
			"sidecar graph response missing node",
		);
	});

	it("reads pressure snapshots and windows from the sidecar", async () => {
		const snapshot = {
			queueDepth: 1,
			inFlight: 2,
			cancelRequests: 0,
			generatedAt: "2026-07-08T00:00:00.000Z",
			total: 3,
			pending: 1,
			inProgress: 2,
			done: 0,
			failed: 0,
			cancelled: 0,
		};
		const window = {
			windowMinutes: 30,
			since: "2026-07-07T23:30:00.000Z",
			terminal: 2,
			failureRatePct: 0,
			generatedAt: "2026-07-08T00:00:00.000Z",
			total: 2,
			pending: 0,
			inProgress: 0,
			done: 2,
			failed: 0,
			cancelled: 0,
		};
		const fetchImpl = vi.fn(
			async (
				input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => {
				const url = String(input);
				if (url.endsWith("/telemetry")) {
					return new Response(JSON.stringify(snapshot), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				if (url.endsWith("/telemetry/window?minutes=30")) {
					return new Response(JSON.stringify(window), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
			},
		);
		const pressure = createPressureClient("http://sidecar.test/", {
			fetch: fetchImpl as unknown as typeof fetch,
		});

		await expect(pressure.getSnapshot()).resolves.toEqual(snapshot);
		await expect(pressure.getWindow(30)).resolves.toEqual(window);
		expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
			"http://sidecar.test/telemetry",
			"http://sidecar.test/telemetry/window?minutes=30",
		]);
	});

	it("treats missing pressure windows as unavailable", async () => {
		const fetchImpl = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => new Response("", { status: 404 }),
		);
		const pressure = createPressureClient("http://sidecar.test", {
			fetch: fetchImpl as unknown as typeof fetch,
		});

		await expect(pressure.getWindow(60)).resolves.toBeNull();
	});

	it("labels pressure HTTP failures", async () => {
		const fetchImpl = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
		);
		const pressure = createPressureClient("http://sidecar.test", {
			fetch: fetchImpl as unknown as typeof fetch,
		});

		await expect(pressure.getSnapshot()).rejects.toMatchObject({
			constructor: SidecarHttpError,
			errorLabel: "pressure HTTP",
			status: 503,
		});
	});

	// ── FARM_TOKEN → Authorization bearer (device auth gate) ────────────────────

	it("adds no Authorization header when FARM_TOKEN is unset", async () => {
		const fetchMock = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => new Response("ok", { status: 200 }),
		);

		await fetchSidecarWithTimeout(
			"http://sidecar.test/x",
			{},
			{ fetch: fetchMock as unknown as typeof fetch, env: {} },
		);

		const init = fetchMock.mock.calls[0]?.[1];
		expect(init?.headers).toBeUndefined();
		expect(new Headers(init?.headers).has("authorization")).toBe(false);
	});

	it("treats an empty-string FARM_TOKEN as unset (no header added)", async () => {
		const fetchMock = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => new Response("ok", { status: 200 }),
		);

		await fetchSidecarWithTimeout(
			"http://sidecar.test/x",
			{},
			{ fetch: fetchMock as unknown as typeof fetch, env: { FARM_TOKEN: "" } },
		);

		const init = fetchMock.mock.calls[0]?.[1];
		expect(new Headers(init?.headers).has("authorization")).toBe(false);
	});

	it("adds Authorization: Bearer <token> when FARM_TOKEN is set", async () => {
		const fetchMock = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => new Response("ok", { status: 200 }),
		);

		await fetchSidecarWithTimeout(
			"http://sidecar.test/x",
			{},
			{ fetch: fetchMock as unknown as typeof fetch, env: { FARM_TOKEN: "secret-device-token" } },
		);

		const init = fetchMock.mock.calls[0]?.[1];
		expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-device-token");
	});

	it.each<[string, HeadersInit]>([
		["a Headers instance", new Headers({ Authorization: "Bearer caller-supplied" })],
		["an array of pairs", [["Authorization", "Bearer caller-supplied"]]],
		["a plain object", { Authorization: "Bearer caller-supplied" }],
		["a plain object with a lowercase key", { authorization: "Bearer caller-supplied" }],
	])(
		"never clobbers a caller-supplied Authorization header (%s)",
		async (_label, callerHeaders) => {
			const fetchMock = vi.fn(
				async (
					_input: Parameters<typeof fetch>[0],
					_init?: Parameters<typeof fetch>[1],
				) => new Response("ok", { status: 200 }),
			);

			await fetchSidecarWithTimeout(
				"http://sidecar.test/x",
				{ headers: callerHeaders },
				{ fetch: fetchMock as unknown as typeof fetch, env: { FARM_TOKEN: "secret-device-token" } },
			);

			const init = fetchMock.mock.calls[0]?.[1];
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer caller-supplied");
		},
	);

	it("never logs the token or includes it in a thrown error's message", async () => {
		const token = "must-never-leak-3f9a";
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchMock = vi.fn(async () => {
			throw new Error("network unreachable");
		});

		try {
			const rejection = await fetchSidecarWithTimeout(
				"http://sidecar.test/x",
				{},
				{ fetch: fetchMock as unknown as typeof fetch, env: { FARM_TOKEN: token } },
			).catch((err: unknown) => err);

			expect(rejection).toBeInstanceOf(Error);
			expect(String((rejection as Error).message)).not.toContain(token);
			expect(String((rejection as Error).stack)).not.toContain(token);

			for (const spy of [logSpy, errorSpy, warnSpy]) {
				for (const call of spy.mock.calls) {
					expect(call.map((arg) => String(arg)).join(" ")).not.toContain(token);
				}
			}
		} finally {
			logSpy.mockRestore();
			errorSpy.mockRestore();
			warnSpy.mockRestore();
		}
	});
});
