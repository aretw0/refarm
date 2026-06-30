import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentsLabSkillImportManifest } from "./agents-lab-skill-import-manifest.mjs";

test("agents-lab skill import manifest plans only reviewed markdown skills", () => {
	const manifest = buildAgentsLabSkillImportManifest();

	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.command, "agents-lab-skill-import-manifest");
	assert.equal(manifest.ok, true);
	assert.equal(manifest.mode, "plan-only");
	assert.equal(manifest.activationGate.currentState, "ready-for-source-review");
	assert.match(manifest.activationGate.canStartNow.join("\n"), /Review git-skills/);
	assert.match(
		manifest.activationGate.unlocksRuntimeAdapterWhen.join("\n"),
		/dogfood smoke runs the selected skill through Refarm/,
	);
	assert.match(
		manifest.activationGate.stillBlockedBy.join("\n"),
		/No reviewed source skill content/,
	);
	assert.equal(manifest.install.performsInstall, false);
	assert.equal(manifest.install.requiresHumanReview, true);
	assert.deepEqual(manifest.install.disallowedSourceKinds, [
		"agents-lab-extension-runtime",
		"pi-extension-api",
	]);
	assert.deepEqual(manifest.summary, {
		plannedSkillCount: 4,
		repositories: ["aretw0/agents-lab"],
		packages: ["git-skills", "lab-skills"],
	});
	assert.deepEqual(manifest.entries.map((entry) => entry.id), [
		"git-skills",
		"lab-skills.cultivate-primitive",
		"lab-skills.evaluate-extension",
		"lab-skills.provider-model-discovery",
	]);
	assert.equal(
		manifest.entries.every((entry) => entry.target.format === "SKILL.md"),
		true,
	);
	assert.equal(
		manifest.entries.every((entry) => entry.target.runtimeRequired === false),
		true,
	);
	assert.equal(
		manifest.entries.every((entry) => entry.review.required === true),
		true,
	);
	assert.match(manifest.boundaries.join("\n"), /No files are installed/);
	assert.match(manifest.boundaries.join("\n"), /Refarm skill runtime remains deferred/);
	assert.match(manifest.nextActions.join("\n"), /Inspect the source skill content/);
	assert.deepEqual(manifest.issues, []);
});
