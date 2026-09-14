/** A single node-declared "this plugin is under development" entry. */
export interface PluginDevelopmentEntry {
	readonly declaredAt: string;
}

/**
 * PURE. Which plugins THIS NODE has declared it is developing, keyed by the RUNTIME id
 * (the vocabulary the load path looks up). A malformed `config.pluginDevelopment` reads
 * as an empty Map, never as a partial or guessed one.
 */
export function readPluginDevelopment(config: unknown): Map<string, PluginDevelopmentEntry>;

/** Whether this node declared it is developing `pluginId`, in either id vocabulary. */
export function isUnderDevelopment(config: unknown, pluginId: string): boolean;
