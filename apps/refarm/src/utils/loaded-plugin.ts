import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The plugin a running node ACTUALLY loaded, with the hash that proves which bytes.
 *
 * This module exists because of a measured failure on 2026-08-05. The freshness check
 * reconstructed the plugin path as `plugins/@refarm/agent/plugin.wasm` while the daemon was
 * started with `--plugin .../plugins/refarm_agent/plugin.wasm`. Both files existed, in the
 * same sovereign dir, written the same day, 477,924 bytes against 476,441 — different
 * builds. So `refarm doctor` reported a fresh node, correctly, about a file nothing loads,
 * and two agents lost a diagnosis to it.
 *
 * The lesson is not "fix the path". A reconstructed path drifts again the next time an
 * installer moves; the process's own argv cannot. Read what it was started with.
 */
export interface LoadedPlugin {
	path: string;
	/** `null` when the file could not be hashed — paired with `unreadableReason`, never bare. */
	sha256: string | null;
	unreadableReason?: string;
}

export interface LoadedPluginDeps {
	readCommandLine?(pid: number): string[] | null;
	hashFile?(path: string): string | null;
}

/**
 * The value of the first `--plugin` in an argv, in either the separated or the `=` form.
 *
 * FIRST, not last: the host reads its own argv the same way, and a report that disagreed
 * with the process about which of two flags won would be a new instrument telling a new lie.
 * A dangling `--plugin` yields `undefined` rather than swallowing whatever follows.
 */
export function parsePluginArgFromCommandLine(commandLine: string[]): string | undefined {
	for (let i = 0; i < commandLine.length; i += 1) {
		const arg = commandLine[i];
		if (arg === "--plugin") {
			const value = commandLine[i + 1];
			return value && !value.startsWith("--") ? value : undefined;
		}
		if (arg?.startsWith("--plugin=")) {
			const value = arg.slice("--plugin=".length);
			return value.length > 0 ? value : undefined;
		}
	}
	return undefined;
}

/**
 * Parse the NUL-separated command line from /proc/<pid>/cmdline.
 * Splits on NUL bytes and removes only the trailing empty string produced by the terminating NUL,
 * preserving any interior empty arguments as they appear in the actual argv.
 */
export function parseProcCommandLine(raw: string): string[] | null {
	const parts = raw.split("\0");
	// Remove only the trailing empty string produced by the terminating NUL
	if (parts.length > 0 && parts[parts.length - 1] === "") {
		parts.pop();
	}
	return parts.length > 0 ? parts : null;
}

function defaultReadCommandLine(pid: number): string[] | null {
	try {
		const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
		return parseProcCommandLine(raw);
	} catch {
		return null;
	}
}

export function defaultHashFile(target: string): string | null {
	try {
		return createHash("sha256").update(readFileSync(target)).digest("hex");
	} catch {
		return null;
	}
}

/**
 * `null` means this could not be established at all — a process that is gone, or one naming
 * no plugin. An unhashable file is NOT null: the path is a real finding on its own, and
 * flattening it to null would lose the difference between "no plugin" and "a plugin I cannot
 * read", which is exactly the two-states-where-three-belong mistake this work exists to undo.
 */
export function resolveLoadedPlugin(pid: number, deps: LoadedPluginDeps = {}): LoadedPlugin | null {
	const readCommandLine = deps.readCommandLine ?? defaultReadCommandLine;
	const hashFile = deps.hashFile ?? defaultHashFile;

	const commandLine = readCommandLine(pid);
	if (!commandLine) return null;

	const pluginPath = parsePluginArgFromCommandLine(commandLine);
	if (!pluginPath) return null;

	const sha256 = hashFile(pluginPath);
	return sha256
		? { path: pluginPath, sha256 }
		: { path: pluginPath, sha256: null, unreadableReason: "the loaded plugin could not be read to hash it" };
}
