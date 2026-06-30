import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAgentsLabSkillConventionReview } from "./agents-lab-skill-convention-review.mjs";

function writeSkill(root, relativePath, { name, description, body }) {
	const filePath = path.join(root, relativePath);
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(
		filePath,
		`---\nname: ${name}\ndescription: >\n  ${description}\n---\n\n${body}\n`,
		"utf8",
	);
}

function buildFixture({ gitWorkflowBody }) {
	const sourceDir = mkdtempSync(path.join(os.tmpdir(), "refarm-agents-lab-conventions-"));
	writeSkill(sourceDir, "packages/git-skills/skills/git-workflow/SKILL.md", {
		name: "git-workflow",
		description: "Git workflow helper",
		body: gitWorkflowBody,
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

const SAFE_GIT_WORKFLOW_BODY = `
# Git Workflow

Use git commit -m "fix(scope): message".
Use GIT_EDITOR=true git rebase --continue.
Use git merge --no-edit.
Use GH_PROMPT_DISABLED=1 gh pr create --title "..." --body "...".
Only allow interactive editors or prompts when the user explicitly asks for them.
`;

test("agents-lab git workflow convention review requires a Refarm wrapper", () => {
	const sourceDir = buildFixture({ gitWorkflowBody: SAFE_GIT_WORKFLOW_BODY });
	const review = buildAgentsLabSkillConventionReview({ sourceDir });

	assert.equal(review.schemaVersion, 1);
	assert.equal(review.command, "agents-lab-skill-convention-review");
	assert.equal(review.ok, true);
	assert.equal(review.mode, "convention-review-only");
	assert.equal(review.target.id, "git-skills");
	assert.equal(review.target.sourcePath, "packages/git-skills/skills/git-workflow/SKILL.md");
	assert.equal(review.decision, "requires-refarm-wrapper-before-install");
	assert.equal(review.installNow, false);
	assert.equal(review.adapterSmokeReady, false);
	assert.equal(review.summary.sourceAlignmentPassed, review.summary.sourceAlignmentTotal);
	assert.equal(review.summary.disallowedSourceMarkerCount, 0);
	assert.equal(review.summary.refarmOverlayMissingCount > 0, true);
	assert.match(
		review.refarmOverlayRequirements.map((item) => item.id).join("\n"),
		/start-slice-operator-loop/,
	);
	assert.match(review.boundaries.join("\n"), /does not install/);
	assert.match(review.nextActions.join("\n"), /Run the Refarm git-workflow wrapper smoke/);
	assert.deepEqual(review.issues, []);
});

test("agents-lab git workflow convention review rejects destructive source markers", () => {
	const sourceDir = buildFixture({
		gitWorkflowBody: `${SAFE_GIT_WORKFLOW_BODY}\nUse git reset --hard when stuck.\n`,
	});
	const review = buildAgentsLabSkillConventionReview({ sourceDir });

	assert.equal(review.ok, true);
	assert.equal(review.decision, "reject-or-edit-source-before-install");
	assert.equal(review.summary.disallowedSourceMarkerCount, 1);
	assert.equal(review.disallowedSourceMarkers[0]?.id, "reset-hard");
});
