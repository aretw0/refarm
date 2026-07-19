/** @vitest-environment jsdom */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import {
	capabilityToolParameters,
	createCapabilityRegistry,
	createCapabilityRouteHandler,
	dispatchCapability,
	validateCapabilityArgs,
	type CapabilityDescriptor,
} from "@refarm.dev/capabilities";
import { describe, expect, it } from "vitest";

import { wireCapabilityFormDispatch } from "./boot.js";
import { renderCapabilityFormMessage } from "./index.js";

/**
 * The defining invariant, PROVEN in one place: a capability declared once is validated the SAME way on
 * every surface. One verb, one derived JSON Schema, one invalid input — rejected identically (naming the
 * same field) by the shared validator, the CLI/TUI/chat dispatch, the HTTP route (422), and the web form.
 *
 * The agent tool + plugin→plugin legs validate that SAME `capabilityToolParameters` object host-side in
 * Rust (jsonschema): see `tractor`'s `validate_tool_input` tests + the cross-language verbSchema fixture
 * that proves the derived schema is byte-identical across TS and Rust. So the 6 surfaces share one schema.
 */

/** One verb with a typed schema: a required string arg + an integer option. */
const searchVerb: CapabilityDescriptor = {
	name: "search",
	summary: "Search things",
	args: [{ name: "query", required: true }],
	options: [{ name: "limit", kind: "integer" }],
	transports: { http: { method: "POST", path: "/search" } },
	renderers: { web: {}, tui: { section: "actions" } },
	run: async () => ({ ok: true }) as never,
};
const registry = createCapabilityRegistry([searchVerb]);
const entry = registry.get("search")!;

// ONE invalid input: `limit` is a float where the schema demands an integer. Every surface must reject it
// (a `<input type=number>` accepts "5.5", so the web form reaches the validator with it — unlike "abc").
const BAD = { query: "notes", limit: "5.5" };
const fieldsOf = (errors: ReadonlyArray<{ field: string }> = []): string[] => errors.map((e) => e.field);

function mockReq(method: string, path: string, body: unknown): IncomingMessage {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage & {
		url: string;
		method: string;
	};
	req.url = path;
	req.method = method;
	return req;
}

function mockRes(): { res: ServerResponse; done: Promise<{ status: number; body: { errors?: Array<{ field: string }> } }> } {
	let resolveDone!: (value: { status: number; body: { errors?: Array<{ field: string }> } }) => void;
	const done = new Promise<{ status: number; body: { errors?: Array<{ field: string }> } }>((resolve) => {
		resolveDone = resolve;
	});
	let status = 0;
	const res = {
		writeHead(code: number) {
			status = code;
			return this;
		},
		end(payload?: string) {
			resolveDone({ status, body: payload ? JSON.parse(payload) : {} });
		},
	} as unknown as ServerResponse;
	return { res, done };
}

describe("the one-schema invariant — declare once, validated the same on every surface", () => {
	it("derives ONE JSON Schema for the agent tool (the object the Rust legs validate against)", () => {
		expect(capabilityToolParameters(searchVerb)).toEqual({
			type: "object",
			properties: { query: { type: "string" }, limit: { type: "integer" } },
			required: ["query"],
		});
	});

	it("the shared validator rejects the bad input, naming `limit`", () => {
		const validation = validateCapabilityArgs(searchVerb, BAD);
		expect(validation.valid).toBe(false);
		expect(fieldsOf(validation.errors)).toContain("limit");
	});

	it("the CLI/TUI/chat dispatch rejects it, naming `limit`", async () => {
		const outcome = await dispatchCapability(entry, ["notes", "--limit", "5.5"]);
		expect(outcome.status).toBe("invalid");
		expect(fieldsOf(outcome.validation?.errors)).toContain("limit");
	});

	it("the HTTP route rejects it with 422, naming `limit`", async () => {
		const handler = createCapabilityRouteHandler([entry]);
		const { res, done } = mockRes();
		const handled = handler(mockReq("POST", "/search", { args: { query: "notes" }, options: { limit: "5.5" } }), res);
		expect(handled).toBe(true);
		const { status, body } = await done;
		expect(status).toBe(422);
		expect(fieldsOf(body.errors)).toContain("limit");
	});

	it("the web form rejects it, painting an inline error on the `limit` field", () => {
		document.body.innerHTML = `<div id="invariant"></div>`;
		const container = document.getElementById("invariant")!;
		container.innerHTML = renderCapabilityFormMessage(registry, "search");
		wireCapabilityFormDispatch(container, registry, () => {});
		(container.querySelector('[data-refarm-arg="query"]') as HTMLInputElement).value = "notes";
		(container.querySelector('[data-refarm-option="limit"]') as HTMLInputElement).value = "5.5";
		container.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
		// The same field the other three surfaces named is flagged inline — one schema, one rejection.
		expect(container.querySelector('[data-refarm-field-error="limit"]')).not.toBeNull();
	});
});
