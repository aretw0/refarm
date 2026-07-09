import {
	createLocalCapabilityDeps,
	createLocalVaultCommandDeps,
	type CapabilityDeps,
	type RecordsCommandDeps,
	type SourceCommandDeps,
	type VaultCommandDeps,
} from "@refarm.dev/capabilities-v1";
import {
	createLocalRecordsCommandDeps,
	createLocalRecordsStatePathResolver,
	type LocalRecordsCommandDepsOptions,
	type LocalRecordsStatePathResolver,
	type LocalRecordsStatePathResolverInput,
	type ResolveLocalRecordsStatePathOptions,
} from "@refarm.dev/capabilities-v1/node";

export {
	createLocalRecordsCommandDeps,
	createLocalRecordsStatePathResolver,
	localRecordsStatePath,
	resolveLocalRecordsStatePath,
	type LocalRecordsCommandDepsOptions,
	type LocalRecordsStatePathOptions,
	type LocalRecordsStatePathResolver,
	type LocalRecordsStatePathResolverInput,
	type LocalRecordsStatePathResolverOptions,
	type ResolveLocalRecordsStatePathOptions,
} from "@refarm.dev/capabilities-v1/node";

export interface LocalRecordsAppDefaults {
	statePath: LocalRecordsStatePathResolver;
	defaultOptions(input?: LocalRecordsStatePathResolverInput): { statePath: string };
}

export interface LocalRecordsCapabilityDepsOptions
	extends LocalRecordsCommandDepsOptions {
	source?: SourceCommandDeps;
	vault?: VaultCommandDeps;
}

export interface LocalRecordsCapabilityDeps {
	records: RecordsCommandDeps;
	deps: CapabilityDeps;
}

export function createLocalRecordsAppDefaults(
	defaults: ResolveLocalRecordsStatePathOptions,
): LocalRecordsAppDefaults {
	const statePath = createLocalRecordsStatePathResolver(defaults);
	return {
		statePath,
		defaultOptions: (input = {}) => ({ statePath: statePath(input) }),
	};
}

export function createLocalRecordsCapabilityDeps(
	options: LocalRecordsCapabilityDepsOptions,
): LocalRecordsCapabilityDeps {
	const records = createLocalRecordsCommandDeps(options);
	return {
		records,
		deps: createLocalCapabilityDeps({
			source: options.source,
			vault: options.vault ?? createLocalVaultCommandDeps({ seed: options.seed }),
			records,
		}),
	};
}
