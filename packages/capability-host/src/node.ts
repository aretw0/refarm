import {
	createLocalCapabilityDeps,
	createLocalVaultCommandDeps,
	type CapabilityDeps,
	type RecordsCommandDeps,
	type SourceCommandDeps,
	type SubmitEffort,
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
import { fetchSidecarJson, type SidecarJsonRequestOptions } from "@refarm.dev/sidecar-client";

export {
	defaultTractorBinaryPath,
	startRuntimeDaemon,
	type RuntimeDaemonHandle,
	type RuntimeDaemonOptions,
} from "./runtime-daemon.js";
export {
	installPluginForRuntime,
	type InstalledPlugin,
	type InstallPluginOptions,
} from "./install-plugin.js";
export { createSidecarCallRespond, type SidecarRespondOptions } from "./sidecar-respond.js";
export {
	ingestSourceToRecords,
	type IngestSourceProvider,
	type IngestSourceResult,
	type IngestSourceToRecordsOptions,
	type SourceIngestContext,
	type SourceRecordParser,
} from "./ingest-source.js";

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

export interface LocalRecordsCapabilityDepsOptions extends LocalRecordsCommandDepsOptions {
	source?: SourceCommandDeps;
	vault?: VaultCommandDeps;
}

export interface LocalRecordsCapabilityDeps {
	records: RecordsCommandDeps;
	deps: CapabilityDeps;
}

export interface SidecarSubmitEffortOptions extends SidecarJsonRequestOptions {
	baseUrl?: string | URL;
	envKey?: string;
}

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:42001";
const DEFAULT_SIDECAR_URL_ENV_KEY = "REFARM_SIDECAR_URL";

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

function resolveSidecarBaseUrl(options: SidecarSubmitEffortOptions): string {
	const env = options.env ?? process.env;
	const envKey = options.envKey ?? DEFAULT_SIDECAR_URL_ENV_KEY;
	return String(options.baseUrl ?? env[envKey] ?? DEFAULT_SIDECAR_URL).replace(/\/+$/, "");
}

export function createSidecarSubmitEffort(options: SidecarSubmitEffortOptions = {}): SubmitEffort {
	const baseUrl = resolveSidecarBaseUrl(options);
	return async (effort) => {
		const payload = await fetchSidecarJson<{ effortId?: string }>(
			`${baseUrl}/efforts`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(effort),
			},
			{ ...options, errorLabel: options.errorLabel ?? "runtime HTTP" },
		);
		if (!payload.effortId) {
			throw new Error("sidecar effort response missing effortId");
		}
		return payload.effortId;
	};
}
