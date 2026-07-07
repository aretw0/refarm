import { type PluginPackageSource } from "@refarm.dev/barn";
import {
	pluginIdToFsToken,
	REFARM_BUNDLED_PLUGIN_DESCRIPTORS,
} from "@refarm.dev/config/plugin-identity";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import { RUNTIME_AGENT_RELOAD_JSON_COMMAND } from "./plugin-handoffs.js";

// Plugins bundled with the refarm npm package — auto-installed and updated by farmhand on boot.
export const BUNDLED_PLUGINS = REFARM_BUNDLED_PLUGIN_DESCRIPTORS;
export type BundledPlugin = (typeof REFARM_BUNDLED_PLUGIN_DESCRIPTORS)[number];
export const PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND = RUNTIME_AGENT_RELOAD_JSON_COMMAND;

export interface PluginListEntry {
	id: string;
	version: string | null;
	source: "bundled";
	packageSource: PluginPackageSource;
	packageDir: string | null;
	installed: boolean;
}

export interface PluginListReport {
	plugins: PluginListEntry[];
	ok?: true;
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
}

export interface RuntimePluginStatusEntry {
	id: string;
	installed: boolean;
	loaded: boolean;
	local: boolean;
}

export interface RuntimePluginStatusReport {
	command: "plugin";
	operation: "status";
	ok: boolean;
	available: boolean;
	plugins: RuntimePluginStatusEntry[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
	recommendations?: RuntimePluginRecommendation[];
	recovery?: {
		ensure: string;
		start: string;
		status: string;
		doctorNextAction: string;
		doctor: string;
	};
}

export interface RuntimePluginRecommendation {
	diagnostic: string;
	severity: "failure" | "warning" | "info";
	summary: string;
	action: string;
	command?: string;
}

export type PluginInstallStatus = "installed" | "cached" | "failed";

export interface PluginInstallResult {
	id: string;
	packageName: string;
	status: PluginInstallStatus;
	version: string | null;
	packageSource: PluginPackageSource;
	packageDir?: string;
	message?: string;
	buildCommand?: string;
	bytes?: number;
	integrity?: string;
}

export interface PluginInstallReport {
	failed: number;
	plugins: PluginInstallResult[];
	ok?: boolean;
	error?: string;
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
}

export function pluginsBaseDir(): string {
	return path.join(resolveRefarmHome(), "plugins");
}

// The filesystem-safe plugin-id projection lives with the rest of plugin
// identity in @refarm.dev/config (neutral, shared by the CLI, the Barn, and any
// storage backend) — never reimplemented per consumer. Re-exported so the
// existing plugin-* command imports keep one import site, and used by
// sentinelPath below.
export { pluginIdToFsToken };

export function readPackageVersion(pkgDir: string): string | null {
	try {
		const pkgJson = JSON.parse(
			readFileSync(path.join(pkgDir, "package.json"), "utf-8"),
		) as { version?: string };
		return pkgJson.version ?? null;
	} catch {
		return null;
	}
}

export function sentinelPath(pluginId: string): string {
	return path.join(pluginsBaseDir(), ".versions", pluginIdToFsToken(pluginId));
}

export async function readInstalledVersion(pluginId: string): Promise<string | null> {
	try {
		return (await readFile(sentinelPath(pluginId), "utf-8")).trim();
	} catch {
		return null;
	}
}
