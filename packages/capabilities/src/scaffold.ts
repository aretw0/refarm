// Scaffold a capability: turn a small spec (name + typed args/options) into the TWO files that make the
// framework's core move concrete — a CapabilityDescriptor declared ONCE, and a cross-surface test that
// proves the derived schema validates the SAME on every surface it reaches. The invariant
// (capability-homestead-surface/invariant.test) proven by hand becomes a GENERATOR: every new capability
// is born with validator + CLI/TUI-dispatch + HTTP(422) + agent-tool-schema coverage. Pure — returns file
// {path, content}; the caller writes them. Brand-neutral.

import type { CapabilityArgSpec, CapabilityOptionSpec } from "./types.js";

export interface CapabilityScaffoldSpec {
	/** Verb name, kebab or lower, e.g. "search". */
	name: string;
	/** One-line summary (a default is derived from the name if omitted). */
	summary?: string;
	/** Typed positional args. */
	args?: CapabilityArgSpec[];
	/** Typed `--flag` options. A numeric/enum option gives the richest cross-surface rejection test. */
	options?: CapabilityOptionSpec[];
	/** Import specifier the test uses to load the descriptor (default `./<name>.js`). */
	descriptorImport?: string;
}

export interface ScaffoldFile {
	/** Suggested filename relative to the target dir. */
	path: string;
	content: string;
}

export interface CapabilityScaffold {
	descriptor: ScaffoldFile;
	test: ScaffoldFile;
	/** The field the generated test drives its rejection through, or null when the verb has no field that
	 * yields a coercion-stable, everywhere-named rejection (then the test only asserts the schema + a pass). */
	invalidField: string | null;
}

/** `search-notes` → `searchNotes`. */
export function toCamelCase(name: string): string {
	return name
		.replace(/[-_ ]+([a-zA-Z0-9])/g, (_m, c: string) => c.toUpperCase())
		.replace(/^[A-Z]/, (c) => c.toLowerCase());
}

/**
 * Choose how the cross-surface test provokes a rejection. Order matters — it prefers the strategy that
 * names the SAME field on EVERY surface (validator, argv dispatch, HTTP, agent schema):
 *  1. a typed OPTION (numeric or enum) → a wrong value passed as `--opt <bad>` names the field everywhere;
 *  2. a required ARG → omit it; the validator + HTTP + agent-schema name it, but a MISSING positional is
 *     surfaced by argv dispatch as a whole-input error (no field), so that leg asserts rejection only;
 *  3. nothing violable → the test asserts the schema shape + that a valid (empty) input passes.
 */
type InvalidPlan =
	| { field: string; strategy: "option"; badValue: string }
	| { field: string; strategy: "missing-arg" }
	| null;

function chooseInvalidPlan(spec: CapabilityScaffoldSpec): InvalidPlan {
	const typedOption = (spec.options ?? []).find(
		(o) => o.kind === "integer" || o.kind === "number" || (o.enum?.length ?? 0) > 0,
	);
	if (typedOption) {
		// A non-numeric string violates integer/number (coercion-stable — Ajv cannot coerce it); a sentinel
		// violates an enum. Either is rejected identically by every surface, naming the option.
		const badValue = typedOption.enum?.length ? "__invalid__" : "not-a-number";
		return { field: typedOption.name, strategy: "option", badValue };
	}
	const requiredArg = (spec.args ?? []).find((a) => a.required);
	if (requiredArg) return { field: requiredArg.name, strategy: "missing-arg" };
	return null;
}

function jsonInline(value: unknown): string {
	return JSON.stringify(value);
}

/** Valid dummy values for the REQUIRED args, so the only violation in the option-strategy test is the
 * option itself (a missing required positional would otherwise mask it as a whole-input error). Returns the
 * typed object form (validator/HTTP) and the argv string form (CLI dispatch). */
