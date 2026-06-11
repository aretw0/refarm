import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function read(path) {
	return readFileSync(path, "utf8");
}

test("README separates future users, developers, and release operators", () => {
	const readme = read("README.md");

	const status = readme.indexOf("## Current Status");
	const users = readme.indexOf("## For Future Users");
	const developers = readme.indexOf("## For Developers");
	const operators = readme.indexOf("## For Release And Deploy Operators");

	assert.ok(status > 0, "README needs a current status section");
	assert.ok(users > status, "future-user surface should follow status");
	assert.ok(developers > users, "developer surface should follow user context");
	assert.ok(operators > developers, "release/deploy operator surface should follow developer context");
	assert.match(readme, /Public end-user use is not released yet/);
	assert.match(readme, /This repository is not yet a polished product download/);
	assert.match(readme, /Release and deploy surfaces are intentionally separate/);
	assert.doesNotMatch(readme, /incr[ií]vel|world-class|estado da arte|liberar o potencial|jornada/i);
});

test("release and deploy workflow contract is discoverable from README", () => {
	const readme = read("README.md");

	for (const command of [
		"pnpm run actions:pins",
		"pnpm run deploy:publish:workflow:test",
		"pnpm run release:check",
		"pnpm run runtime-descriptor:release-smoke",
	]) {
		assert.match(readme, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
});

test("external calibration docs avoid submission-specific wording", () => {
	const calibrationDocs = [
		"docs/EXTERNAL_CONSUMER_CALIBRATION.md",
		"docs/POC_VALIDATION_PRESSURE.md",
		"docs/VAULT_SEED_CONVERGENCE.md",
		"docs/daily-driver-readiness.md",
	];
	const forbidden = [
		/Serpro/i,
		/Pr[eê]mio/i,
		/\bprize\b/i,
		/job-vault/i,
		/\b3[ºª]\b/i,
	];

	for (const file of calibrationDocs) {
		const contents = read(file);
		for (const pattern of forbidden) {
			assert.doesNotMatch(contents, pattern, `${file} contains ${pattern}`);
		}
	}
});
