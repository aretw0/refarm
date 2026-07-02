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
	assert.match(plan, /Authoring space/);
	assert.match(plan, /user and project spaces may carry unpublished skills/);
	assert.match(plan, /Packaging is an explicit promotion/);
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
	assert.match(taxonomy, /package\/plugin\s+manifest surface, not `apps\/refarm`/);
	assert.match(taxonomy, /second plugin system/);
	assert.match(taxonomy, /only then install, vendor, or publish skill wrappers/);

	assert.match(readiness, /native\s+Refarm skill surface/);
	assert.match(readiness, /skill-contract-v1/);
	assert.match(readiness, /policy-checkable manifest/);
	assert.match(readiness, /parallel plugin ecosystem/);
	assert.match(readiness, /plugin-manifest skill surface/);
	assert.match(readiness, /native:skills:surface-smoke/);
	assert.match(readiness, /executesRuntime: false/);
	assert.match(readiness, /Do not require packaging before authoring/);
	assert.match(readiness, /User and project spaces may contain/);
	assert.match(readiness, /peer\/device\s+replication/);
});

test("extensibility model keeps skills inside the package/plugin surface model", () => {
	const extensibility = read("docs/EXTENSIBILITY_MODEL.md");
	const authoringTracks = read("docs/PLUGIN_AUTHORING_TRACKS.md");
	const packagesReadme = read("packages/README.md");
	const skillReadme = read("packages/skill-contract-v1/README.md");

	assert.match(extensibility, /Skills Are Surfaces, Not A Second Plugin System/);
	assert.match(extensibility, /distribution unit stays the package\/plugin bundle/);
	assert.match(extensibility, /"layer": "pi"/);
	assert.match(extensibility, /"kind": "skill"/);
	assert.match(extensibility, /plugin\s+manifest\/Barn\/Scarecrow path still owns install/);
	assert.match(extensibility, /Authoring Spaces Before Packaging/);
	assert.match(extensibility, /Published packages are not the only place/);
	assert.match(extensibility, /User space/);
	assert.match(extensibility, /Project space/);
	assert.match(extensibility, /Release\/replication/);
	assert.match(extensibility, /peer availability is a distribution proof/);

	assert.match(authoringTracks, /Espaços locais antes do plugin/);
	assert.match(authoringTracks, /user space/);
	assert.match(authoringTracks, /project space/);
	assert.match(authoringTracks, /bundle\/package/);
	assert.match(authoringTracks, /não são bypass de segurança/);

	assert.match(packagesReadme, /schema\/conformance helper for native/);
	assert.match(packagesReadme, /not a second plugin system/);
	assert.match(packagesReadme, /Packages and plugin manifests\s+remain the distribution\/trust boundary/);
	assert.match(packagesReadme, /engine dogfood smoke/);

	assert.match(skillReadme, /not a parallel plugin system/);
	assert.match(skillReadme, /distribution unit remains the package\/plugin bundle/);
	assert.match(skillReadme, /layer: "pi", kind: "skill"/);
});
