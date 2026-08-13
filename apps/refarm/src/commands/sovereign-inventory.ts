/**
 * WHAT A NODE'S SOVEREIGN STATE CONSISTS OF, AND WHAT SURVIVES LOSING THE MACHINE.
 *
 * ## Why this exists
 *
 * The operator's stated fear (ISS-123): bringing a node up somewhere else, or on the same machine
 * after a reformat. Three findings on 2026-08-12 turned that from a worry into a measurement — a
 * test wrote a sentinel into his live model route (ISS-121), a second account of one provider
 * destroys the first (ISS-122), and the wizard would repair neither. Each was fixed where the
 * damage happened. None of them answers what is underneath: when the value is gone, there is
 * nothing to restore it from.
 *
 * `refarm context` already reports where the sovereign state is ROOTED. It does not report what it
 * CONTAINS, and it misses a location entirely: `~/.local/share/refarm/{namespace}.db`, which is
 * where the Rust host writes this node's actual data. A command promising "the whole resolved
 * sovereign state" that omits the node's database is the same defect this repository keeps
 * removing — a partial answer wearing a complete one's name.
 *
 * ## The evidence that the gap is felt, not theoretical
 *
 * The operator's own `~/.refarm` holds SIX hand-made backups, named for what he was afraid of
 * losing: `config.json.bak-antes-do-batismo`, `.bak-antes-da-base-declarada`,
 * `.bak-antes-do-workspace-e-no-node`, `.bak-antes-das-conexoes`, `.bak-antes-do-reparo-20260811`,
 * `.bak-20260809005833`. He has been implementing this feature by hand, with semantic names, for
 * days. That is the requirement, already written down by the person who needs it.
 *
 * ## Recoverability is the whole point, and it has THREE states
 *
 * A backup plan needs to know what a backup must CONTAIN, which is different from what exists.
 * Much of a node rebuilds itself: an OAuth token comes back from a login, a checkout comes back
 * from a remote. What does not come back is the operator's decisions — which model, which
 * workspace, which connections — and the work the node has accumulated.
 *
 * `unknown` is not a hedge and never a default. It means this module has no rule for the entry,
 * which is a fact about the module and is reported as such. Rounding an unclassified file to
 * `recoverable` would be the exact shape that loses data: a backup that skipped it, silently.
 */
import fs from "node:fs";
import path from "node:path";

/** Where a value comes back from, when it comes back at all. */
export type RecoverySource = "provider-login" | "git" | "rebuild" | "none";

export interface InventoryEntry {
	/** Absolute path of the file or directory. */
	readonly file: string;
	/** Bytes on disk, or null when the entry could not be measured. */
	readonly bytes: number | null;
	readonly recoverability: "irrecoverable" | "recoverable" | "unknown";
	/** WHERE it comes back from — only meaningful when `recoverable`. */
	readonly source: RecoverySource;
	/** Why this classification, in the operator's terms. Always present, including for `unknown`. */
	readonly reason: string;
	/**
	 * Whether anything DECLARED refers to this entry.
	 *
	 * Its own field rather than folded into recoverability, because "nothing declared points at
	 * this" is a different fact from "this cannot be restored" — a node's data directory can
	 * accumulate files from test runs and scratch namespaces that are undeclared AND irrecoverable,
	 * and calling them one thing would either back up debris or discard data.
	 */
	readonly declared: boolean;
}

/**
 * PURE. Classify one file inside a node's sovereign locations.
 *
 * `declaredNamespace` is the node's own storage namespace, which is what makes `default.db` this
 * node's database and `repro.db` somebody's afternoon. Passing it in rather than reading it keeps
 * the rule testable against a node that does not exist.
 */
