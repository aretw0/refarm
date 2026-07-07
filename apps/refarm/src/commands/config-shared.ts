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
	 * The operator's APPROVED capability set per plugin id (the effect axis:
	 * fs:read, network:outbound, …). Distinct from `trusted_plugins` (the identity
	 * axis: may this plugin load at all). The host reads this from the same
	 * `.refarm/config.json` at load and intersects it with the plugin's declared
	 * permissions, so approving fewer capabilities actually restricts. Authored via
	 * `plugin approve`. Keyed by plugin id.
	 */
	approvedPermissions?: Record<string, string[]>;
}

export interface ConfigDeps {
	cwd(): string;
	home(): string;
}

export interface JsonOptionCarrier {
	json?: boolean;
	opts?: () => { json?: boolean };
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

export function writeConfig(filePath: string, config: RefarmCliConfig): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
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
