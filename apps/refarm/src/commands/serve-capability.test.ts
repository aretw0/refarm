import type { AddressInfo } from "node:net";

import type { CapabilityDescriptor } from "@refarm.dev/cli/capabilities";
import { buildJsonSuccessEnvelope } from "@refarm.dev/cli/json-output";
import { afterEach, describe, expect, it } from "vitest";

import { createServeServer } from "./serve-capability.js";

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
