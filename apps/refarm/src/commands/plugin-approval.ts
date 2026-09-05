import type { LedgerScope } from "@refarm.dev/storage-node-view";

import { compositionScopePath } from "../utils/composition-resolver.js";
import { runtimeTrustId } from "./plugin-trust.js";
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

/**
 * THE KEY THE HOST ACTUALLY LOOKS UP — the RUNTIME id, the same one `trusted_plugins` uses.
 *
 * MEASURED against the host on 2026-08-25, because THREE durable records said otherwise and the
 * code never did (ISS-068's body, the comment at `policy_and_fs.rs:421`, and ISS-166 as first
 * filed). The load path computes it and looks the approval up under it:
 *
 *     env_and_runtime.rs load()
 *       let plugin_id = manifest.map(|m| manifest_runtime_plugin_id(&m.id))  // "lsp-code-ops"
 *       Self::scope_to_approved(approved_at_load, &plugin_id, declared)
 *     parse_approved_permissions  inserts config keys RAW — nothing normalises them
 *
 * Corroborated by the host's own fixtures, which key approvals by a bare id
 * (`config_node.rs:601`: `"approvedPermissions": { "vault": ["shell:spawn"] }`).
 *
 * AND A MISS IS PERMISSIVE, which is what makes a wrong key dangerous rather than inert:
 * `scope_to_approved` returns the DECLARED set when the key is absent, so an approval written
 * under an id the load path never uses does not fail to grant — it fails to RESTRICT, while the
 * config reads as a restriction the operator made. Pinned by four Rust tests added the same day;
 * the function had none before.
 *
 * Canonicalising INSIDE the reader and the writer, rather than at each call site, is what
 * `setTrustedPlugin` already does (`runtimeTrustId`, plugin-trust.ts:127) — the writer owns the
 * vocabulary, so no present or future caller can get it wrong.
 */
export function approvalKey(pluginId: string): string {
	return runtimeTrustId(pluginId);
}

/** A key in this config that names the same plugin and that the HOST WILL NEVER LOOK UP.
 *
 * Reported, never migrated — the operator's rule, taken 2026-08-25. Such a key is not a
 * collision to silently merge: it is an approval that never applied, and he is the one who needs
 * to know it did not. Deleting it would also rewrite his config beyond what he asked, on the
 * surface where a confident guess already cost a node-wide deny-all. */
export function ineffectiveApprovalKeys(config: RefarmCliConfig, pluginId: string): string[] {
	const effective = approvalKey(pluginId);
	return Object.keys(config.approvedPermissions ?? {})
		.filter((key) => key !== effective && runtimeTrustId(key) === effective)
		.sort();
}

/** The approved capability ids for `pluginId` in the given config (empty if none). */
export function readApprovedPermissions(config: RefarmCliConfig, pluginId: string): string[] {
	return config.approvedPermissions?.[approvalKey(pluginId)] ?? [];
}

/** The outcome of an approval write — what the envelope reports. */
export interface ApprovalResult {
	pluginId: string;
	filePath: string;
	/** The full approved set after the write (sorted, de-duplicated). */
	approved: string[];
	/** Whether anything changed on disk. */
	changed: boolean;
	/** Keys already in this config that name the same plugin and that the host will never look
	 *  up — approvals that never applied. Reported so the operator can remove them; nothing here
	 *  touches them. Empty in the ordinary case. */
	ineffectiveKeys: string[];
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
	const key = approvalKey(pluginId);
	const before = readApprovedPermissions(config, pluginId);
	const approved = [...new Set(capabilities)].sort();
	// Computed BEFORE the write, against the config as it stands: a key that named this plugin
	// and that the host never looked up. The write does not touch it.
	const ineffective = ineffectiveApprovalKeys(config, pluginId);

	const same = before.length === approved.length && before.every((c, i) => c === approved[i]);

	if (!same) {
		const next: Record<string, string[]> = {
			...(config.approvedPermissions ?? {}),
		};
		if (approved.length === 0) {
			delete next[key];
		} else {
			next[key] = approved;
		}
		write(filePath, { ...config, approvedPermissions: next });
	}

	return { pluginId: key, filePath, approved, changed: !same, ineffectiveKeys: ineffective };
}
