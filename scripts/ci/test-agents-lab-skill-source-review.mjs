import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAgentsLabSkillSourceReview } from "./agents-lab-skill-source-review.mjs";

function writeSkill(root, relativePath, { name, description, body }) {
	const filePath = path.join(root, relativePath);
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(
		filePath,
		`---\nname: ${name}\ndescription: >\n  ${description}\n---\n\n${body}\n`,
		"utf8",
	);
}

function buildFixture() {
	const sourceDir = mkdtempSync(path.join(os.tmpdir(), "refarm-agents-lab-skills-"));
	writeSkill(sourceDir, "packages/git-skills/skills/git-workflow/SKILL.md", {
		name: "git-workflow",
		description: "Git workflow helper",
		body: "# Git Workflow\n\nBranch, commit, PR, and handoff conventions.",
	});
	writeSkill(sourceDir, "packages/lab-skills/skills/cultivate-primitive/SKILL.md", {
		name: "cultivate-primitive",
		description: "Cultiva primitivas",
		body: "Use packages, .pi/settings.json, /reload, and @aretw0/pi-stack only after review.",
	});
	writeSkill(sourceDir, "packages/lab-skills/skills/evaluate-extension/SKILL.md", {
		name: "evaluate-extension",
		description: "Avalia extensão Pi",
		body: "Score extension APIs and write docs/research/pi-extension-scorecard.md.",
	});
	writeSkill(sourceDir, "packages/lab-skills/skills/provider-model-discovery/SKILL.md", {
		name: "provider-model-discovery",
		description: "Descobre modelos",
		body: "Report-only discovery for providerBudgets, routeModelRefs, and packages/pi-stack.",
	});
	return sourceDir;
}

test("agents-lab skill source review records source evidence without installing", () => {
	const sourceDir = buildFixture();
	const review = buildAgentsLabSkillSourceReview({ sourceDir });

	assert.equal(review.schemaVersion, 1);
	assert.equal(review.command, "agents-lab-skill-source-review");
	assert.equal(review.ok, true);
	assert.equal(review.mode, "source-review-only");
	assert.equal(review.source.path, sourceDir);
	assert.equal(review.source.exists, true);
	assert.equal(review.summary.plannedSkillCount, 4);
	assert.equal(review.summary.reviewedSkillCount, 4);
	assert.equal(review.summary.installNowCount, 0);
	assert.equal(review.summary.acceptedAfterConventionReviewCount, 1);
	assert.equal(review.summary.requiresEditCount, 3);
	assert.deepEqual(review.entries.map((entry) => entry.id), [
		"git-skills",
		"lab-skills.cultivate-primitive",
		"lab-skills.evaluate-extension",
		"lab-skills.provider-model-discovery",
	]);
	assert.equal(
		review.entries.every((entry) => entry.found && entry.sha256.length === 64),
		true,
	);
	assert.equal(
		review.entries.every((entry) => entry.runtimeRequired === false && entry.installNow === false),
		true,
	);
	assert.equal(
		review.entries.find((entry) => entry.id === "git-skills")?.decision,
		"accepted-after-refarm-convention-review",
	);
	assert.equal(
		review.entries.filter((entry) => entry.decision === "requires-refarm-edit-before-install").length,
		3,
	);
	assert.match(review.boundaries.join("\n"), /No agents-lab file is installed/);
	assert.match(review.boundaries.join("\n"), /runtime execution remains deferred/);
	assert.match(review.nextActions.join("\n"), /Review git-workflow/);
	assert.deepEqual(review.issues, []);
});

test("agents-lab skill source review blocks on missing checkout", () => {
	const review = buildAgentsLabSkillSourceReview({
		sourceDir: path.join(os.tmpdir(), "refarm-missing-agents-lab-skills"),
	});

	assert.equal(review.ok, false);
	assert.equal(review.issueCount > 0, true);
	assert.match(
		review.issues.map((item) => item.code).join("\n"),
		/AGENTS_LAB_SOURCE_DIR_MISSING/,
	);
});
