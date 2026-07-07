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
