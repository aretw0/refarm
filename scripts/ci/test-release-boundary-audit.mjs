import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildReleaseBoundaryAudit } from "./release-boundary-audit.mjs";

test("release boundary audit passes for current vault-seed-ready lane", () => {
	const audit = buildReleaseBoundaryAudit();
	const config = JSON.parse(readFileSync(new URL("../../refarm.config.json", import.meta.url), "utf8"));
	const profiles = config.releasePolicy.packageProfiles.filter((profile) =>
		profile.tags?.includes("consumer-ready"),
	);

	assert.equal(audit.schemaVersion, 1);
	assert.equal(audit.command, "release-boundary-audit");
	assert.equal(audit.ok, true);
	assert.equal(audit.selectionId, "consumer-ready");
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

// COVERAGE, not verdict. The audit above can only report `ok: true` about packages it actually
// looked at, and until 2026-08-16 `auditRequirementsSupplyHolds` walked a hardcoded list of three
// package names while `requirements-supply` had four members. `@refarm.dev/content-projection` —
// the one member actually on hold — was audited by nothing, and the hold rule the audit exists to
// enforce ("must declare candidate-hold until selected downstream proof") never ran against it.
//
// The same defect this file already fixed once, one function over: a copy of the config living in
// the script that reads the config. Membership is now DERIVED from the profile tag, so a fifth
// member cannot silently escape. Which members are PROVEN stays declared, because an audit that
// derived that from the tags it audits would be checking its own answer.
test("the requirements-supply hold audit covers every member of the profile", () => {
	const audit = buildReleaseBoundaryAudit();
	const config = JSON.parse(readFileSync(new URL("../../refarm.config.json", import.meta.url), "utf8"));
	const members = config.releasePolicy.packageProfiles
		.filter((profile) => profile.tags?.includes("requirements-supply"))
		.map((profile) => profile.id);

	assert.ok(members.length > 0, "the profile has members to audit");
	assert.deepEqual(new Set(audit.requirementsSupplyAudited), new Set(members));
});
