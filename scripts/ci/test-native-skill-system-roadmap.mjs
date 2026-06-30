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
	assert.match(plan, /schema helper, not an installer/);
	assert.match(plan, /extensions\.surfaces\[\]/);
	assert.match(plan, /layer: "pi"/);
	assert.match(plan, /kind: "skill"/);
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

	assert.match(taxonomy, /Native Refarm Skill Surface/);
	assert.match(taxonomy, /native skill\s+surface/);
	assert.match(taxonomy, /package\/plugin manifest surface, not `apps\/refarm`/);
	assert.match(taxonomy, /second plugin system/);
	assert.match(taxonomy, /only then install, vendor, or publish skill wrappers/);

	assert.match(readiness, /native\s+Refarm skill surface/);
	assert.match(readiness, /skill-contract-v1/);
	assert.match(readiness, /policy-checkable manifest/);
	assert.match(readiness, /parallel plugin ecosystem/);
	assert.match(readiness, /plugin-manifest skill surface/);
});

test("extensibility model keeps skills inside the package/plugin surface model", () => {
	const extensibility = read("docs/EXTENSIBILITY_MODEL.md");
	const packagesReadme = read("packages/README.md");
	const skillReadme = read("packages/skill-contract-v1/README.md");

	assert.match(extensibility, /Skills Are Surfaces, Not A Second Plugin System/);
	assert.match(extensibility, /distribution unit stays the package\/plugin bundle/);
	assert.match(extensibility, /"layer": "pi"/);
	assert.match(extensibility, /"kind": "skill"/);
	assert.match(extensibility, /plugin\s+manifest\/Barn\/Scarecrow path still owns install/);

	assert.match(packagesReadme, /schema\/conformance helper for native/);
	assert.match(packagesReadme, /not a second plugin system/);
	assert.match(packagesReadme, /Packages and plugin manifests\s+remain the distribution\/trust boundary/);

	assert.match(skillReadme, /not a parallel plugin system/);
	assert.match(skillReadme, /distribution unit remains the package\/plugin bundle/);
	assert.match(skillReadme, /layer: "pi", kind: "skill"/);
});
