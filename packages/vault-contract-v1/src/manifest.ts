import type { PluginManifest } from "@refarm.dev/plugin-manifest";

import { VAULT_VERBS, type VaultVerb } from "./types.js";

/**
 * The manifest descriptor for a vault:v1 plugin — the DECLARATION half. It
 * advertises the four verbs as `capabilities.provides` (`<pluginKey>:<verb>`) and
 * points `entry` at the component `.wasm`. Building it from the contract's own
 * verb list keeps the manifest in step with the contract: add a verb and the
 * provides list follows.
 *
 * Why this matters for §8: with the manifest SHAPE fixed now, the §8 install is a
 * mere swap — the only field §8 supplies is the real `integrity` (the SHA-256 of
 * the built `.wasm`). A `.wasm`-entry manifest is DELIBERATELY invalid until then
 * (`validatePluginManifest` reports "integrity is required for .wasm entries"),
 * which is the contract making the build-time hash a hard requirement, not an
 * afterthought. So the foundation ships the manifest WITHOUT integrity (honestly
 * incomplete-until-build); §8 stamps the real digest and it becomes valid.
 */

/** The runtime event a vault plugin subscribes to — the on-event name a caller
 * (or the effort router) sends to dispatch a verb. The plugin's on-event handler
 * answers exactly this event. */
export const VAULT_DISPATCH_EVENT = "vault:dispatch" as const;

/** The provides target for one verb: `<pluginKey>:<verb>` (e.g. `vault:extract`),
 * the same string the task-run preflight and vaultProvidesTarget use. */
export function vaultProvides(pluginKey: string): string[] {
	return VAULT_VERBS.map((verb: VaultVerb) => `${pluginKey}:${verb}`);
}

/** Per-verb usage prose the agent leg surfaces in the system prompt (promptSnippet
 * Slice 2), keyed by the same `<pluginKey>:<verb>` string in `provides`. Teaches
 * the agent what each vault verb does + how to shape its args — richer than the
 * host boilerplate. */
const VAULT_VERB_PROSE: Record<VaultVerb, string> = {
	search:
		"Search the vault by semantic query. Pass a note (path + text) as `note` and a `profile`; returns matching records.",
	extract:
		"Extract structured KnowledgeRecords from a note's content per the profile's rules. Pass `note` and `profile`; the records are persisted as JSON-LD nodes.",
	organize:
		"Organize a note into the vault (validated for quality first). Pass `note` and `profile`.",
	profile:
		"Summarize a note against a profile — returns the vault's view without persisting. Pass `note` and `profile`.",
};

/** The `verbDocs` map for a vault plugin keyed by `<pluginKey>:<verb>`. */
export function vaultVerbDocs(pluginKey: string): Record<string, string> {
	return Object.fromEntries(
		VAULT_VERBS.map((verb: VaultVerb) => [
			`${pluginKey}:${verb}`,
			VAULT_VERB_PROSE[verb],
		]),
	);
}

export interface VaultManifestOptions {
	/** The plugin package id, e.g. `@demo/vault-extract`. */
	id: string;
	/** Human-readable name; defaults to the id. */
	name?: string;
	version?: string;
	/** The `<pluginKey>` the verbs are advertised under (e.g. `vault`). Defaults
	 * to `vault`, so provides are `vault:search`, `vault:extract`, … */
	pluginKey?: string;
	/** The component entry. Defaults to a `.wasm` placeholder path; the §8 install
	 * swaps this for the real hashed artifact. */
	entry?: string;
	/** The subresource-integrity digest of the built `.wasm`
	 * (`sha256-<64hex|base64>`). Omitted by the foundation — a `.wasm` manifest is
	 * invalid until §8 supplies the real digest. */
	integrity?: string;
	/** SPI consumer side: named APIs this vault requires (discovered via
	 * get-plugin-api, called via call-plugin). Defaults to `["QualityApi"]` — the
	 * reference vault validates record quality before persisting. Pass `[]` for a
	 * vault that doesn't depend on the SPI. */
	requiresApi?: string[];
}

/** The placeholder entry a not-yet-built vault plugin ships — a `.wasm` path so
 * `detectEntryFormat` classifies it as a wasm entry. The §8 install replaces it
 * with the transpiled component's real path. */
export const VAULT_ENTRY_PLACEHOLDER = "./pkg/vault_surface.wasm";

/**
 * Build the canonical vault:v1 plugin manifest as a plain descriptor object. By
 * default it OMITS `integrity`, so a `.wasm`-entry manifest is (correctly)
 * invalid until §8 computes the digest — call with `integrity` set to produce the
 * install-ready, valid manifest. It is a plain literal, not a call into the §8
 * plugin-manifest builder, so this contract owns its own manifest shape.
 */
export function buildVaultPluginManifest(
	options: VaultManifestOptions,
): PluginManifest {
	const pluginKey = options.pluginKey ?? "vault";
	const manifest: PluginManifest = {
		id: options.id,
		name: options.name ?? options.id,
		version: options.version ?? "0.1.0",
		entry: options.entry ?? VAULT_ENTRY_PLACEHOLDER,
		capabilities: {
			provides: vaultProvides(pluginKey),
			requires: [],
			// The runtime event the plugin's on-event handler answers — what the
			// neutral event router delivers so a loaded vault plugin receives its
			// OWN dispatch (not just the elected agent's user:prompt).
			subscribes: [VAULT_DISPATCH_EVENT],
			// SPI consumer side: vault validates a record's quality before persisting
			// (organize/extract), discovering the provider via get-plugin-api and
			// calling it via call-plugin. Advisory at load; get-plugin-api fails
			// honestly if no provider is present.
			requiresApi: options.requiresApi ?? ["QualityApi"],
			// Per-verb prose the agent leg surfaces in the system prompt so the model
			// knows what each vault verb does (promptSnippet Slice 2).
			verbDocs: vaultVerbDocs(pluginKey),
		},
		permissions: [],
		observability: {
			// The manifest requires all five lifecycle hooks; a vault surface is
			// pure compute, so these are declared (the host wires telemetry), not
			// capability-bearing.
			hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
		},
		targets: ["server"],
		certification: {
			license: "MIT",
			a11yLevel: 0,
			languages: ["en"],
		},
	};
	if (options.integrity !== undefined) manifest.integrity = options.integrity;
	return manifest;
}
