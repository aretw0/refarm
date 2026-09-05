import {
	createEventStreamHandler,
	isCapabilityGroup,
	type CapabilityDescriptor,
	type EventStreamSource,
} from "@refarm.dev/capabilities";
import { describe, expect, it } from "vitest";

import {
	buildCapabilityHostServeInfo,
	defaultRecordsDeps,
	defaultSourceDeps,
	defaultVaultDeps,
	mountCapabilities,
	mountedCliCommands,
	serveCapabilities,
	type CapabilityDeps,
} from "./index.js";

function deps(): CapabilityDeps {
	return {
		source: defaultSourceDeps(),
		vault: defaultVaultDeps({
			discover: () => ({ providers: [], rejected: [] }),
			submitEffort: async (e) => e.id,
		}),
		records: defaultRecordsDeps(),
	};
}

const myVerb: CapabilityDescriptor = {
	name: "hello",
	summary: "a work verb",
	run: () => ({ ok: true }) as never,
};

describe("mountCapabilities — the consumer-mount seam", () => {
	it("composes the neutral built-ins with the app's own verbs", () => {
		const registry = mountCapabilities({ deps: deps(), verbs: [myVerb] });
		const names = registry.list().map((e) => e.name);
		expect(names).toEqual(expect.arrayContaining(["source", "records", "vault", "hello"]));
	});

	it("surfaces a plugin manifest's verb via the bridge (extension path)", () => {
		const registry = mountCapabilities({
			deps: deps(),
			manifests: [{ id: "@w/x", capabilities: { provides: ["x:go"], subscribes: ["x:dispatch"] } }],
			pluginDeps: {
				submitEffort: async (e) => e.id,
				newId: () => "id-1",
				nowIso: () => "2026-01-01T00:00:00Z",
			},
		});
		expect(registry.list().map((e) => e.name)).toContain("x-go");
	});

	it("throws if manifests are given without pluginDeps", () => {
		expect(() =>
			mountCapabilities({
				deps: deps(),
				manifests: [
					{ id: "@w/x", capabilities: { provides: ["x:go"], subscribes: ["x:dispatch"] } },
				],
			}),
		).toThrow(/pluginDeps/);
	});

	it("projects the mounted registry onto CLI commands", () => {
		const registry = mountCapabilities({ deps: deps(), verbs: [myVerb] });
		const commandNames = mountedCliCommands(registry).map((c) => c.name());
		expect(commandNames).toContain("hello");
		// The neutral source group projects as a top-level command too.
		const source = registry.list().find((e) => e.name === "source");
		expect(source && isCapabilityGroup(source)).toBe(true);
	});

	it("serves the mounted registry over HTTP — a verb's route responds", async () => {
		// A verb declaring transports.http becomes a live endpoint via serveCapabilities.
		const httpVerb: CapabilityDescriptor = {
			name: "ping",
			summary: "http verb",
			transports: { http: { method: "GET", path: "/ping" } },
			renderers: { palette: { group: "tools", keybind: "g p" } } as never,
			run: () => ({ ok: true, pong: true }) as never,
		};
		const registry = mountCapabilities({ deps: deps(), verbs: [httpVerb] });
		const { listening, close } = serveCapabilities(registry, { port: 0 });
		try {
			const { port } = await listening;
			const res = await fetch(`http://127.0.0.1:${port}/capabilities/ping`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { ok: boolean; pong: boolean };
			expect(body.ok).toBe(true);
			expect(body.pong).toBe(true);

			// The agent-tools introspection route is served too.
			const tools = await fetch(`http://127.0.0.1:${port}/agent-tools`);
			expect(tools.status).toBe(200);

			// The palette (quick-switcher) route serves the renderers.palette verbs — no
			// longer orphaned. The ping verb opted in and appears under its group.
			const palette = await fetch(`http://127.0.0.1:${port}/palette`);
			expect(palette.status).toBe(200);
			const paletteBody = (await palette.json()) as {
				groups: { group: string; entries: { name: string; keybind?: string }[] }[];
			};
			const tools_group = paletteBody.groups.find((g) => g.group === "tools");
			expect(tools_group?.entries.find((e) => e.name === "ping")?.keybind).toBe("g p");

			// The OpenAPI route is generated from the same registry metadata.
			const openapi = await fetch(`http://127.0.0.1:${port}/openapi.json`);
			expect(openapi.status).toBe(200);
			const spec = (await openapi.json()) as {
				openapi: string;
				paths: Record<string, unknown>;
			};
			expect(spec.openapi).toBe("3.1.0");
			expect(Object.keys(spec.paths)).toContain("/capabilities/ping");

			// An unknown path 404s.
			const missing = await fetch(`http://127.0.0.1:${port}/capabilities/nope`);
			expect(missing.status).toBe(404);
		} finally {
			await close();
		}
	});

	it("a verb whose run() never resolves gets a 504 (never hangs the client)", async () => {
		// The hanging footgun: a run() that never resolves would hold the socket forever.
		// serveCapabilities' request timeout is the net — it must respond 504.
		const hangVerb: CapabilityDescriptor = {
			name: "hang",
			summary: "never resolves",
			transports: { http: { method: "GET", path: "/hang" } },
			run: () => new Promise(() => {}) as never, // never settles
		};
		const registry = mountCapabilities({ deps: deps(), verbs: [hangVerb] });
		const { listening, close } = serveCapabilities(registry, {
			port: 0,
			requestTimeoutMs: 200, // short so the test is fast
		});
		try {
			const { port } = await listening;
			const res = await fetch(`http://127.0.0.1:${port}/capabilities/hang`);
			expect(res.status).toBe(504);
			const body = (await res.json()) as { ok: boolean; error: string };
			expect(body.ok).toBe(false);
			expect(body.error).toBe("capability-timeout");
		} finally {
			await close();
		}
	});

	it("streams SSE via a routeHandler and the stream survives the request timeout until it ends", async () => {
		// The source sends one event, then (PAST the short request timeout) a second event + ends. If the
		// streaming-timeout fix regressed, the server would destroy the socket at 150ms and res.text() would
		// reject / miss the second frame; with the fix the stream lives until the source ends at ~250ms.
		const source: EventStreamSource = {
			subscribe(send, end) {
				send({ event: "agent:prompt:start", ts: 1 });
				const timer = setTimeout(() => {
					send({ event: "agent:tool:call", ts: 2 });
					end();
				}, 250);
				return () => clearTimeout(timer);
			},
		};
		const registry = mountCapabilities({ deps: deps(), verbs: [] });
		const { listening, close } = serveCapabilities(registry, {
			port: 0,
			requestTimeoutMs: 150, // an SSE stream must OUTLIVE this, not get 504'd + destroyed
			routeHandlers: [createEventStreamHandler("/agent/events", source)],
		});
		try {
			const { port } = await listening;
			const res = await fetch(`http://127.0.0.1:${port}/agent/events`);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("text/event-stream");
			const body = await res.text(); // resolves when the source ends (~250ms), well past the 150ms timeout
			expect(body).toContain('data: {"event":"agent:prompt:start","ts":1}');
			expect(body).toContain('data: {"event":"agent:tool:call","ts":2}');
		} finally {
			await close();
		}
	});
});

describe("serveCapabilities bind safety", () => {
	// This surface is the SDK primitive every consuming app serves its verbs from, so a bind
	// mistake here is inherited by every app rather than made once. It used to call
	// `server.listen(port, cb)` with NO host — Node binds every interface — and there was no
	// host option in the signature at all, so a consumer could not choose loopback even
	// deliberately.

	function registry() {
		return mountCapabilities({ deps: deps(), verbs: [] });
	}

	it("binds loopback when the caller says nothing", async () => {
		const { server, listening, close } = serveCapabilities(registry(), { port: 0 });
		try {
			const { host, port } = await listening;
			expect(host).toBe("127.0.0.1");

			// Not just what it REPORTS — what the OS says it bound. Mutation guard: reverting
			// to a host-less `listen(port, cb)` makes this `0.0.0.0` and the test fails.
			const address = server.address();
			expect(typeof address === "object" && address ? address.address : null).toBe(
				"127.0.0.1",
			);

			const res = await fetch(`http://127.0.0.1:${port}/agent-tools`);
			expect(res.status).toBe(200);
		} finally {
			await close();
		}
	});

	it("lets a caller choose loopback explicitly — the option exists", async () => {
		const { listening, close } = serveCapabilities(registry(), { port: 0, host: "127.0.0.1" });
		try {
			const { host } = await listening;
			expect(host).toBe("127.0.0.1");
		} finally {
			await close();
		}
	});

	it("REFUSES a non-loopback bind with no auth policy configured", async () => {
		delete process.env.REFARM_AUTH_POLICY;
		const { listening, close } = serveCapabilities(registry(), { port: 0, host: "0.0.0.0" });
		try {
			await expect(listening).rejects.toThrow(/no auth policy configured/);
			// It must refuse BEFORE opening anything — nothing is listening to clean up.
			await expect(listening).rejects.toThrow(/0\.0\.0\.0/);
		} finally {
			await close();
		}
	});

	it("refuses a tailnet-shaped host too, not just 0.0.0.0", async () => {
		delete process.env.REFARM_AUTH_POLICY;
		const { listening, close } = serveCapabilities(registry(), { port: 0, host: "100.64.0.1" });
		try {
			await expect(listening).rejects.toThrow(/refusing to bind/);
		} finally {
			await close();
		}
	});

	it("reports the bound host in serve info instead of assuming 127.0.0.1", () => {
		// buildCapabilityHostServeInfo hardcoded loopback, so a widened bind printed a URL
		// that pointed somewhere else than where the surface was.
		expect(buildCapabilityHostServeInfo(4321).url).toBe("http://127.0.0.1:4321");
		expect(buildCapabilityHostServeInfo(4321, { host: "100.64.0.1" }).url).toBe(
			"http://100.64.0.1:4321",
		);
		expect(buildCapabilityHostServeInfo(4321, { host: "::1" }).url).toBe("http://[::1]:4321");
	});
});