function dummyRequiredArgs(args: readonly CapabilityArgSpec[]): { object: Record<string, unknown>; argv: string[] } {
	const object: Record<string, unknown> = {};
	const argv: string[] = [];
	for (const arg of args) {
		if (!arg.required) continue;
		let objectValue: unknown;
		let argvValue: string;
		if (arg.enum?.length) {
			objectValue = arg.enum[0];
			argvValue = arg.enum[0]!;
		} else if (arg.type === "number" || arg.type === "integer") {
			objectValue = 1;
			argvValue = "1";
		} else if (arg.type === "boolean") {
			objectValue = true;
			argvValue = "true";
		} else if (arg.type === "array") {
			objectValue = ["x"];
			argvValue = "x";
		} else {
			objectValue = "x";
			argvValue = "x";
		}
		object[arg.name] = objectValue;
		argv.push(argvValue);
	}
	return { object, argv };
}

function renderSpecArray(key: string, items: readonly unknown[]): string {
	if (items.length === 0) return "";
	const lines = items.map((item) => `\t\t${jsonInline(item)},`).join("\n");
	return `\t${key}: [\n${lines}\n\t],\n`;
}

function descriptorContent(spec: CapabilityScaffoldSpec, camel: string): string {
	const summary = spec.summary ?? `Run the ${spec.name} capability`;
	return `import { buildJsonSuccessEnvelope } from "@refarm.dev/capabilities/envelope";
import type { CapabilityDescriptor, CapabilityEnvelope, CapabilityInput } from "@refarm.dev/capabilities";

/**
 * \`${spec.name}\` — ${summary}.
 *
 * Declared ONCE. This descriptor projects to the CLI, a web form, an agent tool, and an HTTP route; its
 * typed args/options derive one JSON Schema that validates the SAME on every surface (see ${spec.name}.test.ts).
 * Fill in run() — its input is already parsed + validated against that schema.
 */
export const ${camel}Capability: CapabilityDescriptor = {
	name: "${spec.name}",
	summary: "${summary}",
${renderSpecArray("args", spec.args ?? [])}${renderSpecArray("options", spec.options ?? [])}\ttransports: { http: { method: "POST", path: "/${spec.name}" } },
	renderers: { web: {}, tui: { section: "actions" } },
	run(_input: CapabilityInput): CapabilityEnvelope {
		// TODO: implement. \`_input.args\` / \`_input.options\` are parsed + schema-validated already.
		return buildJsonSuccessEnvelope({ command: "${spec.name}", operation: "${spec.name}" });
	},
};
`;
}

const TEST_HEADER_HELPERS = `import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import {
	capabilityToolParameters,
	createCapabilityRegistry,
	createCapabilityRouteHandler,
	dispatchCapability,
	validateCapabilityArgs,
} from "@refarm.dev/capabilities";
import { describe, expect, it } from "vitest";
`;

const MOCK_HELPERS = `const fieldsOf = (errors: ReadonlyArray<{ field: string }> = []): string[] => errors.map((e) => e.field);

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
`;

