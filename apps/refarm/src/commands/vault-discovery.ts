import { VAULT_VERBS, type VaultVerb } from "@refarm.dev/vault-contract-v1";
import { findPluginDirs } from "@refarm.dev/plugin-surface-loader/node";
import type {
	VaultDiscoveryResult,
	VaultProviderSummary,
} from "@refarm.dev/capabilities-v1";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { pluginsBaseDir } from "../utils/refarm-home.js";

/**
 * Discover installed plugins that advertise vault:v1 verbs. Like the task-run
 * provides preflight, this reads ONLY each plugin.json's `capabilities.provides`
 * (raw JSON, not full manifest validation) — a plugin advertises what it PROVIDES
 * even when its `entry` is a not-yet-installed template. It NEVER loads or runs a
 * plugin; it only makes vault surfaces VISIBLE to the CLI/REPL/TUI/HTTP. Executing
 * a vault verb through the WASM component is a separate (runtime) concern.
 *
 * A "vault surface" here is any plugin whose provides include a `<key>:<verb>`
 * where `<verb>` is one of the four vault verbs — so a plugin advertising
 * `vault:extract` or `notes:search` surfaces as a vault provider.
 *
 * The discovery-result TYPES (`VaultDiscoveryResult`/`VaultProviderSummary`) live in
 * `@refarm.dev/capabilities-v1` — the neutral block's injected `discover` dep returns
 * this shape. This module owns the IMPL (scanning the refarm plugins dir); it
 * re-exports the types so existing app consumers keep importing them from here.
 */

const VAULT_VERB_SET: ReadonlySet<string> = new Set(VAULT_VERBS);

export type { VaultDiscoveryResult, VaultProviderSummary };

/** Parse a `<pluginKey>:<verb>` provides target into its parts, or undefined if it
 * isn't a vault verb target. */
function parseVaultTarget(
	target: string,
): { pluginKey: string; verb: VaultVerb } | undefined {
	const colon = target.indexOf(":");
	if (colon <= 0) return undefined;
	const pluginKey = target.slice(0, colon);
	const verb = target.slice(colon + 1);
	if (!VAULT_VERB_SET.has(verb)) return undefined;
	return { pluginKey, verb: verb as VaultVerb };
}

/**
 * Scan the plugins dir for vault providers. Reads each plugin.json's
 * `capabilities.provides`; a malformed one is skipped (advisory). Returns one
 * summary per plugin that advertises at least one vault verb.
 */
export function discoverVaultProviders(
	pluginsDir: string = pluginsBaseDir(),
): VaultDiscoveryResult {
	const providers: VaultProviderSummary[] = [];
	const rejected: string[] = [];

	for (const pluginDir of findPluginDirs(pluginsDir)) {
		let parsed: { id?: unknown; capabilities?: { provides?: unknown } };
		try {
			parsed = JSON.parse(
				readFileSync(join(pluginDir, "plugin.json"), "utf-8"),
			) as typeof parsed;
		} catch {
			rejected.push(basename(pluginDir));
			continue;
		}

		const list = parsed.capabilities?.provides;
		if (!Array.isArray(list)) continue;

		let pluginKey = "";
		const verbs: VaultVerb[] = [];
		const targets: string[] = [];
		for (const raw of list) {
			if (typeof raw !== "string") continue;
			const match = parseVaultTarget(raw);
			if (!match) continue;
			pluginKey = match.pluginKey;
			if (!verbs.includes(match.verb)) verbs.push(match.verb);
			targets.push(raw);
		}
		if (verbs.length === 0) continue;

		const pluginId =
			typeof parsed.id === "string" && parsed.id.length > 0
				? parsed.id
				: basename(pluginDir);
		providers.push({ pluginId, pluginKey, verbs, targets });
	}

	return { providers, rejected };
}
