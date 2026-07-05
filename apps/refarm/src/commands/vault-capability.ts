import type {
	CapabilityDescriptor,
	CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";

import {
	discoverVaultProviders,
	type VaultDiscoveryResult,
} from "./vault-discovery.js";

/**
 * The `vault` command as a multi-surface CapabilityGroup — the host seam that
 * makes vault:v1 providers VISIBLE across surfaces. A plugin advertising vault
 * verbs (`<key>:search`/`extract`/`organize`/`profile`) now surfaces on `vault
 * list`, the REPL `/vault` slash, the TUI menu, and to the agent from ONE
 * declaration.
 *
 * This slice lists + inspects providers (list/show). It NEVER loads or runs a
 * vault surface — discovery reads a plugin's advertised `provides`, nothing more.
 * DISPATCHING a verb through the WASM component (submit → runtime → instance.call)
 * is the separate "loop" slice; making providers visible is pure, safe metadata.
 *
 * `deps.discover` is injected (defaults to scanning `<refarm-home>/plugins`) so
 * run() stays testable and never touches the filesystem directly.
 */
export interface VaultCommandDeps {
	/** Discover installed vault providers. Defaults to the refarm plugins dir. */
	discover: () => VaultDiscoveryResult;
}

export function defaultVaultDeps(): VaultCommandDeps {
	return {
		discover: () => discoverVaultProviders(),
	};
}

export function createVaultCapabilityGroup(
	deps: VaultCommandDeps = defaultVaultDeps(),
): CapabilityGroup {
	const list: CapabilityDescriptor = {
		name: "list",
		summary: "List vault:v1 providers contributed by installed plugins",
		run() {
			const { providers, rejected } = deps.discover();
			return buildJsonSuccessEnvelope({
				command: "vault",
				operation: "list",
				extra: {
					providers: providers.map((p) => ({
						pluginId: p.pluginId,
						pluginKey: p.pluginKey,
						verbs: p.verbs,
					})),
					rejected,
					count: providers.length,
				},
			});
		},
	};

	const show: CapabilityDescriptor = {
		name: "show",
		summary: "Show one vault provider by plugin id",
		args: [{ name: "id", required: true }],
		run(input) {
			const id = input.args.id as string;
			const { providers } = deps.discover();
			const provider = providers.find((p) => p.pluginId === id);
			if (!provider) {
				return buildJsonErrorEnvelope({
					command: "vault",
					operation: "show",
					error: "vault-provider-not-found",
					message: `No installed plugin advertises vault verbs under "${id}".`,
					nextAction: "Run `vault list` to see vault providers.",
				});
			}
			return buildJsonSuccessEnvelope({
				command: "vault",
				operation: "show",
				extra: {
					provider: {
						pluginId: provider.pluginId,
						pluginKey: provider.pluginKey,
						verbs: provider.verbs,
						targets: provider.targets,
					},
				},
			});
		},
	};

	return {
		name: "vault",
		summary: "Inspect vault:v1 providers contributed by installed plugins",
		actions: { list, show },
		defaultAction: "list",
		transports: {
			cli: {},
			repl: { slashAliases: ["vaults"] },
			http: { method: "GET", path: "/vault" },
		},
		renderers: { tui: { section: "extensions" } },
	};
}
