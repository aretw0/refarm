import assert from "node:assert/strict";
import test from "node:test";
import {
	buildCliBenchSummary,
	parseCliBenchArgs,
	parseCliBenchPayload,
	selectCliBenchmarks,
} from "../perf/cli-bench.mjs";

test("cli bench parses stable options", () => {
	assert.deepEqual(
		parseCliBenchArgs([
			"--",
			"--json",
			"--profile",
			"lane",
			"--iterations=2",
			"--timeout-ms",
			"3000",
			"--out",
			"artifacts/perf/cli-bench.json",
			"--strict",
		]),
		{
			json: true,
			list: false,
			profile: "lane",
			iterations: 2,
			timeoutMs: 3000,
			out: "artifacts/perf/cli-bench.json",
			strict: true,
		},
	);
});

test("cli bench rejects unknown profiles and invalid counts", () => {
	assert.throws(() => parseCliBenchArgs(["--profile", "huge"]), /quick, lane, all/);
	assert.throws(() => parseCliBenchArgs(["--iterations", "0"]), /positive integer/);
	assert.throws(() => parseCliBenchArgs(["--timeout-ms=soon"]), /positive integer/);
});

test("cli bench selects quick, lane, and all profiles", () => {
	const fixtures = [
		{ id: "a", profile: "quick" },
		{ id: "b", profile: "lane" },
		{ id: "c", profile: "quick" },
	];

	assert.deepEqual(selectCliBenchmarks("quick", fixtures).map((item) => item.id), ["a", "c"]);
	assert.deepEqual(selectCliBenchmarks("lane", fixtures).map((item) => item.id), ["b"]);
	assert.deepEqual(selectCliBenchmarks("all", fixtures).map((item) => item.id), ["a", "b", "c"]);
});

test("cli bench summary keeps fastest and slowest samples", () => {
	assert.deepEqual(
		buildCliBenchSummary([
			{ id: "check", ok: true, elapsedMs: 900 },
			{ id: "finish", ok: false, elapsedMs: 3000 },
			{ id: "tidy", ok: true, elapsedMs: 200 },
		]),
		{
			total: 3,
			passed: 2,
			failed: 1,
			slowest: { id: "finish", elapsedMs: 3000 },
			fastest: { id: "tidy", elapsedMs: 200 },
		},
	);
});

test("cli bench parses pretty printed JSON payloads", () => {
	assert.deepEqual(parseCliBenchPayload('noise\n{\n  "ok": true,\n  "nextCommand": null\n}\n'), {
		ok: true,
		nextCommand: null,
	});
});
