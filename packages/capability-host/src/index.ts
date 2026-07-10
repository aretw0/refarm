import {
	pluginSurfaceName,
	runCapabilityHostCli,
	surfaceablePluginVerbsFrom,
	type CapabilityHost,
	type CapabilityHostPrimaryVerbOptions,
	type CapabilityHostServeCallOptions,
	type RunCapabilityHostCliOptions,
	type SurfaceableManifest,
} from "@refarm.dev/capabilities-v1";

export {
	createMemorySubmitEffort,
	type MemorySubmitEffort,
} from "./memory-submit.js";

export {
	buildCapabilityHostServeInfo,
	buildDispatchEffort,
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	createLocalCapabilityDeps,
	createLocalVaultCommandDeps,
	createPluginDescriptorDeps,
	createRecordsCapabilityGroup,
	buildPaletteModel,
	createSourceCapabilityGroup,
	createVaultCapabilityGroup,
	createWasmEnrichmentProvider,
	createWasmSourceProvider,
	defaultRecordsDeps,
	defaultSourceDeps,
	defaultVaultDeps,
	definePluginInspectorCapability,
	defineRecordsViewCapability,
	defineCapabilityHost,
	isCapabilityHostCliEntrypoint,
	mountedHttpHandler,
	parseDispatchArgs,
	pluginDescriptorsFrom,
	pluginSurfaceName,
	registerPluginCapabilities,
	runCapabilityHostCli,
	surfaceablePluginVerbsFrom,
	type CapabilityHost,
	type CapabilityHostCapabilities,
	type CapabilityHostCapabilitiesFactory,
	type CapabilityHostCapabilityUnitFactory,
	type CapabilityHostCliEntrypointOptions,
	type CapabilityHostCapabilityUnitOptions,
	type CapabilityHostCommandBuilder,
	type CapabilityHostDefinition,
	type CapabilityHostOperatorStatus,
	type CapabilityHostPrimaryVerbOptions,
	type CapabilityHostRecordReviewCorrectionOptions,
	type CapabilityHostRecordReviewQueueUnitOptions,
	type CapabilityHostReviewQueueUnitOptions,
	type CapabilityHostServeCallOptions,
	type CapabilityHostServeInfo,
	type CapabilityHostServeOptions,
	type CapabilityHostStatusContext,
	type CapabilityHostSurfaceAction,
	type CapabilityHostSurfaceActionRow,
	type CapabilityHostSurfaceActionsOptions,
	type CapabilityHostSurfaceContext,
	type CapabilityDeps,
	type CapabilityDescriptor,
	type CapabilityEntry,
	type DispatchRequest,
	type MountOptions,
	type PluginCapabilityRegistration,
	type PluginDescriptorDeps,
	type PluginDescriptorDepsOptions,
	type PluginInspectorCapabilityOptions,
	type RecordsAnalyzeEnvelope,
	type RecordsCommandDeps,
	type RecordsViewCapabilityOptions,
	type ParseableCapabilityHostProgram,
	type RunCapabilityHostCliOptions,
	type SendPrompt,
	type SubmitEffort,
	type SourceCommandDeps,
	type SurfaceableManifest,
	type SurfaceablePluginVerb,
	type VaultCommandDeps,
	type VaultDiscoveryResult,
	type VaultProviderSummary,
	type WasmEnrichmentProviderOptions,
	type WasmSourceProviderOptions,
} from "@refarm.dev/capabilities-v1";

export interface HostCommandOptions {
	command?: string;
	commandEnv?: Record<string, string | undefined>;
}

export interface HostCommandResolverOptions {
	defaultCommand: string;
	commandEnvKey?: string;
}

export interface ResolveHostCommandOptions extends HostCommandOptions {
	env?: Record<string, string | undefined>;
	defaultCommand: string;
	commandEnvKey?: string;
}

/** Derive the command-override env key from a host command, so a generic package
 * NAMES NO BRAND: `dgk` → `DGK_COMMAND`, `acme` → `ACME_COMMAND` (ADR-087). Mirrors
 * `@refarm.dev/cli`'s `applicationCommandOverrideEnv(binary)` — a name derives its
 * namespace; the package never hardcodes a product's env key. */
export function hostCommandOverrideEnv(command: string): string {
	return `${String(command).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_COMMAND`;
}

export function createHostCommandResolver(
	options: HostCommandResolverOptions,
): (input?: HostCommandOptions) => string {
	// The default override env follows the host's own command (dgk → DGK_COMMAND),
	// unless the host names an explicit key. No brand baked into the resolver.
	const commandEnvKey = options.commandEnvKey ?? hostCommandOverrideEnv(options.defaultCommand);
	return (input: HostCommandOptions = {}) => resolveHostCommand({
		commandEnv: input.commandEnv,
		command: input.command,
		defaultCommand: options.defaultCommand,
		commandEnvKey,
	});
}

