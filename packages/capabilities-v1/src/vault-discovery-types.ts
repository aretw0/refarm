import type { VaultVerb } from "@refarm.dev/vault-contract-v1";

/**
 * The shape of a vault-provider discovery result — the injected `discover` dep of
 * the vault capability returns this. The neutral block owns the TYPE (so the group's
 * deps interface is self-contained); the host owns the IMPL (scanning its own plugin
 * dir), importing this type from here.
 */

/** One discovered vault provider: the plugin id + the vault verbs it advertises. */
export interface VaultProviderSummary {
	/** The plugin id (from plugin.json `id`, else the directory name). */
	pluginId: string;
	/** The `<pluginKey>` the verbs are scoped under (e.g. `vault`). */
	pluginKey: string;
	/** The vault verbs this plugin advertises, in declaration order, de-duplicated. */
	verbs: VaultVerb[];
	/** The raw `<pluginKey>:<verb>` provides targets that matched. */
	targets: string[];
}

export interface VaultDiscoveryResult {
	providers: VaultProviderSummary[];
	/** Plugin dirs whose plugin.json could not be read (advisory, never thrown). */
	rejected: string[];
}
