import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { findCrateDirs, hasExtraTargets } from "./rust-test-targets-gate.mjs";

function scratch() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "rust-gate-"));
}

test("finds crates by walking, so a new one needs no registry entry", () => {
	// The whole reason this is discovered rather than declared: every hand-maintained registry in
	// this repo has gone stale the same way — right until someone forgets, and forgetting is silent.
	const root = scratch();
	try {
		fs.mkdirSync(path.join(root, "packages/alpha"), { recursive: true });
		fs.mkdirSync(path.join(root, "packages/beta/src"), { recursive: true });
		fs.writeFileSync(path.join(root, "packages/alpha/Cargo.toml"), "[package]\n");
		fs.writeFileSync(path.join(root, "packages/beta/Cargo.toml"), "[package]\n");
		const found = findCrateDirs(root).map((d) => path.relative(root, d));
		assert.deepEqual(found, ["packages/alpha", "packages/beta"]);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("never walks into build output or dependencies", () => {
	// `target/` holds vendored crate sources with their own Cargo.toml. Walking it would check
	// third-party code on every run and take minutes doing it.
	const root = scratch();
	try {
		for (const dir of ["target/debug/x", "node_modules/y", ".cache/z"]) {
			fs.mkdirSync(path.join(root, dir), { recursive: true });
			fs.writeFileSync(path.join(root, dir, "Cargo.toml"), "[package]\n");
		}
		assert.deepEqual(findCrateDirs(root), []);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("checks only crates with targets `--lib` does not reach", () => {
	// A library-only crate is already fully compiled by its own unit tests. Checking it again buys
	// nothing and costs a compile, and this gate exists for what nothing else reads.
	const root = scratch();
	try {
		const libOnly = path.join(root, "lib-only");
		const withTests = path.join(root, "with-tests");
		const withBin = path.join(root, "with-bin");
		for (const dir of [libOnly, withTests, withBin]) fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(libOnly, "Cargo.toml"), "[package]\nname = \"x\"\n");
		fs.writeFileSync(path.join(withTests, "Cargo.toml"), "[package]\nname = \"y\"\n");
		fs.mkdirSync(path.join(withTests, "tests"));
		fs.writeFileSync(path.join(withBin, "Cargo.toml"), "[package]\nname = \"z\"\n\n[[bin]]\nname = \"z\"\n");

		assert.equal(hasExtraTargets(libOnly), false);
		assert.equal(hasExtraTargets(withTests), true, "a tests/ directory is the whole point");
		assert.equal(hasExtraTargets(withBin), true, "a bin is a target --lib never compiles");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("treats an unreadable manifest as nothing to check, rather than failing the gate", () => {
	// Failing here would make an unrelated filesystem problem read as a compile failure, which is
	// the shape this gate exists to remove rather than add.
	assert.equal(hasExtraTargets("/nonexistent-crate-dir"), false);
});
