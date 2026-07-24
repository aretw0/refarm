import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildManifest,
	integrityOf,
	isSafeRelPath,
	parseManifest,
	planUpdate,
} from "../src/manifest.mjs";

test("integrityOf is SRI-style sha256-<base64> and stable", () => {
	const a = integrityOf("hello");
	assert.match(a, /^sha256-[A-Za-z0-9+/]+=*$/);
	assert.equal(a, integrityOf(Buffer.from("hello")));
	assert.notEqual(a, integrityOf("world"));
});

test("isSafeRelPath rejects absolutes, dotdot, and empty segments", () => {
	assert.equal(isSafeRelPath("bin/farm-ask.mjs"), true);
	assert.equal(isSafeRelPath("src/index.mjs"), true);
	assert.equal(isSafeRelPath("/etc/passwd"), false);
	assert.equal(isSafeRelPath("../secret"), false);
	assert.equal(isSafeRelPath("a/../../b"), false);
	assert.equal(isSafeRelPath("C:\\win"), false);
	assert.equal(isSafeRelPath(""), false);
});

test("parseManifest normalizes and tolerates a JSON string", () => {
	const raw = JSON.stringify({
		name: "farm-client",
		version: "0.1.0",
		files: [{ path: "bin/farm-ask.mjs", integrity: "sha256-x", bytes: 10 }],
	});
	const m = parseManifest(raw);
	assert.equal(m.name, "farm-client");
	assert.equal(m.version, "0.1.0");
	assert.equal(m.platform, null);
	assert.equal(m.files[0].path, "bin/farm-ask.mjs");
});

test("parseManifest rejects a hostile file path — the contract is the guard", () => {
	assert.throws(
		() => parseManifest({ name: "x", version: "1", files: [{ path: "../evil", integrity: "sha256-x" }] }),
		/unsafe file path/,
	);
});

test("parseManifest throws on missing name/version", () => {
	assert.throws(() => parseManifest({ version: "1", files: [] }), /missing name/);
	assert.throws(() => parseManifest({ name: "x", files: [] }), /missing version/);
});

test("planUpdate: nothing installed downloads everything", () => {
	const remote = {
		name: "farm-client",
		version: "0.2.0",
		files: [
			{ path: "a.mjs", integrity: "sha256-a", bytes: 100 },
			{ path: "b.mjs", integrity: "sha256-b", bytes: 200 },
		],
	};
	const plan = planUpdate(remote, null);
	assert.equal(plan.upToDate, false);
	assert.equal(plan.fromVersion, null);
	assert.equal(plan.toVersion, "0.2.0");
	assert.equal(plan.toDownload.length, 2);
	assert.equal(plan.totalBytes, 300);
});

test("planUpdate: only changed-integrity files are downloaded", () => {
	const remote = {
		name: "farm-client",
		version: "0.2.0",
		files: [
			{ path: "a.mjs", integrity: "sha256-a2", bytes: 100 }, // changed
			{ path: "b.mjs", integrity: "sha256-b", bytes: 200 }, // same
		],
	};
	const local = {
		name: "farm-client",
		version: "0.1.0",
		files: [
			{ path: "a.mjs", integrity: "sha256-a1", bytes: 90 },
			{ path: "b.mjs", integrity: "sha256-b", bytes: 200 },
		],
	};
	const plan = planUpdate(remote, local);
	assert.equal(plan.fromVersion, "0.1.0");
	assert.deepEqual(
		plan.toDownload.map((f) => f.path),
		["a.mjs"],
	);
	assert.equal(plan.totalBytes, 100);
});

test("planUpdate: identical manifests are up to date", () => {
	const m = {
		name: "farm-client",
		version: "0.1.0",
		files: [{ path: "a.mjs", integrity: "sha256-a", bytes: 100 }],
	};
	const plan = planUpdate(m, { ...m });
	assert.equal(plan.upToDate, true);
	assert.equal(plan.toDownload.length, 0);
});

test("buildManifest round-trips through parseManifest", () => {
	const built = buildManifest({
		name: "farm-client",
		version: "0.1.0",
		createdAt: "2026-07-24T00:00:00.000Z",
		files: [{ path: "bin/farm-ask.mjs", integrity: integrityOf("x"), bytes: 1 }],
	});
	const parsed = parseManifest(built);
	assert.equal(parsed.name, "farm-client");
	assert.equal(parsed.createdAt, "2026-07-24T00:00:00.000Z");
	assert.equal(parsed.files[0].integrity, integrityOf("x"));
});
