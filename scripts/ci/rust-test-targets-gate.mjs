/**
 * TYPE-CHECK THE RUST TARGETS NOTHING ELSE READS.
 *
 * `cargo clippy` (the `lint` script) runs without `--all-targets`, and `cargo test --lib` compiles
 * only the library. Integration tests, benches, examples and binaries are SEPARATE TARGETS, so a
 * test that stopped compiling is invisible to every gate this repo has.
 *
 * Measured 2026-08-18: `packages/tractor/tests/source_provider_sidecar_e2e.rs` had not compiled
 * since `sync_verbs` moved under `profile`, and the whole pipeline was green throughout.
 *
 * ## Discovered, never declared
 *
 * The crate list is WALKED rather than written down. This repository has paid for hand-maintained
 * registries repeatedly — the task-smoke build order, the package scaffold, `vendor:check` wired to
 * nothing — and each cost the same way: the registry is right until someone forgets, and forgetting
 * is silent. A crate that grows a `tests/` directory tomorrow is covered the day it does.
 *
 * ## `check`, not `clippy -D warnings`
 *
 * The question is "does it still compile", and clippy over test targets answers a different one.
 * Its first run here reported doc-comment formatting and a `MutexGuard` held across an await —
 * real, old, and not this. A gate red on arrival is a gate an operator learns to bypass.
 *
 * ## Every failure, not the first
 *
 * The build-order check threw on its first offending entry, and a pre-existing gap sat hidden
 * behind a newly added one until it was fixed (2026-08-18). One-at-a-time reporting turns one audit
 * into as many runs as there are faults, and makes the older fault look caused by the newer.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set(["node_modules", "target", ".cache", ".git", "dist", ".turbo"]);

/** Every crate directory under `root`, found rather than listed. */
export function findCrateDirs(root, depth = 4) {
	const found = [];
	const walk = (dir, level) => {
		if (level > depth) return;
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		if (entries.some((e) => e.isFile() && e.name === "Cargo.toml")) found.push(dir);
		for (const entry of entries) {
			if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
			walk(path.join(dir, entry.name), level + 1);
		}
	};
	walk(root, 0);
	return found.sort();
}

/**
 * PURE. Whether a crate has targets `--lib` does not reach.
 *
 * A library-only crate is already fully compiled by its own unit tests, so checking it again buys
 * nothing and costs a compile. This gate exists for the targets nothing else reads.
 */
export function hasExtraTargets(crateDir, exists = (p) => fs.existsSync(p)) {
	if (["tests", "benches", "examples"].some((d) => exists(path.join(crateDir, d)))) return true;
	try {
		return /^\s*\[\[bin\]\]/mu.test(fs.readFileSync(path.join(crateDir, "Cargo.toml"), "utf8"));
	} catch {
		return false;
	}
}

function main() {
	const root = process.cwd();
	const crates = findCrateDirs(root).filter((dir) => hasExtraTargets(dir));
	if (crates.length === 0) {
		console.log("rust test targets: no crate carries targets beyond its library — nothing to check.");
		return;
	}

	const failures = [];
	for (const crateDir of crates) {
		const rel = path.relative(root, crateDir) || ".";
		const result = spawnSync(
			process.execPath,
			[
				path.join(root, "scripts/ci/cargo-run.mjs"),
				"check",
				"--all-targets",
				"--manifest-path",
				path.join(crateDir, "Cargo.toml"),
			],
			{ cwd: root, encoding: "utf8" },
		);
		if (result.status === 0) {
			console.log(`  ok  ${rel}`);
			continue;
		}
		failures.push({ crate: rel, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() });
	}

	console.log(`rust test targets: ${crates.length - failures.length}/${crates.length} crates compile.`);
	if (failures.length === 0) return;
	for (const failure of failures) {
		console.error(`\n  ✗ ${failure.crate}`);
		console.error(
			failure.output
				.split("\n")
				.filter((line) => /^(error|warning: unused|\s+-->)/u.test(line))
				.slice(0, 12)
				.map((line) => `      ${line}`)
				.join("\n"),
		);
	}
	console.error(
		`\n${failures.length} crate(s) have targets that no longer compile. ` +
			"`cargo clippy` without `--all-targets` and `cargo test --lib` both skip them.",
	);
	process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
