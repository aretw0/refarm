import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { buildJsonSuccessEnvelope } from "../json-output.js";
import {
	buildCapabilityRoutes,
	createCapabilityRouteHandler,
} from "./http-projector.js";
import type { CapabilityDescriptor, CapabilityGroup } from "./types.js";

function descriptor(
	name: string,
	overrides: Partial<CapabilityDescriptor> = {},
): CapabilityDescriptor {
	return {
		name,
		summary: `${name} summary`,
		run: (input) =>
			buildJsonSuccessEnvelope({
				command: name,
				operation: "run",
				extra: { echo: input.args },
			}),
		...overrides,
	};
}

/** A fake request carrying a JSON body over the async-iterable stream contract. */
function fakeReq(method: string, path: string, body?: unknown) {
	const stream = Readable.from([
		body === undefined ? "" : JSON.stringify(body),
	]) as unknown as import("node:http").IncomingMessage;
	stream.method = method;
	stream.url = path;
	return stream;
}

function fakeRes() {
	const res = {
		statusCode: 0,
		body: "",
		writeHead(status: number) {
			this.statusCode = status;
			return this;
		},
		end(payload?: string) {
			if (payload) this.body = payload;
		},
	};
	return res as unknown as import("node:http").ServerResponse & {
		statusCode: number;
		body: string;
	};
}

describe("buildCapabilityRoutes (transports.http bucket)", () => {
	it("makes a route per entry that declares transports.http", () => {
		const routes = buildCapabilityRoutes([
			descriptor("model", {
				transports: { http: { method: "POST", path: "/model" } },
			}),
			descriptor("noweb"), // no transports.http → no route
		]);
		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({ method: "POST", path: "/model" });
	});

	it("prefixes routes and defaults the method to POST", () => {
		const [route] = buildCapabilityRoutes(
			[descriptor("skills", { transports: { http: { path: "/skills" } } })],
			"/capabilities",
		);
		expect(route).toMatchObject({ method: "POST", path: "/capabilities/skills" });
	});

	it("routes a group through its default action", () => {
		const group: CapabilityGroup = {
			name: "skill",
			summary: "skill group",
			actions: { list: descriptor("list") },
			defaultAction: "list",
			transports: { http: { method: "GET", path: "/skills" } },
		};
		const routes = buildCapabilityRoutes([group]);
		expect(routes).toHaveLength(1);
		expect(routes[0]?.method).toBe("GET");
	});
});

describe("createCapabilityRouteHandler", () => {
	const handler = createCapabilityRouteHandler(
		[
			descriptor("model", {
				transports: { http: { method: "POST", path: "/model" } },
			}),
		],
		{ prefix: "/capabilities" },
	);

	it("returns false for an unmatched route (composes with other handlers)", () => {
		expect(handler(fakeReq("GET", "/other"), fakeRes())).toBe(false);
	});

	it("invokes run() and writes the envelope verbatim as the body (200)", async () => {
		const res = fakeRes();
		expect(
			handler(fakeReq("POST", "/capabilities/model", { args: { ref: "x" } }), res),
		).toBe(true);
		await new Promise((r) => setImmediate(r));
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body).toMatchObject({ ok: true, command: "model", echo: { ref: "x" } });
	});

	it("maps an error envelope to 422", async () => {
		const errHandler = createCapabilityRouteHandler([
			descriptor("bad", {
				transports: { http: { method: "POST", path: "/bad" } },
				run: () => ({ ok: false, error: "nope" }) as never,
			}),
		]);
		const res = fakeRes();
		errHandler(fakeReq("POST", "/bad", {}), res);
		await new Promise((r) => setImmediate(r));
		expect(res.statusCode).toBe(422);
	});

	it("wraps a thrown run() as a 500 JSON error, never a bare crash", async () => {
		const throwHandler = createCapabilityRouteHandler([
			descriptor("boom", {
				transports: { http: { method: "POST", path: "/boom" } },
				run: () => {
					throw new Error("kaboom");
				},
			}),
		]);
		const res = fakeRes();
		throwHandler(fakeReq("POST", "/boom", {}), res);
		await new Promise((r) => setImmediate(r));
		expect(res.statusCode).toBe(500);
		expect(JSON.parse(res.body)).toMatchObject({
			ok: false,
			error: "capability-run-failed",
		});
	});

	it("rejects a malformed JSON body with 400", async () => {
		const res = fakeRes();
		const req = Readable.from(["{ not json"]) as unknown as import("node:http").IncomingMessage;
		req.method = "POST";
		req.url = "/capabilities/model";
		handler(req, res);
		await new Promise((r) => setImmediate(r));
		expect(res.statusCode).toBe(400);
	});
});
