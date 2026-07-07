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

/** The scope key the seq maps use: `<id>` for a plugin, `<id>:<cap>` for a capability. */
function scopeKey(pluginId: string, capability: string | null): string {
	return capability === null ? pluginId : `${pluginId}:${capability}`;
}

/** The seq-map field names for a scope (plugin vs capability). */
function seqFields(capability: string | null): { revoke: "revokedPluginsSeq" | "revokedPermissionsSeq"; annul: "revokedPluginsAnnul" | "revokedPermissionsAnnul" } {
	return capability === null
		? { revoke: "revokedPluginsSeq", annul: "revokedPluginsAnnul" }
		: { revoke: "revokedPermissionsSeq", annul: "revokedPermissionsAnnul" };
}

/**
 * The next monotonic seq for a scope — strictly above BOTH the current revoke seq and
 * the current annul seq. This is what makes un-revoke and re-revoke reversible: each
 * flips the balance by writing a seq higher than the opposing fact. The seq is operator
 * intent on one causal chain per id (NOT a clock), so it converges cross-device.
 */
function nextSeq(config: RefarmCliConfig, capability: string | null, key: string): number {
	const f = seqFields(capability);
	const revokeSeq = config[f.revoke]?.[key] ?? 1;
	const annulSeq = config[f.annul]?.[key] ?? 0;
	return Math.max(revokeSeq, annulSeq) + 1;
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

type Io = {
	read?: (path: string) => RefarmCliConfig;
	write?: (path: string, config: RefarmCliConfig) => void;
};

/** Set a seq-map entry to `seq`, returning a fresh map (preserves siblings). */
function withSeq(
	current: Record<string, number> | undefined,
	key: string,
	seq: number,
): Record<string, number> {
	return { ...(current ?? {}), [key]: seq };
}

/**
 * Revoke a plugin id entirely, or a single capability of it, at `filePath` — an
 * ADD-ONLY append that preserves all sibling config. Appends to the revoked list AND
 * bumps the per-scope revoke seq strictly above any existing annulment, so a re-revoke
 * after an un-revoke denies again (reversible + monotonic). Idempotent: revoking an
 * already-revoked id/cap that is NOT currently annulled is a no-op. Injectable
 * read/write for testability.
 */
export function revoke(
	filePath: string,
	pluginId: string,
	capability: string | null,
	io: Io = {},
): RevocationResult {
	const read = io.read ?? readConfig;
	const write = io.write ?? writeConfig;

	const config = read(filePath);
	const key = scopeKey(pluginId, capability);
	const f = seqFields(capability);
	const annulSeq = config[f.annul]?.[key] ?? 0;
	const revokeSeq = config[f.revoke]?.[key] ?? 1;

	if (capability === null) {
		const before = readRevokedPlugins(config);
		const alreadyRevoked = before.includes(pluginId);
		// A no-op only when already revoked AND not out-ranked by an annulment.
		if (alreadyRevoked && revokeSeq >= annulSeq) {
			return { pluginId, filePath, capability: null, changed: false };
		}
		const revokedPlugins = [...new Set([...before, pluginId])].sort();
		const nextRevoke = nextSeq(config, capability, key);
		write(filePath, {
			...config,
			revokedPlugins,
			revokedPluginsSeq: withSeq(config.revokedPluginsSeq, key, nextRevoke),
		});
		return { pluginId, filePath, capability: null, changed: true };
	}

	const before = readRevokedPermissions(config, pluginId);
	const alreadyRevoked = before.includes(capability);
	if (alreadyRevoked && revokeSeq >= annulSeq) {
		return { pluginId, filePath, capability, changed: false };
	}
	const perms: Record<string, string[]> = { ...(config.revokedPermissions ?? {}) };
	perms[pluginId] = [...new Set([...before, capability])].sort();
	const nextRevoke = nextSeq(config, capability, key);
	write(filePath, {
		...config,
		revokedPermissions: perms,
		revokedPermissionsSeq: withSeq(config.revokedPermissionsSeq, key, nextRevoke),
	});
	return { pluginId, filePath, capability, changed: true };
}

/**
 * Un-revoke a plugin id (or a single capability of it) — the reversible counterpart to
 * `revoke`. Writes an add-only ANNULMENT: it bumps the per-scope annul seq strictly
 * above the current revoke seq, so the host's annulment node out-ranks the revoke and
 * the plugin/cap is re-admitted at load. Monotonic: nothing is removed; a later
 * re-revoke simply bumps the revoke seq back above this. Idempotent when already
 * un-revoked (the annul seq already out-ranks the revoke). Injectable read/write.
 */
export function unrevoke(
	filePath: string,
	pluginId: string,
	capability: string | null,
	io: Io = {},
): RevocationResult {
	const read = io.read ?? readConfig;
	const write = io.write ?? writeConfig;

	const config = read(filePath);
	const key = scopeKey(pluginId, capability);
	const f = seqFields(capability);
	const revokeSeq = config[f.revoke]?.[key] ?? 1;
	const annulSeq = config[f.annul]?.[key] ?? 0;

	const isRevoked =
		capability === null
			? readRevokedPlugins(config).includes(pluginId)
			: readRevokedPermissions(config, pluginId).includes(capability);

	// No-op when there's nothing to un-revoke, or it's already annulled (annul out-ranks).
	if (!isRevoked || annulSeq >= revokeSeq) {
		return { pluginId, filePath, capability, changed: false };
	}

	const nextAnnul = nextSeq(config, capability, key);
	write(filePath, {
		...config,
		[f.annul]: withSeq(config[f.annul], key, nextAnnul),
	});
	return { pluginId, filePath, capability, changed: true };
}
