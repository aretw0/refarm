#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_PATH = path.join(ROOT, "validations", "poc-evidence-index.json");
const FORBIDDEN_PRIVATE_TERMS = [
	"job-vault",
	"premio",
	"serpro",
	"prize",
	"award",
];

function readJson(relativePath) {
	return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function assertNoPrivateTerms(value, context) {
	const text = (typeof value === "string" ? value : JSON.stringify(value))
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
	for (const term of FORBIDDEN_PRIVATE_TERMS) {
		assert.equal(
			text.includes(term),
			false,
			`${context} must stay proposal-neutral and not mention ${term}`,
		);
	}
}

const index = readJson("validations/poc-evidence-index.json");

assert.equal(index.schema, "refarm.validation-poc-evidence-index.v1");
assert.equal(index.pocs.length, 3);
assertNoPrivateTerms(index, "poc evidence index");

for (const poc of index.pocs) {
	assert.ok(poc.evidence.readerStart?.uri, `${poc.id} must expose a reader start`);
	assert.ok(poc.evidence.annex?.uri, `${poc.id} must expose an annex`);
	assert.ok(poc.evidence.scorecard?.uri, `${poc.id} must expose a scorecard`);
	assert.ok(poc.evidence.limits?.uri, `${poc.id} must expose limits`);

	const limitsPath = path.join(ROOT, poc.evidence.limits.uri);
	assert.ok(existsSync(limitsPath), `${poc.id} limits file must exist`);
	const limitsText = readFileSync(limitsPath, "utf8");
	assert.match(limitsText, /Do Not Claim/, `${poc.id} limits must include non-claims`);
	assertNoPrivateTerms(limitsText, `${poc.id} limits`);

	for (const claim of poc.writingClaims) {
		assert.ok(claim.carefulClaim, `${poc.id}/${claim.id} needs a careful claim`);
		assert.ok(claim.doNotSayYet, `${poc.id}/${claim.id} needs a non-claim boundary`);
		assert.ok(
			claim.primaryEvidence.length >= 2,
			`${poc.id}/${claim.id} needs at least two evidence anchors`,
		);
		assertNoPrivateTerms(claim.carefulClaim, `${poc.id}/${claim.id} claim`);
		assertNoPrivateTerms(claim.doNotSayYet, `${poc.id}/${claim.id} boundary`);

		for (const evidence of claim.primaryEvidence) {
			assert.ok(evidence.uri, `${poc.id}/${claim.id} evidence needs a URI`);
			assert.ok(
				existsSync(path.join(ROOT, evidence.uri)),
				`${poc.id}/${claim.id} evidence URI must exist: ${evidence.uri}`,
			);
		}
	}
}

console.log(
	`Validated writing consumer readiness for ${index.pocs.length} validation POC(s) from ${path.relative(ROOT, INDEX_PATH)}.`,
);
