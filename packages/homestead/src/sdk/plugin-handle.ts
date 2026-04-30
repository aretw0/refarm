import type { ExtensionSurfaceDeclaration } from "@refarm.dev/plugin-manifest";
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

export type HomesteadSurfaceDeclarationInput = Omit<
	ExtensionSurfaceDeclaration,
	"layer"
> & {
	layer?: "homestead";
};

export interface CreateHomesteadSurfacePluginHandleOptions
	extends CreateStudioPluginHandleOptions {
	surfaces: HomesteadSurfaceDeclarationInput[];
}

export type StudioPluginRegistryStatus =
	| "registered"
	| "validated"
	| "active"
	| "error";

export interface StudioPluginRegistryEntryLike {
	status: StudioPluginRegistryStatus;
}

export interface StudioPluginRegistryLike {
	register(manifest: PluginInstance["manifest"]): string | Promise<string>;
	getPlugin(id: string): StudioPluginRegistryEntryLike | undefined;
}

export interface RegisterStudioPluginManifestOptions {
	status?: StudioPluginRegistryStatus;
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

/**
 * Create a local plugin handle with manifest-declared Homestead surfaces.
 *
 * Hosts still choose when to register the returned handle. This helper only
 * centralizes the shape of surface declarations so Studio examples do not
 * duplicate manifest boilerplate or accidentally omit the `homestead` layer.
 */
export function createHomesteadSurfacePluginHandle(
	options: CreateHomesteadSurfacePluginHandleOptions,
): PluginInstance {
	const homesteadSurfaces = options.surfaces.map((surface) => ({
		...surface,
		layer: "homestead" as const,
	}));
	const existingSurfaces = options.manifest?.extensions?.surfaces ?? [];

	return createStudioPluginHandle({
		...options,
		manifest: {
			...options.manifest,
			extensions: {
				...options.manifest?.extensions,
				surfaces: [...existingSurfaces, ...homesteadSurfaces],
			},
		},
	});
}

/**
 * Register a local Studio plugin manifest in the host registry before the host
 * registers the plugin handle itself.
 *
 * This keeps the registry/trust-policy mechanics reusable for `apps/dev`,
 * `apps/me`, and future hosts without hiding the host-owned decision to install
 * or activate a plugin instance.
 */
export async function registerStudioPluginManifest(
	registry: StudioPluginRegistryLike,
	plugin: PluginInstance,
	options: RegisterStudioPluginManifestOptions = {},
): Promise<void> {
	await registry.register(plugin.manifest);
	const entry = registry.getPlugin(plugin.id);
	if (entry && options.status) {
		entry.status = options.status;
	}
}
