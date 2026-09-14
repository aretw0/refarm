import type { LedgerScope } from "@refarm.dev/storage-node-view";

import { compositionScopePath } from "../utils/composition-resolver.js";
import { readConfig, writeConfig, type RefarmCliConfig } from "./config-shared.js";

/**
 * The persistence primitive for the TRUST loop — reads and writes the operator's
 * `trusted_plugins` allowlist (the IDENTITY axis) on the sovereign
 * `.refarm/config.json` (the same file the host reads at load). Surface-NEUTRAL by
 * design: no prompt, no console, no argv — just the read/modify/write over the
 * config, so every surface (CLI, TUI, HTTP, a future PWA) drives trust through this
 * one primitive.
 *
 * This is the identity counterpart to `plugin-approval.ts`: approval sets WHICH
 * host effects a loaded plugin may use (`approvedPermissions`, keyed by id);
 * trust decides WHETHER a plugin may load at all under `SecurityMode::Strict`
 * (`trusted_plugins`, a flat list). Two orthogonal axes, two separate keys — a
 * plugin can declare zero permissions (so approval is a no-op) yet still need
 * trust to load. The list RMW (readConfig → spread → writeConfig) preserves every
 * sibling untouched.
 */

/**
 * Normalize a plugin id to the RUNTIME id the host compares against `trusted_plugins`
 * — the manifest id's last `/` segment (`@refarm/delegate` → `delegate`, `agent` →
 * `agent`). This mirrors the host's own `manifest_runtime_plugin_id`
 * (`rsplit('/').next()`), so the operator can pass the id they know from
 * `plugin install`/`permissions` (the manifest id) and it still matches at the load
 * gate. `*` (the trust wildcard) is passed through unchanged. PURE.
 */
export function runtimeTrustId(pluginId: string): string {
	const trimmed = pluginId.trim();
	if (trimmed === "*") return "*";
	const segment = trimmed.split("/").pop();
	return segment && segment.trim().length > 0 ? segment.trim() : trimmed;
}

/**
 * PURE. The two ids a plugin has, and an honest `null` when one of them is not knowable from the
 * string alone.
 *
 * THE ASYMMETRY, measured on the operator's node (ISS-068):
 *
 *   trusted_plugins:     ["agent", "lsp-code-ops"]     <- RUNTIME ids
 *   approvedPermissions: { "@refarm/lsp-code-ops": … } <- MANIFEST id
 *
 * Two config keys, two vocabularies, and `plugin status --json` reported both forms under one
 * `id` field. Getting it wrong is not a typo: an INVALID `trusted_plugins` entry makes the daemon
 * log "trusted_plugins config unreadable" and deny every plugin — three states, not two, where
 * absent is permissive and invalid is deny-all.
 *
 * `runtimeId` is always derivable: it is the last `/` segment, mirroring the host's own
 * `manifest_runtime_plugin_id`.
 *
 * `manifestId` is NOT. A scoped id is already one; a bare id maps back only through a declared
 * alias, and `lsp-code-ops` has none — its real manifest id is `@refarm/lsp-code-ops`, which no
 * function here can derive. So this returns `null` rather than guessing, because a confidently
 * wrong manifest id is the exact failure this item is about: the deny-all on the operator's node
 * came from a confident reading of an id, not from a typo. A `null` sends the reader to
 * `refarm plugin approve`, which normalises correctly.
 */
export function pluginIdPair(pluginId: string, alias: (id: string) => string = (id) => id): {
	runtimeId: string;
	manifestId: string | null;
} {
	const trimmed = pluginId.trim();
	if (trimmed === "*") return { runtimeId: "*", manifestId: null };
	const runtimeId = runtimeTrustId(trimmed);
	if (trimmed.includes("/")) return { runtimeId, manifestId: trimmed };
	const aliased = alias(trimmed);
	return { runtimeId, manifestId: aliased !== trimmed ? aliased : null };
}

/** Resolve the config file path for a scope; null when the scope is unavailable. */
export function trustConfigPath(
	scope: LedgerScope,
	deps: {
		cwd?: string;
		home?: string;
		env?: Record<string, string | undefined>;
	} = {},
): string | null {
	return compositionScopePath(scope, deps);
}

/** The current trusted plugin ids in the given config (empty if none). */
export function readTrustedPlugins(config: RefarmCliConfig): string[] {
	return config.trusted_plugins ?? [];
}

/** The outcome of a trust write — what the envelope reports. */
export interface TrustResult {
	/** The runtime id actually written (post-normalization). */
	pluginId: string;
	filePath: string;
	/** Whether the plugin is trusted after the write. */
	trusted: boolean;
	/** The full trusted set after the write (sorted, de-duplicated). */
	trustedPlugins: string[];
	/** Whether anything changed on disk. */
	changed: boolean;
}

/**
 * Add (`trusted: true`) or remove (`trusted: false`) `pluginId` from the
 * `trusted_plugins` allowlist at `filePath`, preserving all sibling config. The id
 * is normalized to its runtime form first (so the host matches it at load). The
 * written list is de-duplicated and sorted for a stable, diff-friendly file. When
 * removing the last entry, the key is dropped entirely (an empty allowlist under
 * Strict trusts nothing — but "no key at all" is the host's permissive-compat
 * signal, so we prefer dropping to writing `[]`, matching approval's delete-on-empty
 * and avoiding an accidental deny-all). Injectable read/write for testability. PURE
 * apart from the injected IO.
 */
export function setTrustedPlugin(
	filePath: string,
	pluginId: string,
	trusted: boolean,
	io: {
		read?: (path: string) => RefarmCliConfig;
		write?: (path: string, config: RefarmCliConfig) => void;
	} = {},
): TrustResult {
	const read = io.read ?? readConfig;
	const write = io.write ?? writeConfig;

	const id = runtimeTrustId(pluginId);
	const config = read(filePath);
	const before = readTrustedPlugins(config);
	const beforeSet = new Set(before);

	const wasTrusted = beforeSet.has(id);
	const changed = trusted ? !wasTrusted : wasTrusted;

	if (changed) {
		if (trusted) beforeSet.add(id);
		else beforeSet.delete(id);
		const next = [...beforeSet].sort();
		if (next.length === 0) {
			const { trusted_plugins: _drop, ...rest } = config;
			write(filePath, rest);
		} else {
			write(filePath, { ...config, trusted_plugins: next });
		}
	}

	const trustedPlugins = [...beforeSet].sort();
	return { pluginId: id, filePath, trusted: trustedPlugins.includes(id), trustedPlugins, changed };
}