function testContent(spec: CapabilityScaffoldSpec, camel: string, plan: InvalidPlan): string {
	const importPath = spec.descriptorImport ?? `./${spec.name}.js`;
	const varName = `${camel}Capability`;
	const title = `the one-schema invariant — ${spec.name} declared once, validated the same on every surface`;

	const preamble = `${TEST_HEADER_HELPERS}
import { ${varName} } from "${importPath}";

const registry = createCapabilityRegistry([${varName}]);
const entry = registry.get("${spec.name}")!;
${MOCK_HELPERS}`;

	const schemaTest = `	it("derives ONE JSON Schema for the agent tool (the object the Rust host validates)", () => {
		const schema = capabilityToolParameters(${varName});
		expect(schema.type).toBe("object");
		expect(schema).toHaveProperty("properties");
	});`;

	if (!plan) {
		return `${preamble}
describe("${title}", () => {
${schemaTest}

	it("accepts a well-formed empty input (add a required arg or a numeric/enum option for rejection coverage)", () => {
		// TODO: this verb has no coercion-stable invalid input to reject across surfaces. Add a numeric/enum
		// option or a required arg to \`${spec.name}.ts\` and this test will cover the cross-surface rejection.
		expect(validateCapabilityArgs(${varName}, {}).valid).toBe(true);
	});
});
`;
	}

	if (plan.strategy === "option") {
		// Provide valid dummies for the required args so the ONLY error is the violated option (a missing
		// required positional would otherwise surface as a whole-input error on the dispatch leg).
		const dummies = dummyRequiredArgs(spec.args ?? []);
		const badInputObject = { ...dummies.object, [plan.field]: plan.badValue };
		const badArgvArray = [...dummies.argv, `--${plan.field}`, plan.badValue];
		return `${preamble}
// ONE invalid input: \`${plan.field}\` carries a value its type rejects. Passed present (not merely missing),
// it is rejected — naming \`${plan.field}\` — by every surface: the validator, argv dispatch, HTTP (422),
// and (via the derived schema) the agent tool the Rust host validates. (Required args carry valid dummies
// so the option is the sole violation.)
const badInput: Record<string, unknown> = ${jsonInline(badInputObject)};
const badArgv: string[] = ${jsonInline(badArgvArray)};
const badBody = { args: ${jsonInline(dummies.object)}, options: { ${jsonInline(plan.field)}: ${jsonInline(plan.badValue)} } };

describe("${title}", () => {
${schemaTest}

	it("the shared validator rejects it, naming \`${plan.field}\`", () => {
		const validation = validateCapabilityArgs(${varName}, badInput);
		expect(validation.valid).toBe(false);
		expect(fieldsOf(validation.errors)).toContain("${plan.field}");
	});

	it("the CLI/TUI dispatch rejects it, naming \`${plan.field}\`", async () => {
		const outcome = await dispatchCapability(entry, badArgv);
		expect(outcome.status).toBe("invalid");
		expect(fieldsOf(outcome.validation?.errors)).toContain("${plan.field}");
	});

	it("the HTTP route rejects it with 422, naming \`${plan.field}\`", async () => {
		const handler = createCapabilityRouteHandler([entry]);
		const { res, done } = mockRes();
		const handled = handler(mockReq("POST", "/${spec.name}", badBody), res);
		expect(handled).toBe(true);
		const { status, body } = await done;
		expect(status).toBe(422);
		expect(fieldsOf(body.errors)).toContain("${plan.field}");
	});
});
`;
	}

	// strategy === "missing-arg": the required arg is absent. The validator + HTTP + agent-schema name it; a
	// missing POSITIONAL is surfaced by argv dispatch as a whole-input error, so that leg asserts rejection.
	return `${preamble}
// ONE invalid input: the required \`${plan.field}\` is absent. The validator, HTTP (422), and the agent
// schema name it; argv dispatch surfaces a missing positional as a whole-input error, so it asserts the
// rejection (status), not the field. (For an everywhere-named field, give the verb a numeric/enum option.)
describe("${title}", () => {
${schemaTest}

	it("the agent schema marks \`${plan.field}\` required (what the Rust host validates)", () => {
		expect(capabilityToolParameters(${varName}).required ?? []).toContain("${plan.field}");
	});

	it("the shared validator rejects the missing \`${plan.field}\`, naming it", () => {
		const validation = validateCapabilityArgs(${varName}, {});
		expect(validation.valid).toBe(false);
		expect(fieldsOf(validation.errors)).toContain("${plan.field}");
	});

	it("the CLI/TUI dispatch rejects the missing required input", async () => {
		const outcome = await dispatchCapability(entry, []);
		expect(outcome.status).toBe("invalid");
	});

	it("the HTTP route rejects it with 422, naming \`${plan.field}\`", async () => {
		const handler = createCapabilityRouteHandler([entry]);
		const { res, done } = mockRes();
		const handled = handler(mockReq("POST", "/${spec.name}", { args: {}, options: {} }), res);
		expect(handled).toBe(true);
		const { status, body } = await done;
		expect(status).toBe(422);
		expect(fieldsOf(body.errors)).toContain("${plan.field}");
	});
});
`;
}

/**
 * Generate the descriptor + cross-surface test for a capability spec. PURE — returns file contents; the
 * caller decides where to write them. The test proves the SAME derived schema rejects ONE invalid input
 * identically across the validator, the CLI/TUI dispatch, the HTTP route (422), and the agent tool schema.
 */
export function buildCapabilityScaffold(spec: CapabilityScaffoldSpec): CapabilityScaffold {
	const camel = toCamelCase(spec.name);
	const plan = chooseInvalidPlan(spec);
	return {
		descriptor: { path: `${spec.name}.ts`, content: descriptorContent(spec, camel) },
		test: { path: `${spec.name}.test.ts`, content: testContent(spec, camel, plan) },
		invalidField: plan?.field ?? null,
	};
}
