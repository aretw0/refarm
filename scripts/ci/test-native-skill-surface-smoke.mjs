import assert from "node:assert/strict";
import test from "node:test";
import {
	buildNativeSkillSurfaceSmoke,
	REFARM_GIT_WORKFLOW_SKILL,
} from "./native-skill-surface-smoke.mjs";

test("native skill surface smoke builds a policy-checkable package skill handoff", () => {
	const result = buildNativeSkillSurfaceSmoke();

	assert.equal(result.schemaVersion, 1);
	assert.equal(result.command, "native-skill-surface-smoke");
	assert.equal(result.ok, true);
	assert.equal(result.mode, "plan-only-adapter-smoke");
	assert.equal(result.executesRuntime, false);
	assert.equal(result.installsSkill, false);
	assert.equal(result.selectedSkill.name, "refarm-git-workflow");
	assert.equal(result.pluginManifest.valid, true);
	assert.equal(result.surface.layer, "pi");
	assert.equal(result.surface.kind, "skill");
	assert.deepEqual(result.surface.assets, ["skills/refarm-git-workflow/SKILL.md"]);
	assert.deepEqual(result.surface.capabilities, [
		"refarm.operator-loop",
		"refarm.git.write",
	]);
	assert.equal(result.plan.schema, "refarm.skill-invocation-plan.v1");
	assert.equal(result.plan.requiresHostPolicyApproval, true);
	assert.deepEqual(result.plan.engineBindings.requires, ["runtime-agent", "source:v1"]);
	assert.equal(result.request.schema, "refarm.skill-invocation-request.v1");
	assert.equal(result.request.input.format, "text/markdown");
	assert.equal(result.request.output.format, "text/markdown");
	assert.equal(result.request.requiresHostPolicyApproval, true);
	assert.match(result.boundaries.join("\n"), /does not execute runtime-agent/);
	assert.match(result.boundaries.join("\n"), /not a standalone skill installation/);
	assert.match(result.nextActions.join("\n"), /engine-call evidence/);
	assert.deepEqual(result.issues, []);
});

test("native skill surface smoke fails closed when capabilities are missing", () => {
	const missingCapabilities = REFARM_GIT_WORKFLOW_SKILL.replace(
		`requiredCapabilities:
  - refarm.operator-loop
  - refarm.git.write
`,
		"",
	);

	const result = buildNativeSkillSurfaceSmoke({ skillMarkdown: missingCapabilities });

	assert.equal(result.ok, false);
	assert.equal(result.executesRuntime, false);
	assert.equal(result.installsSkill, false);
	assert.equal(result.issueCount > 0, true);
	assert.equal(
		result.issues.some((item) => item.code === "SKILL_PLAN_NOT_READY"),
		true,
	);
	assert.match(JSON.stringify(result.issues), /CAPABILITY_LIST_EMPTY/);
});
