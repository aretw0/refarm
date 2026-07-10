import type { LedgerScope } from "@refarm.dev/storage-node-view";

import { compositionScopePath } from "../utils/composition-resolver.js";
import { readConfig, writeConfig, type RefarmCliConfig } from "./config-shared.js";

/**
 * The persistence primitive for the persona approval loop — reads and writes the
 * operator-APPROVED capability set per plugin id, on the sovereign
 * `.refarm/config.json` (the same file the host reads at load). It is surface-
 * NEUTRAL by design: no prompt, no console, no argv — just the read/modify/write
 * over the config. Every surface (CLI, TUI, HTTP, a future PWA) drives approval
 * through this one primitive, so the loop's base is solid and each surface is a
 * thin projection over it.
 *
 * The approved set rides `approvedPermissions` — a SEPARATE key from
 * `trusted_plugins` (identity vs capability are orthogonal axes). The scalar RMW
 * (readConfig → spread → writeConfig) preserves every sibling untouched.
 */

/** Resolve the config file path for a scope; null when the scope is unavailable. */
export function approvalConfigPath(
	scope: LedgerScope,
	deps: {
		cwd?: string;
		home?: string;
		env?: Record<string, string | undefined>;
	} = {},
): string | null {
	return compositionScopePath(scope, deps);
}

/** The approved capability ids for `pluginId` in the given config (empty if none). */
export function readApprovedPermissions(config: RefarmCliConfig, pluginId: string): string[] {
	return config.approvedPermissions?.[pluginId] ?? [];
}

/** The outcome of an approval write — what the envelope reports. */
export interface ApprovalResult {
	pluginId: string;
	filePath: string;
	/** The full approved set after the write (sorted, de-duplicated). */
	approved: string[];
	/** Whether anything changed on disk. */
	changed: boolean;
}

/**
 * Set the approved capability set for `pluginId` to exactly `capabilities`
 * (de-duplicated, sorted) at `filePath`, preserving all sibling config. A
 * capability list is a full replacement of the plugin's approved set — an empty
 * list (from `--deny`) revokes all. Injectable read/write for testability.
 */
export function setApprovedPermissions(
	filePath: string,
	pluginId: string,
	capabilities: string[],
	io: {
		read?: (path: string) => RefarmCliConfig;
		write?: (path: string, config: RefarmCliConfig) => void;
	} = {},
): ApprovalResult {
	const read = io.read ?? readConfig;
	const write = io.write ?? writeConfig;

	const config = read(filePath);
	const before = readApprovedPermissions(config, pluginId);
	const approved = [...new Set(capabilities)].sort();

	const same = before.length === approved.length && before.every((c, i) => c === approved[i]);

	if (!same) {
		const next: Record<string, string[]> = {
			...(config.approvedPermissions ?? {}),
		};
		if (approved.length === 0) {
			delete next[pluginId];
		} else {
			next[pluginId] = approved;
		}
		write(filePath, { ...config, approvedPermissions: next });
	}

	return { pluginId, filePath, approved, changed: !same };
}
