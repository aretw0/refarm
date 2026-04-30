import type { PluginInstance } from "@refarm.dev/tractor";

export type StudioPluginTelemetryEmitter = (
	event: string,
	payload?: unknown,
) => void;

export interface CreateStudioPluginHandleOptions {
	id: string;
	name: string;
	version?: string;
	entry?: string;
	manifest?: Partial<PluginInstance["manifest"]>;
	call?: PluginInstance["call"];
	emitTelemetry?: StudioPluginTelemetryEmitter;
	state?: PluginInstance["state"];
	terminate?: PluginInstance["terminate"];
}

/**
 * Create a local Studio plugin handle without repeating PluginInstance boilerplate.
 *
 * Internal Studio experiments should keep the default `internal:<id>` entry so
 * Homestead's surface trust gate can distinguish explicit internal fixtures from
 * external registry-governed plugins.
 */
export function createStudioPluginHandle(
	options: CreateStudioPluginHandleOptions,
): PluginInstance {
	const version = options.version ?? "0.1.0";
	const entry = options.entry ?? `internal:${options.id}`;
	return {
		id: options.id,
		name: options.name,
		manifest: {
			...options.manifest,
			id: options.id,
			name: options.name,
			version,
			entry,
			capabilities: options.manifest?.capabilities ?? {},
		} as PluginInstance["manifest"],
		call: options.call ?? (async () => null),
		terminate: options.terminate ?? (() => {}),
		emitTelemetry: options.emitTelemetry ?? (() => {}),
		state: options.state ?? "running",
	};
}
