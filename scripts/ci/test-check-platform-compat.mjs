#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/ci/check-platform-compat.mjs", "utf8");

test("platform compatibility includes environment safety precheck", () => {
	assert.match(source, /env-safety-check\.sh"?, "--strict"/);
});

test("platform compatibility uses the aggregate environment substrate check", () => {
	assert.match(source, /check-environment-substrate\.mjs", "--json"/);
	assert.doesNotMatch(source, /check-node-substrate\.mjs", "--json"/);
	assert.doesNotMatch(source, /check-rust-substrate\.mjs", "--json"/);
});

test("platform compatibility keeps focused build and handoff checks", () => {
	assert.match(
		source,
		/node",\s*\[\s*"scripts\/ci\/run-workspace-script\.mjs",\s*"--with-dependency-builds",\s*"packages\/cli",\s*"build"/,
	);
	assert.match(
		source,
		/node",\s*\[\s*"scripts\/ci\/run-workspace-script\.mjs",\s*"--with-dependency-builds",\s*"apps\/refarm",\s*"build"/,
	);
	assert.match(source, /"operator-resume\.test\.ts"/);
	assert.match(source, /"command-handoff\.test\.ts"/);
});
