import {
	createLocalRecordsStatePathResolver,
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

export function createLocalRecordsAppDefaults(
	defaults: ResolveLocalRecordsStatePathOptions,
): LocalRecordsAppDefaults {
	const statePath = createLocalRecordsStatePathResolver(defaults);
	return {
		statePath,
		defaultOptions: (input = {}) => ({ statePath: statePath(input) }),
	};
}