export function resolveHostCommand(
	input: ResolveHostCommandOptions,
): string {
	// The override env key follows the command being resolved unless an explicit
	// key is supplied — the generic package derives, never hardcodes a brand.
	const commandEnvKey = input.commandEnvKey ?? hostCommandOverrideEnv(input.defaultCommand);
	const command = (
		input.command
		?? input.commandEnv?.[commandEnvKey]
		?? input.env?.[commandEnvKey]
		?? process.env[commandEnvKey]
	) ?? "";
	return String(command).trim() || input.defaultCommand;
}

export interface HostSurfaceActionsFromManifestsOptions {
	manifests: readonly SurfaceableManifest[];
	includeSubject?: boolean;
}

export function buildManifestPrimaryVerbs(
	{ manifests, includeSubject = true }: HostSurfaceActionsFromManifestsOptions,
): CapabilityHostPrimaryVerbOptions[] {
	const seen = new Set<string>();
	const primaryVerbs: CapabilityHostPrimaryVerbOptions[] = [];
	for (const manifest of manifests) {
		for (const verb of surfaceablePluginVerbsFrom(manifest)) {
			if (seen.has(verb.surfaceName)) {
				continue;
			}
			seen.add(verb.surfaceName);
			primaryVerbs.push({
				name: verb.surfaceName,
				subject: includeSubject ? `${verb.pluginKey} extension` : undefined,
				actionId: `run-${pluginSurfaceName(verb.pluginKey, verb.verb)}`,
				intent: `${verb.pluginKey}:${verb.verb}`,
			});
		}
	}
	return primaryVerbs;
}

export interface CapabilityAppDefinition<Options extends object = Record<string, never>> {
	host: (options: Options) => CapabilityHost;
	defaultOptions?: Options | (() => Options);
	programOptions?: (options: Options) => Options;
}

export interface RunCapabilityAppCliOptions<Options extends object = Record<string, never>>
	extends RunCapabilityHostCliOptions {
	appOptions?: Options;
}

export interface ServeCapabilityAppOptions<Options extends object = Record<string, never>>
	extends CapabilityHostServeCallOptions {
	appOptions?: Options;
}

export interface CapabilityApp<Options extends object = Record<string, never>> {
	host(options?: Options): CapabilityHost;
	registry(options?: Options): ReturnType<CapabilityHost["registry"]>;
	baseModel(options?: Options): ReturnType<CapabilityHost["baseModel"]>;
	surfaceActions(options?: Options): ReturnType<CapabilityHost["surfaceActions"]>;
	surfaceActionRows(options?: Options): ReturnType<CapabilityHost["surfaceActionRows"]>;
	surfaceContext(options?: Options): ReturnType<CapabilityHost["surfaceContext"]>;
	program(options?: Options): ReturnType<CapabilityHost["program"]>;
	serve(options?: ServeCapabilityAppOptions<Options>): ReturnType<CapabilityHost["serve"]>;
	runCli(
		importMetaUrl: string,
		options?: RunCapabilityAppCliOptions<Options>,
	): Promise<boolean>;
}

export function defineCapabilityApp<Options extends object = Record<string, never>>(
	definition: CapabilityAppDefinition<Options>,
): CapabilityApp<Options> {
	const defaultOptions = (): Options => {
		const defaults = typeof definition.defaultOptions === "function"
			? definition.defaultOptions()
			: definition.defaultOptions;
		return (defaults ?? {}) as Options;
	};
	const createOptions = (options?: Options): Options =>
		({
			...defaultOptions(),
			...(options ?? {}),
		}) as Options;
	const host = (options?: Options): CapabilityHost =>
		definition.host(createOptions(options));
	const program = (options?: Options): ReturnType<CapabilityHost["program"]> => {
		const hostOptions = createOptions(options);
		return host(
			definition.programOptions?.(hostOptions) ?? hostOptions,
		).program();
	};
	return {
		host,
		registry(options?: Options) {
			return host(options).registry();
		},
		baseModel(options?: Options) {
			return host(options).baseModel();
		},
		surfaceActions(options?: Options) {
			return host(options).surfaceActions();
		},
		surfaceActionRows(options?: Options) {
			return host(options).surfaceActionRows();
		},
		surfaceContext(options?: Options) {
			return host(options).surfaceContext();
		},
		program,
		serve(options: ServeCapabilityAppOptions<Options> = {}) {
			const { appOptions, ...serveOptions } = options;
			return host(appOptions).serve(serveOptions);
		},
		runCli(
			importMetaUrl: string,
			options: RunCapabilityAppCliOptions<Options> = {},
		) {
			const { appOptions, ...cliOptions } = options;
			return runCapabilityHostCli(
				importMetaUrl,
				() => program(appOptions),
				cliOptions,
			);
		},
	};
}
