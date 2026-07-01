import assert from "node:assert/strict";
import test from "node:test";
import { buildReleaseBoundaryAudit } from "./release-boundary-audit.mjs";

test("release boundary audit passes for current vault-seed-ready lane", () => {
	const audit = buildReleaseBoundaryAudit();

	assert.equal(audit.schemaVersion, 1);
	assert.equal(audit.command, "release-boundary-audit");
	assert.equal(audit.ok, true);
	assert.equal(audit.selectionId, "vault-seed-ready");
	assert.equal(audit.auditedPackageCount, 13);
	assert.deepEqual(audit.issues, []);
	assert.deepEqual(new Set(audit.auditedPackages), new Set([
		"@refarm.dev/artifact-contract-v1",
		"@refarm.dev/channel-policy-v1",
		"@refarm.dev/effort-contract-v1",
		"@refarm.dev/process-handoff",
		"@refarm.dev/release-engine",
		"@refarm.dev/ds",
		"@refarm.dev/heartwood",
		"@refarm.dev/dispatch-surface",
		"@refarm.dev/silo",
		"@refarm.dev/source-contract-v1",
		"@refarm.dev/source-web",
		"@refarm.dev/enrichment-contract-v1",
		"@refarm.dev/records-contract-v1",
	]));
});
