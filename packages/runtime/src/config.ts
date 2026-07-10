export type RuntimeConfigEnv = Record<string, string | undefined>;
export type RuntimeConfigObject = Record<string, unknown>;

export interface RuntimeConfigEnvProbe<T> {
	name: string;
	parse: (value: string | undefined) => T | null;
}

export interface RuntimeConfigValueSpec<T> {
	/** Ordered env probes. The first valid value wins. */
	envProbes: ReadonlyArray<RuntimeConfigEnvProbe<T>>;
	/** Extract the raw candidate from one config layer. */
	extract: (config: RuntimeConfigObject | null | undefined) => unknown;
	/** Validate and normalize an env/config candidate. */
	parse: (value: unknown) => T | null;
	/** Terminal fallback when every layer is absent or invalid. */
	default: T;
}

export interface RuntimeConfigLayer {
	value: RuntimeConfigObject | null | undefined;
	source: string;
}

export interface RuntimeConfigValueSyncOptions {
	env?: RuntimeConfigEnv;
	configs?: ReadonlyArray<RuntimeConfigObject | null | undefined>;
	configSources?: ReadonlyArray<string>;
	defaultSource?: string;
}

export interface RuntimeConfigValueAsyncOptions {
	env?: RuntimeConfigEnv;
	resolveConfig: () => Promise<RuntimeConfigObject | null | undefined>;
	hostConfigSource?: string;
	fallbackConfigs?: ReadonlyArray<RuntimeConfigLayer>;
	defaultSource?: string;
}

export interface RuntimeConfigValueResolution<T> {
	value: T;
	source: string;
}

export function resolveRuntimeConfigValueSync<T>(
	spec: RuntimeConfigValueSpec<T>,
	options: RuntimeConfigValueSyncOptions = {},
): RuntimeConfigValueResolution<T> {
	const envResult = resolveRuntimeConfigValueFromEnv(spec, options.env);
	if (envResult) return envResult;

	let resolved: RuntimeConfigValueResolution<T> | null = null;
	const configs = options.configs ?? [];
	for (let index = 0; index < configs.length; index += 1) {
		const parsed = spec.parse(spec.extract(configs[index]));
		if (parsed != null) {
			resolved = {
				value: parsed,
				source: options.configSources?.[index] ?? `config:${index}`,
			};
		}
	}

	return (
		resolved ?? {
			value: spec.default,
			source: options.defaultSource ?? "default",
		}
	);
}

export async function resolveRuntimeConfigValueAsync<T>(
	spec: RuntimeConfigValueSpec<T>,
	options: RuntimeConfigValueAsyncOptions,
): Promise<RuntimeConfigValueResolution<T>> {
	const envResult = resolveRuntimeConfigValueFromEnv(spec, options.env);
	if (envResult) return envResult;

	const hostConfigValue = await options.resolveConfig();
	const hostParsed = spec.parse(spec.extract(hostConfigValue));
	if (hostParsed != null) {
		return {
			value: hostParsed,
			source: options.hostConfigSource ?? "host-config",
		};
	}

	for (const layer of options.fallbackConfigs ?? []) {
		const parsed = spec.parse(spec.extract(layer.value));
		if (parsed != null) return { value: parsed, source: layer.source };
	}

	return {
		value: spec.default,
		source: options.defaultSource ?? "default",
	};
}

function resolveRuntimeConfigValueFromEnv<T>(
	spec: RuntimeConfigValueSpec<T>,
	env: RuntimeConfigEnv = process.env,
): RuntimeConfigValueResolution<T> | null {
	for (const probe of spec.envProbes) {
		const parsed = probe.parse(env[probe.name]);
		if (parsed != null) return { value: parsed, source: `env:${probe.name}` };
	}
	return null;
}
