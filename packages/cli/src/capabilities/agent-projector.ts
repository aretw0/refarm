import type {
	CapabilityArgSpec,
	CapabilityDescriptor,
	CapabilityEntry,
	CapabilityOptionSpec,
} from "./types.js";
import { isCapabilityGroup } from "./types.js";

/**
 * The AGENT projector — the fourth surface reader, beside the CLI/REPL/HTTP ones
 * (http-projector.ts) and the TUI/web renderers. A BLIND loop over
 * `registry.list()` of ONLY the `transports.agent` bucket turns each verb that
 * opts in (`agent.tool === true`) into a TOOL the model can call. The tool's
 * schema (name / description / parameters) is DERIVED from what the descriptor
 * already carries — name, summary, args, options — so a verb declared ONCE reaches
 * the agent with zero duplication, exactly as it reaches CLI/REPL/HTTP.
 *
 * PURE + host-agnostic. This produces the provider tool-schema JSON as plain data
 * (no WASM, no host call), so it is fully testable in TS. The bridge that carries
 * these schemas into the WASM agent guest's model request, and that routes a tool
 * CALL back to the verb's dispatch, is §8 (a WIT import + guest rebuild) — this
 * projector is only the pure "capability → tool schema" half.
 *
 * Two providers, two wire shapes, ONE derivation:
 *   - Anthropic: `{ name, description, input_schema }` (matches tools.rs
 *     `tools_anthropic()`).
 *   - OpenAI:    `{ type:"function", function:{ name, description, parameters } }`
 *     (matches `tools_openai()`).
 * Both bodies are the same JSON-Schema object; only the envelope differs.
 */

/** The JSON-Schema object body a tool's parameters compile to. */
export interface ToolParameterSchema {
	type: "object";
	properties: Record<string, unknown>;
	required?: string[];
}

/** An Anthropic tool entry — the shape `tools_anthropic()` emits. */
export interface AnthropicToolSchema {
	name: string;
	description: string;
	input_schema: ToolParameterSchema;
}

/** An OpenAI tool entry — the shape `tools_openai()` emits. */
export interface OpenAiToolSchema {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: ToolParameterSchema;
	};
}

/** The action a group contributes as an agent tool: its default action, else null
 * (a group with no default action offers no tool — mirrors groupHttpAction). */
function groupAgentAction(entry: CapabilityEntry): CapabilityDescriptor | null {
	if (!isCapabilityGroup(entry)) return entry;
	if (!entry.defaultAction) return null;
	return entry.actions[entry.defaultAction] ?? null;
}

/** The model-facing tool name for a descriptor: the agent override, else `name`. */
function toolNameOf(descriptor: CapabilityDescriptor): string {
	const override = descriptor.transports?.agent?.toolName;
	return typeof override === "string" && override.length > 0
		? override
		: descriptor.name;
}

/** Map a capability option's kind to its JSON-Schema property. `string[]` becomes
 * an array of strings — the same shape a variadic arg or a repeated flag takes. */
function optionProperty(option: CapabilityOptionSpec): Record<string, unknown> {
	switch (option.kind) {
		case "boolean":
			return { type: "boolean", description: option.summary };
		case "string[]":
			return {
				type: "array",
				items: { type: "string" },
				description: option.summary,
			};
		default:
			return { type: "string", description: option.summary };
	}
}

/** Map a positional arg to its JSON-Schema property. A variadic arg collects the
 * rest into a string[]; a scalar arg is a string (capability args are untyped
 * strings — the surface parses them). */
function argProperty(arg: CapabilityArgSpec): Record<string, unknown> {
	if (arg.variadic) {
		return { type: "array", items: { type: "string" } };
	}
	return { type: "string" };
}

/**
 * Derive the JSON-Schema parameters object for a capability's tool form from its
 * args + options. Positionals and flags become properties; a `required` arg (and
 * only args — flags are optional by nature) lands in `required`. Deterministic
 * order: args first (declaration order), then options.
 */
export function capabilityToolParameters(
	descriptor: CapabilityDescriptor,
): ToolParameterSchema {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const arg of descriptor.args ?? []) {
		properties[arg.name] = argProperty(arg);
		if (arg.required) required.push(arg.name);
	}
	for (const option of descriptor.options ?? []) {
		properties[option.name] = optionProperty(option);
	}

	const schema: ToolParameterSchema = { type: "object", properties };
	if (required.length > 0) schema.required = required;
	return schema;
}

/** Whether a descriptor opts into being an agent tool (`transports.agent.tool`). */
function optsIntoAgentTool(descriptor: CapabilityDescriptor): boolean {
	return descriptor.transports?.agent?.tool === true;
}

/** Project ONE descriptor to an Anthropic tool schema. */
export function capabilityToAnthropicTool(
	descriptor: CapabilityDescriptor,
): AnthropicToolSchema {
	return {
		name: toolNameOf(descriptor),
		description: descriptor.summary,
		input_schema: capabilityToolParameters(descriptor),
	};
}

/** Project ONE descriptor to an OpenAI tool schema. */
export function capabilityToOpenAiTool(
	descriptor: CapabilityDescriptor,
): OpenAiToolSchema {
	return {
		type: "function",
		function: {
			name: toolNameOf(descriptor),
			description: descriptor.summary,
			parameters: capabilityToolParameters(descriptor),
		},
	};
}

/** The default-action descriptor of each registry entry that opted into the agent
 * surface. Shared by both provider projectors so eligibility is decided once. */
function agentToolDescriptors(
	entries: readonly CapabilityEntry[],
): CapabilityDescriptor[] {
	const out: CapabilityDescriptor[] = [];
	for (const entry of entries) {
		const action = groupAgentAction(entry);
		if (!action) continue;
		if (!optsIntoAgentTool(action)) continue;
		out.push(action);
	}
	return out;
}

/**
 * Project the registry to the Anthropic tool list — every capability whose
 * `transports.agent.tool` is true. The agent guest concatenates these with its
 * built-in `tools_anthropic()` at request-build time (the §8 bridge); this pure
 * function produces the plugin/registry half.
 */
export function capabilityAnthropicTools(
	entries: readonly CapabilityEntry[],
): AnthropicToolSchema[] {
	return agentToolDescriptors(entries).map(capabilityToAnthropicTool);
}

/** Project the registry to the OpenAI tool list — the OpenAI counterpart of
 * {@link capabilityAnthropicTools}, concatenated with built-in `tools_openai()`. */
export function capabilityOpenAiTools(
	entries: readonly CapabilityEntry[],
): OpenAiToolSchema[] {
	return agentToolDescriptors(entries).map(capabilityToOpenAiTool);
}
