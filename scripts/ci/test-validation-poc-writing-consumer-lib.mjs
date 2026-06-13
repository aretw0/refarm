import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assertNoPrivateTerms,
	validateValidationPocWritingConsumer,
} from "./validation-poc-writing-consumer-lib.mjs";

function makeIndex(overrides = {}) {
	return {
		schema: "refarm.validation-poc-evidence-index.v1",
		pocs: ["extension-sandbox", "citizen-data-wallet", "governed-note-box"].map((id) => ({
			id,
			evidence: {
				readerStart: { uri: `${id}/scenario.md` },
				annex: { uri: `${id}/annex.md` },
				scorecard: { uri: `${id}/scorecard.json` },
				limits: { uri: `${id}/limits.md` },
			},
			writingClaims: [
				{
					id: "careful",
					carefulClaim: "A careful claim is supported by local evidence.",
					doNotSayYet: "A stronger private or production claim is proven.",
					primaryEvidence: [
						{ uri: `${id}/scenario.md` },
						{ uri: `${id}/annex.md` },
					],
				},
			],
		})),
		...overrides,
	};
}

function makeOptions(missing = new Set(), textByUri = {}) {
	return {
		exists: (uri) => !missing.has(uri),
		readText: (uri) => textByUri[uri] ?? "# Limits\n\n## Do Not Claim\n\n- Stronger claim.",
	};
}

describe("validation poc writing consumer", () => {
	it("accepts a complete sanitized index", () => {
		const result = validateValidationPocWritingConsumer(makeIndex(), makeOptions());

		assert.deepEqual(result, { ok: true, pocCount: 3 });
	});

	it("normalizes accents when checking private terms", () => {
		assert.throws(
			() => assertNoPrivateTerms("Premio-specific wording", "claim"),
			/proposal-neutral/,
		);
	});

	it("rejects missing primary evidence files", () => {
		const missing = new Set(["extension-sandbox/annex.md"]);

		assert.throws(
			() => validateValidationPocWritingConsumer(makeIndex(), makeOptions(missing)),
			/extension-sandbox\/careful evidence URI must exist/,
		);
	});

	it("rejects themes without explicit limits", () => {
		const index = makeIndex({
			pocs: makeIndex().pocs.map((poc) =>
				poc.id === "governed-note-box"
					? { ...poc, evidence: { ...poc.evidence, limits: null } }
					: poc,
			),
		});

		assert.throws(
			() => validateValidationPocWritingConsumer(index, makeOptions()),
			/governed-note-box must expose limits/,
		);
	});
});