export function classifyEntry(file: string, declaredNamespace: string | null): Omit<InventoryEntry, "bytes"> {
	const base = path.basename(file);
	const dir = path.basename(path.dirname(file));

	if (base === "identity.json" && dir === ".silo") {
		return {
			file,
			recoverability: "irrecoverable",
			source: "none",
			declared: true,
			// Mixed on purpose, and classified by its WORST part. The OAuth tokens inside do come
			// back from a login; the route decisions beside them do not, and ISS-121 is exactly the
			// case where those were destroyed and nothing could say what they had been.
			reason: "credentials come back from a login, but the model route and identity beside them do not",
		};
	}
	if (base === "config.json" && dir === ".refarm") {
		return {
			file,
			recoverability: "irrecoverable",
			source: "none",
			declared: true,
			reason: "the operator's declarations — workspaces, connections, processes, declared base",
		};
	}
	if (base.startsWith("config.json.bak")) {
		return {
			file,
			recoverability: "irrecoverable",
			source: "none",
			declared: false,
			reason: "a hand-made backup — undeclared, and the only copy of whatever it holds",
		};
	}
	if (base === "node-id" || base === "node.json") {
		return {
			file,
			recoverability: "irrecoverable",
			source: "none",
			declared: true,
			reason: "this node's identity — a new one is a different node to every peer that trusted it",
		};
	}
	if (base.endsWith(".db") || base.endsWith(".peer")) {
		const namespace = base.replace(/\.(db|peer)$/u, "");
		const isDeclared = declaredNamespace !== null && namespace === declaredNamespace;
		return {
			file,
			recoverability: "irrecoverable",
			source: "none",
			declared: isDeclared,
			reason: isDeclared
				? "this node's own storage namespace — the accumulated work lives here"
				: `namespace "${namespace}" is not the declared one; nothing declared refers to it`,
		};
	}
	if (base.endsWith(".managed.json") || base === "model-rates.v1.json") {
		return {
			file,
			recoverability: "recoverable",
			source: "rebuild",
			declared: true,
			reason: "a managed cache — refarm rewrites it",
		};
	}
	if (dir === "assets") {
		return {
			file,
			recoverability: "unknown",
			source: "none",
			declared: false,
			reason: "content-addressed asset — whether its source still exists is not knowable from here",
		};
	}
	return {
		file,
		recoverability: "unknown",
		source: "none",
		declared: false,
		reason: "no rule classifies this entry — it is unclassified, which is not the same as safe",
	};
}

/**
 * PURE. The summary an operator acts on.
 *
 * Counts rather than a ratio, and `unknown` reported beside the other two rather than folded into
 * either — a percentage would let a growing pile of unclassified files look like progress.
 */
export function summariseInventory(entries: readonly InventoryEntry[]) {
	const irrecoverable = entries.filter((entry) => entry.recoverability === "irrecoverable");
	return {
		total: entries.length,
		irrecoverable: irrecoverable.length,
		recoverable: entries.filter((entry) => entry.recoverability === "recoverable").length,
		unknown: entries.filter((entry) => entry.recoverability === "unknown").length,
		/** Irrecoverable AND nothing declared points at it — the pile that decides nothing on its own. */
		undeclaredIrrecoverable: irrecoverable.filter((entry) => !entry.declared).length,
		/** What a backup must contain to stand this node up again. */
		mustBackUp: irrecoverable.filter((entry) => entry.declared).map((entry) => entry.file),
		/**
		 * The same storage namespace present in MORE THAN ONE location.
		 *
		 * FOUND BY THIS FUNCTION ON THE OPERATOR'S OWN NODE, 2026-08-12, which is why it exists:
		 * `default.db` was in both `~/.refarm/data/refarm/` (294KB, open by the node process) and
		 * `~/.local/share/refarm/` (49KB, last written a week earlier). The second is the path
		 * `packages/tractor/src/storage/sqlite.rs` documents. A backup guided by the documentation
		 * would have saved a stale database and lost a week of work while reporting success.
		 *
		 * This cannot say which one is live — that needs the running process. It says the ambiguity
		 * exists, which is the fact that stops a wrong backup.
		 */
		duplicateNamespaces: duplicateNamespaceGroups(entries),
	};
}

/** PURE. Namespaces (`<name>.db`) appearing under more than one directory, with every path. */
function duplicateNamespaceGroups(entries: readonly InventoryEntry[]) {
	const byNamespace = new Map<string, string[]>();
	for (const entry of entries) {
		if (!entry.file.endsWith(".db")) continue;
		const namespace = path.basename(entry.file).replace(/\.db$/u, "");
		byNamespace.set(namespace, [...(byNamespace.get(namespace) ?? []), entry.file]);
	}
	return [...byNamespace.entries()]
		.filter(([, files]) => files.length > 1)
		.map(([namespace, files]) => ({ namespace, files: files.sort() }));
}

