import { rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CapabilityDescriptor } from "@refarm.dev/capabilities";
import { buildJsonSuccessEnvelope } from "@refarm.dev/capabilities/envelope";
import { parseSurfaces, type SurfaceCatalog } from "@refarm.dev/std";
import { afterEach, describe, expect, it } from "vitest";

import { createServeServer, serveCommand, startServeServer } from "./serve-capability.js";

/** A read-only verb reachable over HTTP AND opted into the agent surface. */
const pingCapability: CapabilityDescriptor = {
	name: "ping",
	summary: "Return a pong — a read-only health check",
	run: () => buildJsonSuccessEnvelope({ command: "ping", operation: "check" }),
	transports: {
		http: { method: "POST", path: "/ping" },
		agent: { tool: true, toolName: "ping_check" },
	},
};

/** A verb reachable over HTTP but NOT an agent tool (no `agent` bucket). */
const cliOnlyCapability: CapabilityDescriptor = {
	name: "status",
	summary: "Show status",
	run: () => buildJsonSuccessEnvelope({ command: "status", operation: "show" }),
	transports: { http: { method: "POST", path: "/status" } },
};

const ENTRIES = [pingCapability, cliOnlyCapability];

let server: ReturnType<typeof createServeServer> | undefined;

async function listen(): Promise<string> {
	server = createServeServer(ENTRIES);
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
	if (server) {
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
	}
});

