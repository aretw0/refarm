import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildReleaseBoundaryAudit } from "./release-boundary-audit.mjs";

test("release boundary audit passes for current vault-seed-ready lane", () => {
	const audit = buildReleaseBoundaryAudit();
	const config = JSON.parse(readFileSync(new URL("../../refarm.config.json", import.meta.url), "utf8"));
	const profiles = config.releasePolicy.packageProfiles.filter((profile) =>
		profile.tags?.includes("vault-seed-ready"),
	);

	assert.equal(audit.schemaVersion, 1);
	assert.equal(audit.command, "release-boundary-audit");
	assert.equal(audit.ok, true);
	assert.equal(audit.selectionId, "vault-seed-ready");
	// DERIVED from the config, never retyped. This block used to hardcode `21` and a list of
	// twenty-one package names, and the repository grew to 23 vault-seed-ready profiles — so the
	// suite has been red ever since, invisibly, because no lane ran it (ISS-106).
	//
	// The material was already here: `profiles` above filters the very same config the audit
	// reads. What the test is FOR is that the audit and the config agree about which packages are
	// in the lane; which packages those are is the config's business, and a copy of it in a test
	// is a second declaration that drifts.
	assert.equal(audit.auditedPackageCount, profiles.length);
	assert.deepEqual(
		new Set(audit.auditedPackages),
		new Set(profiles.map((profile) => profile.id)),
	);
	assert.deepEqual(
		profiles
			.filter((profile) =>
				["proofId", "downstreamUse", "proofTarget", "ownershipBoundary"].some(
					(field) => typeof profile.consumerPull?.[field] !== "string" || profile.consumerPull[field].trim() === "",
				),
			)
			.map((profile) => profile.id),
		[],
	);
});