/** The locations a node's sovereign state lives in. Each is reported even when absent — a location
 *  that does not exist is a fact, and omitting it would make the inventory look complete when the
 *  node simply has not written there yet. */
export interface SovereignLocations {
	readonly stateHome: string;
	readonly credentialStore: string;
	readonly dataDir: string;
}

/** PURE. Where to look, given the homes `refarm context` already resolves. */
export function sovereignLocations(
	sovereignHome: string,
	credentialStoreHome: string,
	base: string,
): SovereignLocations {
	return {
		stateHome: sovereignHome,
		credentialStore: credentialStoreHome,
		// THE ONE `refarm context` OMITS. `packages/tractor/src/storage/sqlite.rs` writes
		// `~/.local/share/refarm/{namespace}.db`, which is this node's actual accumulated work.
		dataDir: path.join(base, ".local", "share", "refarm"),
	};
}

/** Walk one location, one level deep plus named subdirectories, and classify what is there. */
export function inventoryLocation(
	dir: string,
	declaredNamespace: string | null,
	deps: { readdir?: typeof fs.readdirSync; stat?: typeof fs.statSync } = {},
): InventoryEntry[] {
	const readdir = deps.readdir ?? fs.readdirSync;
	const stat = deps.stat ?? fs.statSync;
	let names: fs.Dirent[];
	try {
		names = readdir(dir, { withFileTypes: true }) as fs.Dirent[];
	} catch {
		return [];
	}
	const entries: InventoryEntry[] = [];
	for (const name of names) {
		const full = path.join(dir, name.name);
		if (name.isDirectory()) {
			entries.push(...inventoryLocation(full, declaredNamespace, deps));
			continue;
		}
		let bytes: number | null;
		try {
			bytes = stat(full).size;
		} catch {
			// Measured or not measured — never zero, which would read as an empty file.
			bytes = null;
		}
		entries.push({ ...classifyEntry(full, declaredNamespace), bytes });
	}
	return entries;
}

/** Format the human report. Names the locations FIRST, because an inventory's credibility is the
 *  list of places it looked. */
export function formatInventory(
	locations: SovereignLocations,
	entries: readonly InventoryEntry[],
	summary: ReturnType<typeof summariseInventory>,
): string {
	const lines: string[] = ["Sovereign inventory — what this node holds, and what survives losing it", ""];
	lines.push("  looked in:");
	for (const [label, dir] of Object.entries(locations)) {
		lines.push(`    ${label.padEnd(16)} ${dir}${fs.existsSync(dir) ? "" : "  (absent)"}`);
	}
	lines.push("");
	lines.push(
		`  ${summary.total} entries — ${summary.irrecoverable} irrecoverable, ` +
			`${summary.recoverable} recoverable, ${summary.unknown} unclassified`,
	);
	lines.push("");
	lines.push("  a backup must contain:");
	for (const file of summary.mustBackUp) lines.push(`    ${file}`);
	if (summary.undeclaredIrrecoverable > 0) {
		lines.push("");
		lines.push(
			`  ${summary.undeclaredIrrecoverable} irrecoverable entries that NOTHING DECLARED refers to.`,
		);
		lines.push(
			"  Undeclared is not the same as disposable — this module cannot tell scratch from data,",
		);
		lines.push("  and says so rather than choosing for you. `--json` lists them with reasons.");
	}
	for (const duplicate of summary.duplicateNamespaces) {
		lines.push("");
		lines.push(`  AMBIGUOUS — namespace "${duplicate.namespace}" exists in more than one location:`);
		for (const file of duplicate.files) lines.push(`    ${file}`);
		lines.push("  Only the running node knows which it writes. Back up the wrong one and the");
		lines.push("  backup succeeds while the work is lost — check mtime, or ask the live process.");
	}
	if (summary.unknown > 0) {
		lines.push("");
		lines.push(
			`  ${summary.unknown} entries have no rule and are UNCLASSIFIED, which is not the same as safe.`,
		);
	}
	return lines.join("\n");
}
