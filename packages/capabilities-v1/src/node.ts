import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createReferenceEnrichmentProvider } from "@refarm.dev/enrichment-contract-v1";
import {
	createReferenceRecordsProvider,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";

import type { RecordsCommandDeps } from "./records-capability.js";

export interface LocalRecordsStatePathOptions {
	cwd?: string;
	appId: string;
	fileName?: string;
}

export interface ResolveLocalRecordsStatePathOptions extends LocalRecordsStatePathOptions {
	envKey?: string;
	env?: Record<string, string | undefined>;
}

export type LocalRecordsStatePathResolverOptions = Pick<
	ResolveLocalRecordsStatePathOptions,
	"cwd" | "env"
>;

export type LocalRecordsStatePathResolverInput = string | LocalRecordsStatePathResolverOptions;

export type LocalRecordsStatePathResolver = (
	options?: LocalRecordsStatePathResolverInput,
) => string;

export interface LocalRecordsCommandDepsOptions {
	seed: () => RecordsManifest;
	statePath?: string;
	enrichmentProvider?: RecordsCommandDeps["enrichmentProvider"];
	recordsProvider?: RecordsCommandDeps["recordsProvider"];
}

export function localRecordsStatePath(options: LocalRecordsStatePathOptions): string {
	return path.join(
		options.cwd ?? process.cwd(),
		`.${options.appId}`,
		options.fileName ?? "manifest.json",
	);
}

export function resolveLocalRecordsStatePath(options: ResolveLocalRecordsStatePathOptions): string {
	const env = options.env ?? process.env;
	const override = options.envKey ? env[options.envKey]?.trim() : undefined;
	return override || localRecordsStatePath(options);
}

export function createLocalRecordsStatePathResolver(
	defaults: ResolveLocalRecordsStatePathOptions,
): LocalRecordsStatePathResolver {
	const normalize = (
		options: LocalRecordsStatePathResolverInput = {},
	): LocalRecordsStatePathResolverOptions =>
		typeof options === "string" ? { cwd: options } : options;
	return (options = {}) =>
		resolveLocalRecordsStatePath({
			...defaults,
			...normalize(options),
		});
}

export function createLocalRecordsCommandDeps(
	options: LocalRecordsCommandDepsOptions,
): RecordsCommandDeps {
	let manifest = loadManifest(options.seed, options.statePath);
	return {
		loadManifest: () => manifest,
		saveManifest: (next) => {
			manifest = next;
			saveManifest(next, options.statePath);
		},
		enrichmentProvider: options.enrichmentProvider ?? createReferenceEnrichmentProvider(),
		recordsProvider: options.recordsProvider ?? createReferenceRecordsProvider(),
	};
}

function loadManifest(seed: () => RecordsManifest, statePath?: string): RecordsManifest {
	if (!statePath || !existsSync(statePath)) return seed();
	return JSON.parse(readFileSync(statePath, "utf-8")) as RecordsManifest;
}

function saveManifest(manifest: RecordsManifest, statePath?: string): void {
	if (!statePath) return;
	mkdirSync(path.dirname(statePath), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}
