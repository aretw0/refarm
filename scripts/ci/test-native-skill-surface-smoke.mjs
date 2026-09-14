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
	assert.equal(result.plan.schema, "sovereign.skill-invocation-plan.v1");
	assert.equal(result.plan.requiresHostPolicyApproval, true);
	assert.deepEqual(result.plan.engineBindings.requires, ["runtime-agent", "source:v1"]);
	assert.equal(result.request.schema, "sovereign.skill-invocation-request.v1");
	assert.equal(result.request.input.format, "text/markdown");
	assert.equal(result.request.output.format, "text/markdown");
	assert.equal(result.request.requiresHostPolicyApproval, true);
	assert.equal(result.decision.schema, "sovereign.skill-invocation-decision.v1");
	assert.equal(result.decision.decision, "approved");
	assert.equal(result.decision.requiresRuntimeDispatch, true);
	assert.equal(result.decision.executed, false);
	assert.deepEqual(
		result.decision.capabilityDecisions.filter((item) => item.decision === "approved").map((item) => item.id),
		["refarm.operator-loop", "refarm.git.write"],
	);
	assert.match(result.boundaries.join("\n"), /does not execute runtime-agent/);
	assert.match(result.boundaries.join("\n"), /not a standalone skill installation/);
	assert.match(result.nextActions.join("\n"), /engine-call evidence/);
	assert.deepEqual(result.issues, []);
});

test("native skill surface smoke flows a permissive skill with no required capabilities", () => {
	// Permissive is the default: a skill declaring only name/description/body (no
	// requiredCapabilities) is a valid FORM and flows all the way to a policy
	// decision. Requiring capabilities is a POLICY concern handled by a separate
	// evaluator layer (health/quality/design-tells/text-tells) that raises a
	// warning + a resolvable pending-action — not a contract gate that blocks the
	// skill from existing. It still never executes runtime or installs the skill.
	const permissiveSkill = REFARM_GIT_WORKFLOW_SKILL.replace(
		`requiredCapabilities:
  - refarm.operator-loop
  - refarm.git.write
`,
		"",
	);

	const result = buildNativeSkillSurfaceSmoke({ skillMarkdown: permissiveSkill });

	assert.equal(result.ok, true);
	assert.deepEqual(result.issues, []);
	assert.equal(result.executesRuntime, false);
	assert.equal(result.installsSkill, false);
	// The surface builds with zero required capabilities (permissive), and the
	// pre-runtime host decision is still recorded (approved), not executed.
	assert.equal(result.pluginManifest.valid, true);
	assert.deepEqual(result.surface.capabilities, []);
	assert.equal(result.decision.decision, "approved");
	assert.equal(result.decision.executed, false);
});
