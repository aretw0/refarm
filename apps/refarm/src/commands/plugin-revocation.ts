import type { LedgerScope } from "@refarm.dev/storage-node-view";

import { compositionScopePath } from "../utils/composition-resolver.js";
import { readConfig, writeConfig, type RefarmCliConfig } from "./config-shared.js";

/**
 * The persistence primitive for REVOCATION (G) — the monotonic counterpart to
 * `plugin-approval.ts`. Where approval writes a replaceable set, revocation is
 * ADD-ONLY: a revoked plugin id (or capability) is a fact that is only ever
 * appended, never removed. This is what makes deny dominate across devices — the
 * host materializes each entry into its own `urn:refarm:revocation:<id>` graph
 * tombstone at load, so a stale concurrent device rewriting the whole config node
 * (a single whole-value LWW register) cannot resurrect a revoked grant. Removing
 * an entry would reintroduce the "absence loses to concurrent presence" race.
 *
 * Surface-NEUTRAL by design (no prompt, no console, no argv) — every surface drives
 * revocation through this one primitive, exactly like the approval loop.
 */

/** Resolve the config file path for a scope; null when the scope is unavailable. */
export function revocationConfigPath(
	scope: LedgerScope,
	deps: {
		cwd?: string;
		home?: string;
		env?: Record<string, string | undefined>;
	} = {},
): string | null {
	return compositionScopePath(scope, deps);
}

/** The revoked plugin ids in the given config (empty if none). */
export function readRevokedPlugins(config: RefarmCliConfig): string[] {
	return config.revokedPlugins ?? [];
}

/** The revoked capabilities for `pluginId` in the given config (empty if none). */
export function readRevokedPermissions(
	config: RefarmCliConfig,
	pluginId: string,
): string[] {
	return config.revokedPermissions?.[pluginId] ?? [];
}

/** The outcome of a revocation write — what the envelope reports. */
export interface RevocationResult {
	pluginId: string;
	filePath: string;
	/** The capability revoked, or null for a whole-plugin revocation. */
	capability: string | null;
	/** Whether anything changed on disk (false if already revoked — idempotent). */
	changed: boolean;
}

/**
 * Revoke a plugin id entirely, or a single capability of it, at `filePath` — an
 * ADD-ONLY append that preserves all sibling config. Idempotent: revoking an
 * already-revoked id/cap is a no-op (revocation is monotonic; there is no
 * un-revoke through this primitive). Injectable read/write for testability.
 */
export function revoke(
	filePath: string,
	pluginId: string,
	capability: string | null,
	io: {
		read?: (path: string) => RefarmCliConfig;
		write?: (path: string, config: RefarmCliConfig) => void;
	} = {},
): RevocationResult {
	const read = io.read ?? readConfig;
	const write = io.write ?? writeConfig;

	const config = read(filePath);

	if (capability === null) {
		// Whole-plugin revocation: append to revokedPlugins (add-only, de-duplicated).
		const before = readRevokedPlugins(config);
		if (before.includes(pluginId)) {
			return { pluginId, filePath, capability: null, changed: false };
		}
		const revokedPlugins = [...new Set([...before, pluginId])].sort();
		write(filePath, { ...config, revokedPlugins });
		return { pluginId, filePath, capability: null, changed: true };
	}

	// Per-capability revocation: append to revokedPermissions[pluginId] (add-only).
	const before = readRevokedPermissions(config, pluginId);
	if (before.includes(capability)) {
		return { pluginId, filePath, capability, changed: false };
	}
	const next: Record<string, string[]> = {
		...(config.revokedPermissions ?? {}),
	};
	next[pluginId] = [...new Set([...before, capability])].sort();
	write(filePath, { ...config, revokedPermissions: next });
	return { pluginId, filePath, capability, changed: true };
}
