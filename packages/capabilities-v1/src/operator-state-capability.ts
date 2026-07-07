import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
} from "@refarm.dev/cli/capabilities";
import type { BaseSurfaceModel } from "@refarm.dev/operator-state";

export interface BaseStatusCapabilityOptions {
	name?: string;
	summary?: string;
	httpPath?: string;
	agentToolName?: string;
	model: () => BaseSurfaceModel | Promise<BaseSurfaceModel>;
}

export function createBaseStatusCapability(
	options: BaseStatusCapabilityOptions,
): CapabilityDescriptor {
	const name = options.name ?? "status";
	return {
		name,
		summary: options.summary ?? "Show the base operator status",
		options: [
			{
				name: "base",
				kind: "boolean",
				summary: "Return the base operator model",
			},
		],
		transports: {
			cli: {},
			repl: {},
			http: { method: "GET", path: options.httpPath ?? `/${name}` },
			agent: { tool: true, toolName: options.agentToolName ?? name },
		},
		renderers: { tui: { section: name } },
		async run(): Promise<CapabilityEnvelope> {
			return await options.model() as CapabilityEnvelope;
		},
	};
}
