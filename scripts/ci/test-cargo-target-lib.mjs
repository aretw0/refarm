import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	agentWasmPath,
	resolveCargoTargetDir,
	tractorBinaryPath,
} from "../lib/cargo-target.mjs";

const TRACTOR_NAME = process.platform === "win32" ? "tractor.exe" : "tractor";

function tempRoot() {
	return mkdtempSync(path.join(tmpdir(), "refarm-cargo-target-"));
}

function writeCargoConfig(root, targetDir) {
	mkdirSync(path.join(root, ".cargo"), { recursive: true });
	writeFileSync(
		path.join(root, ".cargo", "config.toml"),
		`[build]\njobs = 4\ntarget-dir = "${targetDir}"\n`,
	);
}

test("CARGO_TARGET_DIR wins over everything and is resolved absolute", () => {
	const root = tempRoot();
	try {
		writeCargoConfig(root, ".cache/cargo-target");
		const dir = resolveCargoTargetDir(root, { CARGO_TARGET_DIR: "custom-target" });
		assert.equal(dir, path.resolve("custom-target"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a relative target-dir in .cargo/config.toml resolves against the root", () => {
	const root = tempRoot();
	try {
		writeCargoConfig(root, ".cache/cargo-target");
		assert.equal(
			resolveCargoTargetDir(root, {}),
			path.join(root, ".cache", "cargo-target"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an absolute target-dir in .cargo/config.toml is used as-is", () => {
	const root = tempRoot();
	try {
		writeCargoConfig(root, "/somewhere/else/cargo-target");
		assert.equal(resolveCargoTargetDir(root, {}), "/somewhere/else/cargo-target");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("no config at all falls back to .cache/cargo-target under the root", () => {
	const root = tempRoot();
	try {
		assert.equal(
			resolveCargoTargetDir(root, {}),
			path.join(root, ".cache", "cargo-target"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("binary and wasm paths compose from the resolved target dir", () => {
	const root = tempRoot();
	try {
		writeCargoConfig(root, ".cache/cargo-target");
		const target = path.join(root, ".cache", "cargo-target");
		assert.equal(
			tractorBinaryPath(root, {}),
			path.join(target, "release", TRACTOR_NAME),
		);
		assert.equal(
			agentWasmPath(root, {}),
			path.join(target, "wasm32-wasip1", "release", "agent.wasm"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
