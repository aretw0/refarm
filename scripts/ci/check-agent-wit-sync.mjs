// check:wit — canonical WIT guard (formerly a two-copy sync check).
//
// Since the refarm:plugin@0.1.0 WIT was consolidated into a single canonical
// package (packages/refarm-plugin-wit/wit/), there are no copies to keep in
// sync. This guard now enforces the single-source-of-truth invariant:
//
//   1. The canonical package parses (wasm-tools).
//   2. No .wit file declares `package refarm:plugin@` outside the canonical dir
//      — i.e. nobody resurrected a divergent copy.
//
// See ADR-083 (canonical plugin WIT). Consumers reference the canonical dir via
// their [package.metadata.component.target] path; they never copy it.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const canonicalDir = resolve(root, "packages/refarm-plugin-wit/wit");

// 1. Canonical package must parse.
try {
	execFileSync("wasm-tools", ["component", "wit", canonicalDir], {
		stdio: "pipe",
	});
} catch (error) {
	console.error(
		"[check:wit] canonical WIT package failed to parse:\n" +
			(error.stderr?.toString() ?? error.message),
	);
	process.exit(1);
}

// 2. No `package refarm:plugin@` declaration outside the canonical dir.
const SKIP_DIRS = new Set(["node_modules", "target", ".cache", "dist", ".git"]);
const offenders = [];

function scan(dir) {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			scan(full);
		} else if (entry.endsWith(".wit")) {
			if (full.startsWith(canonicalDir)) continue;
			const text = readFileSync(full, "utf8");
			if (/\bpackage\s+refarm:plugin@/.test(text)) {
				offenders.push(relative(root, full));
			}
		}
	}
}

scan(root);

if (offenders.length > 0) {
	console.error(
		"[check:wit] found `package refarm:plugin@` declared outside the canonical package:\n" +
			offenders.map((f) => `  - ${f}`).join("\n") +
			"\nThe refarm:plugin WIT lives ONLY in packages/refarm-plugin-wit/wit/.\n" +
			"Point the consumer's [package.metadata.component.target] path at that dir instead of copying it.",
	);
	process.exit(1);
}

console.log("[check:wit] OK — canonical WIT parses, no divergent copies");
