import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
	return readFileSync(path, "utf8");
}

test("native skill system plan owns execution before external adapters", () => {
	const plan = read("docs/superpowers/plans/2026-06-25-skill-runtime-activation.md");

	assert.match(plan, /Native Skill System Activation/);
	assert.match(plan, /skill-contract-v1/);
	assert.match(plan, /SkillManifestV1/);
	assert.match(plan, /runtime-agent/);
	assert.match(plan, /plugin-manifest\/Barn\/Scarecrow/);
	assert.match(plan, /not `apps\/refarm`/);
	assert.match(plan, /do not install skills/);
});

test("interop and portability specs keep Markdown content-portable but runtime-gated", () => {
	const interop = read("docs/superpowers/specs/2026-05-14-pi-refarm-interop.md");
	const portability = read("docs/superpowers/specs/2026-05-14-agents-lab-portability.md");

	assert.match(interop, /content-portable, runtime-gated/);
	assert.match(interop, /native Refarm skill contract\/adapter before execution/);
	assert.doesNotMatch(interop, /Skills \(Markdown\) \| ✅ Fully interoperable/);

	assert.match(portability, /content-portable, runtime-gated/);
	assert.match(portability, /Do not install/);
	assert.match(portability, /Markdown skills pass as content, not as automatic runtime artifacts/);
	assert.doesNotMatch(portability, /Install as-is/);
});

test("roadmap and taxonomy treat external skills as fixtures for native Refarm skills", () => {
	const roadmap = read("docs/CONVERGENCE_ROADMAP.md");
	const taxonomy = read("docs/GARDENING_SKILLS_TAXONOMY.md");
	const readiness = read("docs/CONVERGENCE_FACTORY_READINESS.md");

	assert.match(roadmap, /Native Refarm skills/);
	assert.match(roadmap, /contract\s+package, manifest parser, capability envelope/);
	assert.match(roadmap, /compatibility\s+fixtures and consumer pressure/);

	assert.match(taxonomy, /Native Refarm Skill System/);
	assert.match(taxonomy, /package or plugin surface, not `apps\/refarm`/);
	assert.match(taxonomy, /only then install, vendor, or publish skill wrappers/);

	assert.match(readiness, /native\s+Refarm skill system/);
	assert.match(readiness, /skill-contract-v1/);
	assert.match(readiness, /policy-checkable manifest/);
});
