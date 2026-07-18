import type {
	CapabilityArgSpec,
	CapabilityDescriptor,
	CapabilityEntry,
	CapabilityOptionSpec,
} from "./types.js";
import { isCapabilityGroup } from "./types.js";

/**
 * The AGENT projector — the pure "capability → tool schema" half, kept as the
 * WEB-SURFACE SEAM (parallel to http-projector.ts). A BLIND loop over
 * `registry.list()` of ONLY the `transports.agent` bucket turns each verb that
 * opts in (`agent.tool === true`) into a provider tool schema, DERIVED from the
 * descriptor's name/summary/args/options.
 *
 * ⚠️ NOT ON THE LIVE AGENT PATH — read this before wiring it. The shipping agent
 * leg (#6) lists + invokes plugin tools ENTIRELY in the Rust host + WASM guest:
 * the guest calls `capability-tools.list-tools()` (packages/agent/src/tools.rs),
 * the host renders schemas in `render_tool_schema`
 * (packages/tractor/src/host/host_effects_bridge/capability_tools.rs), and the
 * guest's dispatch arm invokes them. That path is authoritative and does NOT read
 * this file. This projector is intentionally OFF that path: it is the pure,
 * TS-testable projection a future WEB / introspection endpoint (an HTTP surface
 * that lists the agent's tools for a browser UI) would call — the same role
 * http-projector.ts plays for the capability HTTP transport.
 *
 * It IS re-exported from the barrel now that the `serve` command mounts it at
 * /agent-tools — the deliberate web consumer it was built for. It stays OFF the
 * live Rust agent path (that lists/invokes plugin tools in the host+guest); this
 * projects the registry's agent-eligible verbs for a browser to read.
 *
 * DERIVATION DIVERGENCE (deliberate, documented): this projector derives a RICH
 * per-arg/per-option schema with `required` (good for a human-facing web tool
 * list). The live Rust `render_tool_schema` emits a FIXED `{args: string[]}`
 * schema (matching the plugin-descriptor-adapter's variadic `args`), because a
 * plugin verb's real arg shape is opaque to the host today. If a future slice
 * teaches the host a plugin's per-arg schema, THAT is where the two converge — do
 * not "fix" the divergence by wiring this projector into the guest.
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
	return typeof override === "string" && override.length > 0 ? override : descriptor.name;
}

/** Map a capability option's kind to its JSON-Schema property. `string[]` becomes
 * an array of strings — the same shape a variadic arg or a repeated flag takes. */
function optionProperty(option: CapabilityOptionSpec): Record<string, unknown> {
	let property: Record<string, unknown>;
	switch (option.kind) {
		case "boolean":
			property = { type: "boolean" };
			break;
		case "string[]":
			property = { type: "array", items: { type: "string" } };
			break;
		case "number":
		case "integer":
			property = { type: option.kind };
			break;
		default:
			property = { type: "string" };
	}
	property.description = option.summary;
	if (option.enum && option.enum.length > 0) property.enum = [...option.enum];
	return property;
}

/** Map a positional arg to its JSON-Schema property, honoring its declared `type`/`enum`/`items`
 * (default `string`). A variadic arg — or an explicit `type: "array"` — is a list of `items`. This
 * mirrors the plugin manifest's `deriveVerbSchemaFromArgs`, so a descriptor arg and a manifest verb
 * arg with the same declaration produce the same tool-schema property. */
function argProperty(arg: CapabilityArgSpec): Record<string, unknown> {
	// Build the base property (array or scalar), THEN append description/enum in one tail — so an
	// array/variadic arg keeps its description + enum, byte-for-byte matching deriveVerbSchemaFromArgs
	// (an early-return for the array branch would drop them, diverging from the manifest hosts). The
	// `typeof === "string"` guard (not truthy) keeps an explicit empty description, as the JS/Rust
	// derivations do.
	const property: Record<string, unknown> =
		arg.variadic || arg.type === "array"
			? { type: "array", items: { type: arg.items ?? "string" } }
			: { type: arg.type ?? "string" };
	if (typeof arg.description === "string") property.description = arg.description;
	if (arg.enum && arg.enum.length > 0) property.enum = [...arg.enum];
	return property;
}

/**
 * Derive the JSON-Schema parameters object for a capability's tool form from its
 * args + options. Positionals and flags become properties; a `required` arg (and
 * only args — flags are optional by nature) lands in `required`. Deterministic
 * order: args first (declaration order), then options.
 */
export function capabilityToolParameters(descriptor: CapabilityDescriptor): ToolParameterSchema {
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
export function capabilityToAnthropicTool(descriptor: CapabilityDescriptor): AnthropicToolSchema {
	return {
		name: toolNameOf(descriptor),
		description: descriptor.summary,
		input_schema: capabilityToolParameters(descriptor),
	};
}

/** Project ONE descriptor to an OpenAI tool schema. */
export function capabilityToOpenAiTool(descriptor: CapabilityDescriptor): OpenAiToolSchema {
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
function agentToolDescriptors(entries: readonly CapabilityEntry[]): CapabilityDescriptor[] {
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
export function capabilityOpenAiTools(entries: readonly CapabilityEntry[]): OpenAiToolSchema[] {
	return agentToolDescriptors(entries).map(capabilityToOpenAiTool);
}
