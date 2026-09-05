import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildReleaseCheckPlan } from "../release-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relativePath) {
	return readFileSync(path.join(ROOT, relativePath), "utf8");
}

const adr = read("specs/ADRs/ADR-081-local-surface-boundary.md");
const adrIndex = read("specs/ADRs/README.md");
const spec = read("specs/features/2026-07-03-local-surface-v1.md");
const packageReadme = read("packages/local-surface/README.md");
const packageRegistry = read("packages/README.md");
const capabilities = read("packages/README-CAPABILITIES.md");
const distribution = read("packages/DISTRIBUTION_STATUS.md");
const convergence = read("docs/superpowers/plans/2026-07-03-poc-release-convergence-matrix.md");

function vaultSeedReadyPackages() {
	const check = buildReleaseCheckPlan({
		cwd: ROOT,
		env: {
			REFARM_PACKAGE_MANAGER: "pnpm",
		},
		selectionId: "consumer-ready",
	});
	assert.equal(check.ok, true);
	return check.plan.orderedNames;
}

test("local-surface ADR and spec record the package boundary", () => {
	for (const document of [adr, spec, packageReadme, capabilities, distribution]) {
		assert.match(document, /local-surface:v1/);
		assert.match(document, /@refarm\.dev\/local-surface/);
	}

	assert.match(adr, /does not:\n\n- start an HTTP server/);
	assert.match(adr, /replace Homestead/);
	assert.match(adr, /extend `dispatch-surface` transport\/control semantics/);
	assert.match(spec, /selected in `vault-seed-ready` after downstream proof/);
	assert.match(packageReadme, /does not start a server/);
	assert.match(capabilities, /não sobe servidor/);
	assert.match(distribution, /consumer-proven candidate/);
	assert.match(distribution, /selected in `consumer-ready`\s+after the downstream proof/);
});

test("ADR index lists ADR-081 as proposed", () => {
	assert.match(
		adrIndex,
		/\[081\]\(ADR-081-local-surface-boundary\.md\).*Local Surface Boundary.*Proposed.*2026-07-03/,
	);
});

test("convergence matrix uses local-surface language instead of local-web-shell", () => {
	assert.match(convergence, /local surface manifest/);
	assert.match(convergence, /local-first local surface launched by CLI/);
	assert.doesNotMatch(convergence, /local web shell/);
});

test("local-surface is selected in vault-seed-ready after downstream proof", () => {
	assert.equal(vaultSeedReadyPackages().includes("@refarm.dev/local-surface"), true);
	assert.match(packageRegistry, /@refarm\.dev\/local-surface/);
	assert.match(packageRegistry, /consumer-proven; `consumer-ready`; held/);
});