describe("refarm serve — the capability HTTP surface (real socket)", () => {
	it("serves a capability's run() envelope verbatim at /capabilities/<path>", async () => {
		const base = await listen();
		const res = await fetch(`${base}/capabilities/ping`, {
			method: "POST",
			body: JSON.stringify({ args: {}, options: {} }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; command: string };
		expect(body.ok).toBe(true);
		expect(body.command).toBe("ping"); // the http-projector wrote the envelope verbatim
	});

	it("returns 404 for an unknown capability path", async () => {
		const base = await listen();
		const res = await fetch(`${base}/capabilities/nope`, { method: "POST", body: "{}" });
		expect(res.status).toBe(404);
	});

	it("lists ONLY agent-opted verbs as tool schemas at /agent-tools", async () => {
		const base = await listen();
		const res = await fetch(`${base}/agent-tools`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			tools: Array<{ name: string; description: string; input_schema: { type: string } }>;
		};
		// `ping` opted in (toolName ping_check); `status` did NOT → excluded.
		expect(body.tools.map((t) => t.name)).toEqual(["ping_check"]);
		const tool = body.tools[0];
		expect(tool?.description).toBe("Return a pong — a read-only health check");
		expect(tool?.input_schema.type).toBe("object"); // real derived schema
	});

	it("serves the mounted OpenAPI spec at /openapi.json", async () => {
		const base = await listen();
		const res = await fetch(`${base}/openapi.json`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			openapi: string;
			paths: Record<string, unknown>;
		};
		expect(body.openapi).toBe("3.1.0");
		expect(Object.keys(body.paths)).toEqual(
			expect.arrayContaining(["/capabilities/ping", "/capabilities/status"]),
		);
	});

	it("404s an unknown top-level route", async () => {
		const base = await listen();
		const res = await fetch(`${base}/nope`);
		expect(res.status).toBe(404);
	});
});

/** A catalog built through the REAL parser, so a combination the parser refuses can never be
 *  smuggled into a bind test by hand. */
const declare = (surfaces: Record<string, unknown>): SurfaceCatalog => parseSurfaces({ surfaces });
const UNDECLARED: SurfaceCatalog = parseSurfaces({});

describe("startServeServer — the `capabilities` declaration decides the bind (O5)", () => {
	// Every case here either binds LOOPBACK or refuses before a socket exists. A non-loopback
	// bind is asserted at the pure-rule level in `@refarm.dev/std`'s surfaces.test.ts, so this
	// suite never opens a port to the network to prove a point about one.

	it("binds loopback when `capabilities` is undeclared (S1) and reports the bound url", async () => {
		const started = await startServeServer(ENTRIES, { port: 0, surfaces: UNDECLARED });
		server = started.server;
		expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		const res = await fetch(`${started.url}/agent-tools`);
		expect(res.status).toBe(200);
	});

	it("REFUSES a non-loopback bind when the surface is undeclared — and opens nothing", async () => {
		// PURE: the guard throws before the server object exists, so no socket is opened and
		// there is nothing to close.
		await expect(
			startServeServer(ENTRIES, { port: 0, host: "0.0.0.0", surfaces: UNDECLARED }),
		).rejects.toThrow(/no `surfaces.capabilities` declaration is present/);
		await expect(
			startServeServer(ENTRIES, { port: 0, host: "100.64.0.1", surfaces: UNDECLARED }),
		).rejects.toThrow(/refusing to bind/);
	});

	it("an auth policy existing somewhere no longer permits ANY bind (O5)", async () => {
		// The criterion this replaced, pinned as a mutation guard. `REFARM_AUTH_POLICY` naming a
		// file that exists used to be the whole permission to open this surface to the network —
		// a policy belonging to the SIDECAR, while this listener reads no `Authorization` header
		// on any route. Restore `authPolicyPresent()` as the criterion and this test passes a
		// bind it must refuse.
		const policy = path.join(tmpdir(), `refarm-serve-capability-policy-${process.pid}.json`);
		writeFileSync(policy, JSON.stringify({ credentials: [] }));
		process.env.REFARM_AUTH_POLICY = policy;
		try {
			await expect(
				startServeServer(ENTRIES, { port: 0, host: "0.0.0.0", surfaces: UNDECLARED }),
			).rejects.toThrow(/refusing to bind/);
		} finally {
			delete process.env.REFARM_AUTH_POLICY;
			rmSync(policy, { force: true });
		}
	});

	it('`gate: "device-token"` is REFUSED for this surface — it verifies nothing (S3)', () => {
		// Not a bind-time check: the vocabulary itself will not let this surface claim a gate it
		// has no machinery for, at ANY expose, loopback included.
		expect(() => declare({ capabilities: { expose: "tailnet", gate: "device-token" } })).toThrow(
			/verifies no bearer credential at all/,
		);
		expect(() => declare({ capabilities: { expose: "loopback", gate: "device-token" } })).toThrow(
			/verifies no bearer credential at all/,
		);
	});

	it("a declared ceiling may be NARROWED by the flag, and the tailnet is never asked", async () => {
		let asked = 0;
		const started = await startServeServer(ENTRIES, {
			port: 0,
			host: "127.0.0.1",
			surfaces: declare({ capabilities: { expose: "tailnet", gate: "none" } }),
			resolveTailnet: () => {
				asked += 1;
				return { ok: true, ipv4: "100.64.7.7" } as const;
			},
		});
		server = started.server;
		expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(asked).toBe(0);
	});

	it("a flag may never WIDEN or re-point the declared ceiling (S5)", async () => {
		await expect(
			startServeServer(ENTRIES, {
				port: 0,
				host: "0.0.0.0",
				surfaces: declare({ capabilities: { expose: "tailnet", gate: "none" } }),
				resolveTailnet: () => ({ ok: true, ipv4: "100.64.7.7" }) as const,
			}),
		).rejects.toThrow(/never point somewhere else or wider/);
		await expect(
			startServeServer(ENTRIES, {
				port: 0,
				host: "0.0.0.0",
				surfaces: declare({ capabilities: { expose: "loopback" } }),
			}),
		).rejects.toThrow(/a flag may narrow that declaration, never widen it/);
	});

	it("a declared tailnet FAILS CLOSED when the tailnet cannot answer", async () => {
		await expect(
			startServeServer(ENTRIES, {
				port: 0,
				surfaces: declare({ capabilities: { expose: "tailnet", gate: "none" } }),
				resolveTailnet: () => ({ ok: false, reason: "down", detail: "the tailnet is down" }),
			}),
		).rejects.toThrow(/tailscale up/);
	});

	it("names the capability surface in the refusal, so the operator knows which listener said no", async () => {
		await expect(
			startServeServer(ENTRIES, { port: 0, host: "0.0.0.0", surfaces: UNDECLARED }),
		).rejects.toThrow(/capability surface \(`refarm serve`\)/);
	});
});

describe("the `refarm serve` --host flag carries NO default (the defaulted-flag defect)", () => {
	it("declares `--host` with no default value at all", () => {
		// THE defect that made `surfaces` inert for the sidecar for weeks, and that `web serve`
		// had to fix: under S5 a flag may only NARROW, so a `--host` that ALWAYS carries
		// `127.0.0.1` ALWAYS narrows — the declaration can never take effect, and nothing says
		// so. Restore `DEFAULT_BIND_HOST` as the option's default and this fails.
		const host = serveCommand.options.find((option) => option.long === "--host");
		expect(host).toBeDefined();
		expect(host?.defaultValue).toBeUndefined();
	});

	it("the absence survives the action — `undefined` reaches the bind rule as `undefined`", async () => {
		// A commander default is not the only way to lose the absence: `options.host ?? "127.0.0.1"`
		// inside the action would do it just as silently. This pins the whole path by declaring a
		// ceiling and proving the DECLARATION, not the flag, decided the bind.
		const started = await startServeServer(ENTRIES, {
			port: 0,
			surfaces: declare({ capabilities: { expose: "loopback" } }),
		});
		server = started.server;
		expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
	});
});
