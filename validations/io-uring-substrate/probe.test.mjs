import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseArgs, runProbe } from "./run-probe.mjs";

const VALID_STATUSES = new Set(["available", "blocked", "unsupported"]);

test("parses io-uring probe CLI arguments", () => {
	assert.deepEqual(
		parseArgs(["--json", "--out", "evidence/probe-current.json", "--keep-temp"]),
		{
			json: true,
			out: "evidence/probe-current.json",
			keepTemp: true,
		},
	);
});

test("classifies native io-uring support without requiring availability", () => {
	const payload = runProbe();

	assert.equal(payload.ok, true);
	assert.equal(payload.schema, "refarm.io_uring_probe.v1");
	assert.equal(VALID_STATUSES.has(payload.status), true);
	assert.equal(payload.syscall, "io_uring_setup");
	assert.equal(typeof payload.reason, "string");
	assert.ok(payload.reason.length > 0);
	assert.equal(typeof payload.kernelRelease, "string");
	assert.ok(payload.kernelRelease.length > 0);
	assert.equal(payload.fallback, "standard-file-io");
	assert.equal(payload.publicApi, "async-io:native-linux");
});

test("documents generated-source materialization as the first workload", () => {
	const readme = readFileSync(path.join(import.meta.dirname, "README.md"), "utf8");

	assert.match(readme, /generated\/source materialization/);
	assert.match(readme, /deterministic fixture tree copy/);
	assert.match(readme, /byte-for-byte output hash/);
	assert.match(readme, /no network/);
});
