import { describe, expect, it } from "vitest";

import { buildJsonSuccessEnvelope } from "./envelope.js";
import {
	capabilityAnthropicTools,
	capabilityOpenAiTools,
	capabilityToAnthropicTool,
	capabilityToOpenAiTool,
	capabilityToolParameters,
} from "./agent-projector.js";
import type { CapabilityDescriptor, CapabilityEntry, CapabilityGroup } from "./types.js";

/** A minimal descriptor factory — every field the projector reads is explicit. */
function descriptor(over: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
	return {
		name: "review",
		summary: "Review the working tree",
		run: () => buildJsonSuccessEnvelope({ command: "x", operation: "y" }),
		...over,
	};
}

describe("capabilityToolParameters — schema derivation", () => {
	it("maps args to string properties and required args to `required`", () => {
		const schema = capabilityToolParameters(
			descriptor({
				args: [{ name: "target", required: true }, { name: "note" }],
			}),
		);
		expect(schema).toEqual({
			type: "object",
			properties: {
				target: { type: "string" },
				note: { type: "string" },
			},
			required: ["target"],
		});
	});

	it("maps a variadic arg to an array of strings", () => {
		const schema = capabilityToolParameters(
			descriptor({ args: [{ name: "args", variadic: true }] }),
		);
		expect(schema.properties.args).toEqual({
			type: "array",
			items: { type: "string" },
		});
	});

	it("honors a declared arg `type`/`enum`/`items`/`description` (mirrors the manifest derivation)", () => {
		const schema = capabilityToolParameters(
			descriptor({
				args: [
					{ name: "line", type: "integer", required: true, description: "1-based line" },
					{ name: "kind", type: "string", enum: ["note", "task"] },
					{ name: "tags", type: "array", items: "string", description: "labels" },
				],
			}),
		);
		expect(schema.properties.line).toEqual({ type: "integer", description: "1-based line" });
		expect(schema.properties.kind).toEqual({ type: "string", enum: ["note", "task"] });
		// An ARRAY arg keeps its description too (the array branch appends the tail, not an early return).
		expect(schema.properties.tags).toEqual({ type: "array", items: { type: "string" }, description: "labels" });
		expect(schema.required).toEqual(["line"]);
	});

	it("maps option kinds to boolean/string/array and never marks them required", () => {
		const schema = capabilityToolParameters(
			descriptor({
				options: [
					{ name: "json", kind: "boolean", summary: "JSON output" },
					{ name: "policy", kind: "string", summary: "Policy name" },
					{ name: "tags", kind: "string[]", summary: "Tags" },
					{ name: "line", kind: "integer", summary: "1-based line" },
					{ name: "ratio", kind: "number", summary: "A ratio" },
				],
			}),
		);
		expect(schema.properties.json).toEqual({
			type: "boolean",
			description: "JSON output",
		});
		expect(schema.properties.policy).toEqual({
			type: "string",
			description: "Policy name",
		});
		expect(schema.properties.tags).toEqual({
			type: "array",
			items: { type: "string" },
			description: "Tags",
		});
		expect(schema.properties.line).toEqual({ type: "integer", description: "1-based line" });
		expect(schema.properties.ratio).toEqual({ type: "number", description: "A ratio" });
		// Options are never required — flags are optional by nature.
		expect(schema.required).toBeUndefined();
	});

	it("orders args before options and omits `required` when there are none", () => {
		const schema = capabilityToolParameters(
			descriptor({
				args: [{ name: "a" }],
				options: [{ name: "b", kind: "string", summary: "b" }],
			}),
		);
		expect(Object.keys(schema.properties)).toEqual(["a", "b"]);
		expect(schema.required).toBeUndefined();
	});

	it("produces an empty object body for a no-arg no-option verb", () => {
		expect(capabilityToolParameters(descriptor())).toEqual({
			type: "object",
			properties: {},
		});
	});
});

describe("capabilityToAnthropicTool / capabilityToOpenAiTool — provider shapes", () => {
	const desc = descriptor({
		name: "store",
		summary: "Store a note",
		args: [{ name: "path", required: true }],
	});

	it("emits the Anthropic {name, description, input_schema} shape", () => {
		expect(capabilityToAnthropicTool(desc)).toEqual({
			name: "store",
			description: "Store a note",
			input_schema: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			},
		});
	});

	it("emits the OpenAI {type:function, function:{...}} envelope over the same body", () => {
		expect(capabilityToOpenAiTool(desc)).toEqual({
			type: "function",
			function: {
				name: "store",
				description: "Store a note",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
			},
		});
	});

	it("honors transports.agent.toolName as the model-facing name (both providers)", () => {
		const renamed = descriptor({
			name: "store",
			transports: { agent: { tool: true, toolName: "vault_store" } },
		});
		expect(capabilityToAnthropicTool(renamed).name).toBe("vault_store");
		expect(capabilityToOpenAiTool(renamed).function.name).toBe("vault_store");
	});
});

describe("capabilityAnthropicTools / capabilityOpenAiTools — registry projection", () => {
	const toolVerb = descriptor({
		name: "store",
		transports: { agent: { tool: true } },
	});
	const cliOnlyVerb = descriptor({
		name: "review",
		transports: { cli: {} }, // no agent bucket → not a tool
	});
	const optedOutVerb = descriptor({
		name: "deploy",
		transports: { agent: { tool: false } },
	});

	it("emits a tool ONLY for verbs that opt in via transports.agent.tool", () => {
		const entries: CapabilityEntry[] = [toolVerb, cliOnlyVerb, optedOutVerb];
		expect(capabilityAnthropicTools(entries).map((t) => t.name)).toEqual(["store"]);
		expect(capabilityOpenAiTools(entries).map((t) => t.function.name)).toEqual(["store"]);
	});

	it("returns [] when no verb opts in", () => {
		expect(capabilityAnthropicTools([cliOnlyVerb, optedOutVerb])).toEqual([]);
		expect(capabilityOpenAiTools([cliOnlyVerb, optedOutVerb])).toEqual([]);
	});

	it("projects a group via its default action when that action opts in", () => {
		const group: CapabilityGroup = {
			name: "model",
			summary: "Model settings",
			defaultAction: "current",
			actions: {
				current: descriptor({
					name: "current",
					summary: "Show current model",
					transports: { agent: { tool: true } },
				}),
			},
		};
		expect(capabilityAnthropicTools([group]).map((t) => t.name)).toEqual(["current"]);
	});

	it("skips a group with no default action", () => {
		const group: CapabilityGroup = {
			name: "workspace",
			summary: "Workspace",
			actions: {
				list: descriptor({
					name: "list",
					transports: { agent: { tool: true } },
				}),
			},
		};
		expect(capabilityAnthropicTools([group])).toEqual([]);
	});
});
