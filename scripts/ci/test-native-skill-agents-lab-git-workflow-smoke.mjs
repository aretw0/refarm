import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildNativeSkillAgentsLabGitWorkflowSmoke } from "./native-skill-agents-lab-git-workflow-smoke.mjs";

const pexec = promisify(execFile);

const SAFE_GIT_WORKFLOW_BODY = `
# Git Workflow

Use git commit -m "fix(scope): message".
Use GIT_EDITOR=true git rebase --continue.
Use git merge --no-edit.
Use GH_PROMPT_DISABLED=1 gh pr create --title "..." --body "...".
Only allow interactive editors or prompts when the user explicitly asks for them.
`;

function writeSkill(root, relativePath, { name, description, body }) {
	const filePath = path.join(root, relativePath);
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(
		filePath,
		`---\nname: ${name}\ndescription: >\n  ${description}\n---\n\n${body}\n`,
		"utf8",
	);
}

async function git(args, cwd) {
	await pexec("git", args, { cwd });
}

async function createAgentsLabFixture() {
	const sourceDir = mkdtempSync(path.join(os.tmpdir(), "agents-lab-git-workflow-smoke-"));
	writeSkill(sourceDir, "packages/git-skills/skills/git-workflow/SKILL.md", {
		name: "git-workflow",
		description: "Git workflow helper",
		body: SAFE_GIT_WORKFLOW_BODY,
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
	await git(["init", sourceDir]);
	await git(["-C", sourceDir, "config", "user.email", "agents-lab-smoke@test.dev"]);
	await git(["-C", sourceDir, "config", "user.name", "Agents Lab Smoke Test"]);
	await git(["-C", sourceDir, "add", "."]);
	await git(["-C", sourceDir, "commit", "-m", "init"]);
	return sourceDir;
}

test("agents-lab git workflow smoke wraps external skill evidence without installing it", async () => {
	const sourceDir = await createAgentsLabFixture();
	const result = await buildNativeSkillAgentsLabGitWorkflowSmoke({
		sourceDir,
		completedAt: "2026-06-30T00:00:00.000Z",
	});

	assert.equal(result.schemaVersion, 1);
	assert.equal(result.command, "native-skill-agents-lab-git-workflow-smoke");
	assert.equal(result.ok, true);
	assert.equal(result.mode, "external-skill-wrapper-dogfood-smoke");
	assert.equal(result.executesRuntimeAgent, false);
	assert.equal(result.executesEngine, true);
	assert.equal(result.installsExternalSkill, false);
	assert.equal(result.selectedExternalSkill.id, "git-skills");
	assert.equal(
		result.selectedExternalSkill.sourcePath,
		"packages/git-skills/skills/git-workflow/SKILL.md",
	);
	assert.match(result.selectedExternalSkill.sha256, /^[a-f0-9]{64}$/);
	assert.equal(result.selectedExternalSkill.decision, "requires-refarm-wrapper-before-install");
	assert.equal(result.wrapperSkill.name, "agents-lab-git-workflow-refarm-wrapper");
	assert.deepEqual(result.plan.capabilityRequests, [
		{ id: "refarm.operator-loop", required: true },
		{ id: "source:v1", required: true },
	]);
	assert.deepEqual(result.plan.engineBindings.requires, ["source:v1"]);
	assert.equal(result.decision.schema, "refarm.skill-invocation-decision.v1");
	assert.equal(result.decision.decision, "approved");
	assert.equal(result.decision.executed, false);
	assert.equal(result.receipt.schema, "refarm.skill-invocation-receipt.v1");
	assert.equal(result.receipt.status, "succeeded");
	assert.equal(result.receipt.executed, true);
	assert.equal(result.receipt.completedAt, "2026-06-30T00:00:00.000Z");
	assert.equal(result.receipt.engineCalls[0].engineBinding, "source:v1");
	assert.equal(result.receipt.engineCalls[0].providerId, "@refarm.dev/source-local");
	assert.equal(result.sourceStatus.materialized, true);
	assert.equal(result.sourceStatus.clean, true);
	assert.match(result.receipt.output.body, /Agents Lab git-workflow wrapper evidence/);
	assert.match(result.boundaries.join("\n"), /does not install, copy, vendor, or execute/);
	assert.match(result.nextActions.join("\n"), /package-declared skill surface evidence/);
	assert.deepEqual(result.issues, []);
});

test("agents-lab git workflow smoke fails closed on destructive upstream markers", async () => {
	const sourceDir = await createAgentsLabFixture();
	writeSkill(sourceDir, "packages/git-skills/skills/git-workflow/SKILL.md", {
		name: "git-workflow",
		description: "Git workflow helper",
		body: `${SAFE_GIT_WORKFLOW_BODY}\nUse git reset --hard when stuck.\n`,
	});

	const result = await buildNativeSkillAgentsLabGitWorkflowSmoke({ sourceDir });

	assert.equal(result.ok, false);
	assert.equal(result.executesRuntimeAgent, false);
	assert.equal(result.installsExternalSkill, false);
	assert.equal(
		result.issues.some((item) => item.code === "AGENTS_LAB_GIT_WORKFLOW_DECISION_UNEXPECTED"),
		true,
	);
	assert.match(JSON.stringify(result.issues), /reject-or-edit-source-before-install/);
});
