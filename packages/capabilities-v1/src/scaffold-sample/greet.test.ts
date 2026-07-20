import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import {
	capabilityToolParameters,
	createCapabilityRegistry,
	createCapabilityRouteHandler,
	dispatchCapability,
	validateCapabilityArgs,
} from "@refarm.dev/capabilities";
import { describe, expect, it } from "vitest";

import { greetCapability } from "./greet.js";

const registry = createCapabilityRegistry([greetCapability]);
const entry = registry.get("greet")!;
const fieldsOf = (errors: ReadonlyArray<{ field: string }> = []): string[] => errors.map((e) => e.field);

function mockReq(method: string, path: string, body: unknown): IncomingMessage {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage & { url: string; method: string };
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

// ONE invalid input: `times` carries a value its type rejects. Passed present (not merely missing),
// it is rejected — naming `times` — by every surface: the validator, argv dispatch, HTTP (422),
// and (via the derived schema) the agent tool the Rust host validates. (Required args carry valid dummies
// so the option is the sole violation.)
const badInput: Record<string, unknown> = {"to":"x","times":"not-a-number"};
const badArgv: string[] = ["x","--times","not-a-number"];
const badBody = { args: {"to":"x"}, options: { "times": "not-a-number" } };

describe("the one-schema invariant — greet declared once, validated the same on every surface", () => {
	it("derives ONE JSON Schema for the agent tool (the object the Rust host validates)", () => {
		const schema = capabilityToolParameters(greetCapability);
		expect(schema.type).toBe("object");
		expect(schema).toHaveProperty("properties");
	});

	it("the shared validator rejects it, naming `times`", () => {
		const validation = validateCapabilityArgs(greetCapability, badInput);
		expect(validation.valid).toBe(false);
		expect(fieldsOf(validation.errors)).toContain("times");
	});

	it("the CLI/TUI dispatch rejects it, naming `times`", async () => {
		const outcome = await dispatchCapability(entry, badArgv);
		expect(outcome.status).toBe("invalid");
		expect(fieldsOf(outcome.validation?.errors)).toContain("times");
	});

	it("the HTTP route rejects it with 422, naming `times`", async () => {
		const handler = createCapabilityRouteHandler([entry]);
		const { res, done } = mockRes();
		const handled = handler(mockReq("POST", "/greet", badBody), res);
		expect(handled).toBe(true);
		const { status, body } = await done;
		expect(status).toBe(422);
		expect(fieldsOf(body.errors)).toContain("times");
	});
});
