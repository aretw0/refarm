import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	buildValidationPocEvidenceIndex,
	INDEX_SCHEMA,
} from "./build-validation-poc-evidence-index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_PATH = path.join(ROOT, "validations", "poc-evidence-index.json");
const WRITING_HANDOFF_PATH = path.join(ROOT, "docs", "POC_WRITING_HANDOFF.md");

function readExpectedIndex() {
	return JSON.parse(readFileSync(INDEX_PATH, "utf8"));
}

describe("validation poc evidence index", () => {
	it("matches the checked-in generated index", () => {
		assert.deepEqual(readExpectedIndex(), buildValidationPocEvidenceIndex(ROOT));
	});

	it("exposes reader starts, limits, and claim-promotion evidence for every POC", () => {
		const index = readExpectedIndex();

		assert.equal(index.schema, INDEX_SCHEMA);
		assert.deepEqual(
			index.pocs.map((poc) => poc.id),
			["extension-sandbox", "citizen-data-wallet", "governed-note-box"],
		);
		for (const poc of index.pocs) {
			assert.equal(poc.evidence.readerStart?.id, poc.evidence.scenario?.id);
			assert.equal(poc.evidence.limits?.role, "report");
			assert.ok(poc.evidence.limits.labels.includes("claim-boundary"));
			assert.ok(poc.evidence.claimPromotion.length >= 1);
			assert.equal(poc.writingClaims.length, 3);
			for (const claim of poc.writingClaims) {
				assert.equal(typeof claim.carefulClaim, "string");
				assert.equal(typeof claim.doNotSayYet, "string");
				assert.ok(claim.primaryEvidence.length >= 2);
				assert.ok(claim.primaryEvidence.every((artifact) => artifact.uri));
			}
			assert.ok(poc.consumerHints.labels.includes("limits"));
		}
	});

	it("keeps writing and integration boundaries explicit", () => {
		const index = readExpectedIndex();

		assert.ok(index.boundary.canUseFor.includes("proposal evidence navigation"));
		assert.ok(index.boundary.mustNotUseFor.includes("real vault or service integration claims"));
		assert.ok(
			index.pocs
				.find((poc) => poc.id === "governed-note-box")
				?.evidence.claimPromotion.some((artifact) => artifact.id === "consumer-evidence"),
		);
		assert.ok(
			index.pocs
				.find((poc) => poc.id === "governed-note-box")
				?.writingClaims.some((claim) =>
					claim.primaryEvidence.some((artifact) => artifact.id === "poc-evidence-index"),
				),
		);
	});

	it("keeps the writing handoff aligned with generated writing claims", () => {
		const index = readExpectedIndex();
		const handoff = readFileSync(WRITING_HANDOFF_PATH, "utf8");

		assert.match(handoff, /## Theme Claim Map/);
		assert.match(handoff, /validations\/poc-evidence-index\.json/);
		for (const poc of index.pocs) {
			for (const claim of poc.writingClaims) {
				assert.match(handoff, new RegExp(escapeRegExp(claim.carefulClaim)));
				assert.match(handoff, new RegExp(escapeRegExp(claim.doNotSayYet)));
			}
		}
	});
});

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
