import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
	buildNativeSkillSourceEngineSmoke,
	REFARM_SOURCE_STATUS_SKILL,
} from "./native-skill-source-engine-smoke.mjs";

const pexec = promisify(execFile);

async function git(args, cwd) {
	await pexec("git", args, { cwd });
}

async function createRepo() {
	const repo = await mkdtemp(path.join(os.tmpdir(), "native-skill-source-"));
	await git(["init", repo]);
	await git(["-C", repo, "config", "user.email", "native-skill-source@test.dev"]);
	await git(["-C", repo, "config", "user.name", "Native Skill Source Test"]);
	await writeFile(path.join(repo, "README.md"), "# source engine smoke\n");
	await git(["-C", repo, "add", "."]);
	await git(["-C", repo, "commit", "-m", "init"]);
	return repo;
}

test("native skill source engine smoke records source:v1 execution evidence", async () => {
	const repo = await createRepo();
	const result = await buildNativeSkillSourceEngineSmoke({
		sourceRef: `local:${repo}`,
		completedAt: "2026-06-30T00:00:00.000Z",
	});

	assert.equal(result.ok, true);
	assert.equal(result.mode, "source-engine-dogfood-smoke");
	assert.equal(result.executesRuntimeAgent, false);
	assert.equal(result.executesEngine, true);
	assert.equal(result.selectedSkill.name, "refarm-source-status");
	assert.deepEqual(result.plan.engineBindings.requires, ["source:v1"]);
	assert.deepEqual(result.plan.capabilityRequests, [
		{ id: "refarm.operator-loop", required: true },
		{ id: "source:v1", required: true },
	]);
	assert.equal(result.decision.schema, "refarm.skill-invocation-decision.v1");
	assert.equal(result.decision.decision, "approved");
	assert.equal(result.decision.requiresRuntimeDispatch, true);
	assert.equal(result.decision.executed, false);
	assert.equal(result.receipt.schema, "refarm.skill-invocation-receipt.v1");
	assert.equal(result.receipt.status, "succeeded");
	assert.equal(result.receipt.executed, true);
	assert.equal(result.receipt.completedAt, "2026-06-30T00:00:00.000Z");
	assert.equal(result.receipt.engineCalls.length, 1);
	assert.equal(result.receipt.engineCalls[0].engineBinding, "source:v1");
	assert.equal(result.receipt.engineCalls[0].capability, "source:v1");
	assert.equal(result.receipt.engineCalls[0].providerId, "@refarm.dev/source-local");
	assert.equal(result.receipt.engineCalls[0].operation, "status");
	assert.equal(result.receipt.engineCalls[0].ok, true);
	assert.equal(result.sourceStatus.materialized, true);
	assert.equal(result.sourceStatus.clean, true);
	assert.match(result.receipt.output.body, /# Source status/);
	assert.match(result.boundaries.join("\n"), /does not execute runtime-agent/);
	assert.match(result.nextActions.join("\n"), /external DGK or agents-lab skill fixture/);
	assert.deepEqual(result.issues, []);
});

test("native skill source engine smoke fails closed when source capability is missing", async () => {
	const repo = await createRepo();
	const missingCapabilities = REFARM_SOURCE_STATUS_SKILL.replace(
		`requiredCapabilities:
  - refarm.operator-loop
  - source:v1
`,
		"",
	);

	const result = await buildNativeSkillSourceEngineSmoke({
		skillMarkdown: missingCapabilities,
		sourceRef: `local:${repo}`,
	});

	assert.equal(result.ok, false);
	assert.equal(result.executesRuntimeAgent, false);
	assert.equal(result.issueCount > 0, true);
	assert.equal(
		result.issues.some((item) => item.code === "SKILL_PLAN_NOT_READY"),
		true,
	);
	assert.match(JSON.stringify(result.issues), /CAPABILITY_LIST_EMPTY/);
});
