import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentsLabAssimilationAudit } from "./agents-lab-assimilation-audit.mjs";

test("agents-lab assimilation audit keeps imports, primitive cultivation, and holds explicit", () => {
	const audit = buildAgentsLabAssimilationAudit();

	assert.equal(audit.schemaVersion, 1);
	assert.equal(audit.command, "agents-lab-assimilation-audit");
	assert.equal(audit.ok, true);
	assert.equal(audit.issueCount, 0);
	assert.deepEqual(audit.issues, []);
	assert.deepEqual(audit.summary, {
		importNow: 5,
		cultivate: 4,
		hold: 2,
	});
	assert.deepEqual(
		audit.entries
			.filter((entry) => entry.action === "import-now")
			.map((entry) => entry.id),
		[
			"git-skills",
			"lab-skills.cultivate-primitive",
			"lab-skills.evaluate-extension",
			"lab-skills.provider-model-discovery",
		],
	);
	assert.deepEqual(
		audit.entries
			.filter((entry) => entry.action === "cultivate-refarm-primitive")
			.map((entry) => entry.id),
		[
			"context-watchdog",
			"guardrails-core",
			"quota-visibility",
			"colony-pilot",
		],
	);
	assert.deepEqual(
		audit.entries
			.filter((entry) => entry.action === "hold")
			.map((entry) => entry.id),
		["pi-extension-api", "runtime-engine-publication"],
	);
	assert.match(
		audit.boundaries.join("\n"),
		/Pi TypeScript extension APIs and hooks do not become Refarm enforcement/,
	);
	assert.match(
		audit.boundaries.join("\n"),
		/Runtime fanout and @refarm\.dev\/pi-agent publication stay blocked/,
	);
	assert.match(
		audit.nextSlices.join("\n"),
		/skills import manifest/,
	);
});
