import { describe, expect, it, vi } from "vitest";
import {
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
				errorLabel: "runtime HTTP",
				fetch: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toThrow("runtime HTTP 503");

		await expect(
			fetchSidecarJson("http://sidecar.test/status", {}, {
				errorLabel: "runtime HTTP",
				fetch: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({
			constructor: SidecarHttpError,
			errorLabel: "runtime HTTP",
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

		await expect(graph.queryNodes("Config", { limit: 2 })).resolves.toEqual(nodes);
		expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
			"http://sidecar.test/nodes?type=Config&limit=2",
		);
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
});
