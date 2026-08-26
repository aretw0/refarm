import { createHash } from "node:crypto";
import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pluginIdRuntimeToken } from "@refarm.dev/config/plugin-identity";

/** THREE STATES, never two. `absent` is "no claim was made" and is what an unsigned plugin
 *  under development looks like (D3); `mismatch` is "the claim is wrong", which the host
 *  treats as a hard load failure. Collapsing them is what made a stale tree ambiguous. */
export type IntegrityVerdict = "matches" | "mismatch" | "absent";

export interface InstalledPlugin {
	readonly manifestId: string;
	readonly runtimeId: string;
	readonly dir: string;
	readonly integrity: IntegrityVerdict;
}

/**
 * Every tree under the node's plugins directory, whether the daemon was handed it or not.
 * The host receives explicit `--plugin` paths and does not scan, so this enumeration is the
 * CLI's to answer — and until now nothing answered it.
 *
 * Two layouts are live on real nodes (measured 2026-08-25):
 *   - FLAT: `<baseDir>/<fsToken>/plugin.json` — what `installedPluginDir` writes today.
 *   - NESTED: `<baseDir>/@scope/name/plugin.json` — the pre-convergence npm-scope layout
 *     `legacyScopedPluginWasmPath` (plugin-install-path.ts) still names for a read-only
 *     fallback. The scan descends exactly ONE extra level into a directory whose own name
 *     begins with `@`, and nowhere else: an unbounded recursive walk under a directory of
 *     executables is a larger and different promise than "list what plugin.json admits to".
 *
 * Two trees can legitimately share one manifest id (an `@refarm/agent` installed both flat
 * and nested, mid-migration). Both are returned as separate rows, keyed by their own `dir` —
 * this function NEVER dedupes by id. The duplication is the finding this scan exists to
 * surface; collapsing it would hide exactly what the operator cannot currently see.
 */
export function readInstalledPlugins(baseDir: string): InstalledPlugin[] {
	if (!existsSync(baseDir)) return [];
	const out: InstalledPlugin[] = [];
	for (const entry of safeReaddir(baseDir)) {
		if (!entry.isDirectory()) continue;
		const dir = path.join(baseDir, entry.name);
		if (entry.name.startsWith("@")) {
			for (const scoped of safeReaddir(dir)) {
				if (!scoped.isDirectory()) continue;
				readTreeInto(out, path.join(dir, scoped.name));
			}
			continue; // a scope directory never carries a plugin.json of its own
		}
		readTreeInto(out, dir);
	}
	return out.sort(
		(a, b) => a.manifestId.localeCompare(b.manifestId) || a.dir.localeCompare(b.dir),
	);
}

function safeReaddir(dir: string): Dirent[] {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

/** Reads one candidate tree (a directory that may hold `plugin.json` + `plugin.wasm`) and,
 *  if it names itself, appends it. An unreadable or unnamed manifest is skipped, not
 *  guessed at — a tree the scan cannot name is not a tree it may invent a name for. */
function readTreeInto(out: InstalledPlugin[], dir: string): void {
	const manifestPath = path.join(dir, "plugin.json");
	if (!existsSync(manifestPath)) return;
	let manifest: { id?: unknown; integrity?: unknown };
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
	} catch {
		return; // an unreadable manifest is not a tree we can name
	}
	if (typeof manifest.id !== "string") return;
	out.push({
		manifestId: manifest.id,
		runtimeId: pluginIdRuntimeToken(manifest.id),
		dir,
		integrity: verdictFor(dir, manifest.integrity),
	});
}

function verdictFor(dir: string, declared: unknown): IntegrityVerdict {
	if (typeof declared !== "string" || declared.trim() === "") return "absent";
	const wasm = path.join(dir, "plugin.wasm");
	if (!existsSync(wasm)) return "mismatch";
	const computed = createHash("sha256").update(readFileSync(wasm)).digest("hex");
	const hex = declared.trim().toLowerCase().replace(/^sha256[-:]/u, "");
	return hex === computed ? "matches" : "mismatch";
}
