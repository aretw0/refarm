import { pluginIdRuntimeToken } from "@refarm.dev/config/plugin-identity";
import type { LedgerScope } from "@refarm.dev/storage-node-view";

import { compositionScopePath } from "../utils/composition-resolver.js";
import { readConfig, writeConfig, type RefarmCliConfig } from "./config-shared.js";

/**
 * The persistence primitive for the DEVELOPMENT declaration — reads and writes the
 * operator's `pluginDevelopment` map on the sovereign `.refarm/config.json` (the same
 * file the host reads at load). Surface-NEUTRAL by design, the same shape
 * `plugin-trust.ts` already uses: no prompt, no console, no argv — just the
 * read/modify/write over the config, so every surface (CLI, TUI, HTTP, a future PWA)
 * drives the declaration through this one primitive.
 *
 * IN THE NODE'S CONFIG, NEVER IN THE MANIFEST — the load-bearing choice that
 * `packages/config/src/plugin-development.js` carries the full "why" for: a manifest
 * travels WITH the plugin, so an author who marked their own plugin "under
 * development" would ship an artifact that loads unverified on every node that
 * installs it — a supply-chain hole wearing a convenience's clothes. This is a
 * statement by THIS OPERATOR about THIS MACHINE, beside `trusted_plugins` and
 * `approvedPermissions`.
 *
 * KEYED BY THE RUNTIME ID, canonicalised INSIDE this writer — the same discipline
 * `setTrustedPlugin` already applies (`runtimeTrustId`, plugin-trust.ts) and the
 * discipline `setApprovedPermissions` was missing until 2026-08-25 (57ff5cc1), which is
 * why an operator's approval silently failed to apply while the plugin kept every
 * permission it declared (a miss is PERMISSIVE). Canonicalising here means no present
 * or future caller — CLI, TUI, HTTP — can get the key wrong.
 */

/** Resolve the config file path for a scope; null when the scope is unavailable. */
export function developmentConfigPath(
	scope: LedgerScope,
	deps: {
		cwd?: string;
		home?: string;
		env?: Record<string, string | undefined>;
	} = {},
): string | null {
	return compositionScopePath(scope, deps);
}

/** The runtime plugin ids this node has declared it is developing (sorted). */
export function readPluginDevelopmentIds(config: RefarmCliConfig): string[] {
	return Object.keys(config.pluginDevelopment ?? {}).sort();
}

/** The outcome of a development-declaration write — what the envelope reports. */
export interface DevelopmentResult {
	/** The runtime id actually written (post-canonicalisation). */
	pluginId: string;
	filePath: string;
	/** Whether the plugin is declared under development after the write. */
	underDevelopment: boolean;
	/** The date this node declared it, in either direction — null once withdrawn. */
	declaredAt: string | null;
	/** Whether anything changed on disk. */
	changed: boolean;
}

/**
 * Declare (`developing: true`) or withdraw (`developing: false`) the "under
 * development" declaration for `pluginId` at `filePath`, preserving all sibling
 * config. The id is canonicalised to its runtime form first — the same
 * `pluginIdRuntimeToken` projection `packages/config/src/plugin-development.js`'s
 * reader canonicalises to, and the one the load path (Task 7) compares against.
 *
 * Re-declaring an already-declared plugin is a NO-OP (idempotent, like
 * `setTrustedPlugin`) — it does not refresh `declaredAt`, so the date keeps naming
 * when the declaration was FIRST made, which is what "age out loud" (the reader's own
 * doc comment) needs to mean anything. Withdrawing drops the entry; when it was the
 * last one, the `pluginDevelopment` key itself is dropped — matching
 * `setTrustedPlugin`'s "no key at all" permissive-compat convention rather than
 * writing an empty object.
 *
 * Injectable read/write/now for testability; PURE apart from the injected IO.
 */
export function setPluginDevelopment(
	filePath: string,
	pluginId: string,
	developing: boolean,
	io: {
		read?: (path: string) => RefarmCliConfig;
		write?: (path: string, config: RefarmCliConfig) => void;
		/** Injectable clock — defaults to today's date (YYYY-MM-DD), matching the
		 *  `todayOf` convention already used by `credential.ts`. */
		now?: () => string;
	} = {},
): DevelopmentResult {
	const read = io.read ?? readConfig;
	const write = io.write ?? writeConfig;
	const now = io.now ?? (() => new Date().toISOString().slice(0, 10));

	const id = pluginIdRuntimeToken(pluginId.trim());
	const config = read(filePath);
	const before = config.pluginDevelopment ?? {};
	const wasDeclared = Object.hasOwn(before, id);
	const changed = developing ? !wasDeclared : wasDeclared;

	let declaredAt: string | null = wasDeclared ? (before[id]?.declaredAt ?? null) : null;

	if (changed) {
		const next: Record<string, { declaredAt: string }> = { ...before };
		if (developing) {
			declaredAt = now();
			next[id] = { declaredAt };
		} else {
			delete next[id];
			declaredAt = null;
		}
		if (Object.keys(next).length === 0) {
			const { pluginDevelopment: _drop, ...rest } = config;
			write(filePath, rest);
		} else {
			write(filePath, { ...config, pluginDevelopment: next });
		}
	}

	return { pluginId: id, filePath, underDevelopment: developing, declaredAt, changed };
}
