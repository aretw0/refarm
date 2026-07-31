import fs from "node:fs";
import path from "node:path";
import type { PackageSource } from "../utils/composition.js";

export interface RefarmCliConfig {
	autostart?: string;
	MODEL_HISTORY_TURNS?: string;
	MODEL_STREAM_RESPONSES?: string;
	MODEL_TOOL_CALL_MAX_ITER?: string;
	operator?: {
		openExternalLinks?: string | boolean;
	};
	runtime?: {
		sidecarUrl?: string;
	};
	tractor?: {
		engine?: string;
	};
	/**
	 * The COMPOSITION layer: which packages this scope activates, with pi-style
	 * `!`-surface suppression. Additive and deliberately NOT a `ConfigKey` — it is
	 * a LIST, not a scalar, so it stays out of the `config get/set/unset` grammar
	 * and is authored via the `config plugins` subcommands. The scalar RMW path
	 * reads+writes the whole object, so it co-habits this file untouched.
	 */
	plugins?: PackageSource[];
	/**
	 * The operator's TRUSTED plugin allowlist — the IDENTITY axis: may this plugin
	 * LOAD AT ALL. Under `SecurityMode::Strict` the host loads only a plugin whose
	 * runtime id is in this set (or `*`); a plugin absent here is rejected at the
	 * load gate before any capability question is asked. Distinct from and orthogonal
	 * to `approvedPermissions` (the effect axis: WHICH host effects a loaded plugin
	 * may use). Entries are RUNTIME plugin ids — the manifest id's last `/` segment
	 * (`@refarm/delegate` → `delegate`), matching what the host compares. `*` is the
	 * permissive wildcard. Authored via `plugin trust`; the host reads it from this
	 * same `.refarm/config.json` at load.
	 */
	trusted_plugins?: string[];
	/**
	 * The operator's APPROVED capability set per plugin id (the effect axis:
	 * fs:read, network:outbound, …). Distinct from `trusted_plugins` (the identity
	 * axis: may this plugin load at all). The host reads this from the same
	 * `.refarm/config.json` at load and intersects it with the plugin's declared
	 * permissions, so approving fewer capabilities actually restricts. Authored via
	 * `plugin approve`. Keyed by plugin id.
	 */
	approvedPermissions?: Record<string, string[]>;
	/**
	 * The operator's ADD-ONLY revocation list — plugin ids revoked entirely (G). A
	 * revocation is a MONOTONIC fact, never a removal: the host materializes each id
	 * into its own `urn:sovereign:revocation:<id>` graph tombstone at load, so a stale
	 * concurrent device cannot resurrect a revoked grant (an absence would lose to
	 * concurrent presence under the config node's whole-value LWW). Authored via
	 * `plugin revoke`; entries are only ever appended, never deleted.
	 */
	revokedPlugins?: string[];
	/**
	 * The operator's ADD-ONLY per-capability revocation list (G): for each plugin id,
	 * the capabilities revoked from it. Materialized into
	 * `urn:sovereign:revocation:<id>:<cap>` tombstones at load. Append-only, like
	 * `revokedPlugins`.
	 */
	revokedPermissions?: Record<string, string[]>;
	/**
	 * The operator's UN-REVOKE (annulment) seq per plugin id (G). An un-revoke writes a
	 * monotonic seq here; the host materializes an annulment node
	 * (`urn:sovereign:revocation:<id>#annul`) carrying it, and the read side nets the
	 * revocation out when the annul seq >= the revoke seq. Monotonic: only ever bumped up.
	 */
	revokedPluginsAnnul?: Record<string, number>;
	/** Per-`<id>:<cap>` un-revoke (annulment) seq — the capability counterpart. */
	revokedPermissionsAnnul?: Record<string, number>;
	/**
	 * The operator's per-id REVOKE seq (G). Defaults to 1; a re-revoke after an
	 * un-revoke bumps it above the annulment seq so deny wins again. Monotonic.
	 */
	revokedPluginsSeq?: Record<string, number>;
	/** Per-`<id>:<cap>` revoke seq — the capability counterpart of `revokedPluginsSeq`. */
	revokedPermissionsSeq?: Record<string, number>;
}

export interface ConfigDeps {
	cwd(): string;
	home(): string;
}

export interface JsonOptionCarrier {
	json?: boolean;
	opts?: () => { json?: boolean; local?: boolean };
	/** The parent command in the chain — recursive so `hasJsonOption` can walk to
	 * an ancestor that owns a `--json` declared higher up (e.g. `config --json`). */
	parent?: JsonOptionCarrier;
}

export function readConfig(filePath: string): RefarmCliConfig {
	if (!fs.existsSync(filePath)) return {};
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as RefarmCliConfig;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read ${filePath}: ${message}`);
	}
}

/** The exact bytes {@link writeConfig} would write. Split out so a mutation can be recorded as a
 *  before/after SNAPSHOT pair before anything touches disk — the record's undo is those bytes. */
export function serializeConfig(config: RefarmCliConfig): string {
	return `${JSON.stringify(config, null, 2)}\n`;
}

export function writeConfig(filePath: string, config: RefarmCliConfig): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, serializeConfig(config), "utf-8");
}

export function hasJsonOption(opts: JsonOptionCarrier, command?: JsonOptionCarrier): boolean {
	if (opts.json === true || opts.opts?.().json === true) return true;
	// Walk the full ancestor chain: commander attaches a `--json` declared on an
	// ancestor (e.g. the top-level `config --json`) to THAT command, so a nested
	// grandchild (`config plugins list`) must look past its immediate parent.
	let node: JsonOptionCarrier | undefined = command;
	while (node) {
		if (node.opts?.().json === true) return true;
		node = node.parent;
	}
	return false;
}

/**
 * `--local`, wherever Commander happened to attach it.
 *
 * Same hazard as `--json`, and for a sharper reason. `config history` declares `--local` AND has
 * an action handler AND has an `undo` subcommand. With Commander's default (options may appear
 * anywhere), the PARENT parses the whole argv first and swallows `--local` — so
 * `config history undo <id> --local` reached the action with `{}` and quietly undid against the
 * HOME trail, reporting the id as missing. `--json` never showed the bug only because
 * {@link hasJsonOption} already walked the ancestors.
 *
 * The scope of an undo is not a place to be approximately right: it decides which file gets
 * rewritten. So it is read the same way, up the whole chain.
 */
export function hasLocalOption(
	opts: { local?: boolean } & JsonOptionCarrier,
	command?: JsonOptionCarrier,
): boolean {
	if (opts.local === true || opts.opts?.().local === true) return true;
	let node: JsonOptionCarrier | undefined = command;
	while (node) {
		if (node.opts?.().local === true) return true;
		node = node.parent;
	}
	return false;
}
