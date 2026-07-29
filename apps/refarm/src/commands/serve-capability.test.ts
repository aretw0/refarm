import { rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CapabilityDescriptor } from "@refarm.dev/capabilities";
import { buildJsonSuccessEnvelope } from "@refarm.dev/capabilities/envelope";
import { afterEach, describe, expect, it } from "vitest";

import { createServeServer, startServeServer } from "./serve-capability.js";

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

describe("startServeServer — the bind seam (--host)", () => {
	it("binds loopback by default and reports the bound url", async () => {
		const started = await startServeServer(ENTRIES, { port: 0, host: "127.0.0.1" });
		server = started.server;
		expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		const res = await fetch(`${started.url}/agent-tools`);
		expect(res.status).toBe(200);
	});

	it("REFUSES a non-loopback bind with no auth policy — and opens nothing", async () => {
		// PURE: the guard throws before the server object exists, so no socket is opened and
		// there is nothing to close.
		delete process.env.REFARM_AUTH_POLICY;
		await expect(startServeServer(ENTRIES, { port: 0, host: "0.0.0.0" })).rejects.toThrow(
			/no auth policy configured/,
		);
		await expect(startServeServer(ENTRIES, { port: 0, host: "100.64.0.1" })).rejects.toThrow(
			/refusing to bind/,
		);
	});

	it("honors an explicit host once an auth policy is configured", async () => {
		// The LAN exposure is still an operator decision — now one with a prerequisite. NOTE
		// the honest limit: a policy gates the BIND here, not the requests. This surface has
		// no bearer check of its own (the Rust sidecar's `auth_middleware` is the only place
		// that verifies a credential today), so a widened bind here is opened on the
		// operator's word. Wiring the check in is tracked under ADR-093.
		const policy = path.join(tmpdir(), `refarm-serve-capability-policy-${process.pid}.json`);
		writeFileSync(policy, JSON.stringify({ credentials: [] }));
		process.env.REFARM_AUTH_POLICY = policy;
		try {
			const started = await startServeServer(ENTRIES, { port: 0, host: "0.0.0.0" });
			server = started.server;
			expect(started.url).toMatch(/^http:\/\/0\.0\.0\.0:\d+$/);
			// A 0.0.0.0 bind answers on loopback too — prove the socket is real.
			const port = started.url.split(":").pop();
			const res = await fetch(`http://127.0.0.1:${port}/agent-tools`);
			expect(res.status).toBe(200);
		} finally {
			delete process.env.REFARM_AUTH_POLICY;
			rmSync(policy, { force: true });
		}
	});
});
