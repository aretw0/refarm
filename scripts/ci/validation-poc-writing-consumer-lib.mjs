export const WRITING_CONSUMER_SCHEMA = "refarm.validation-poc-evidence-index.v1";

export const DEFAULT_FORBIDDEN_PRIVATE_TERMS = [
	"job-vault",
	"premio",
	"serpro",
	"prize",
	"award",
];

function normalizeText(value) {
	return (typeof value === "string" ? value : JSON.stringify(value))
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

function assertCondition(condition, message) {
	if (!condition) throw new Error(message);
}

export function assertNoPrivateTerms(
	value,
	context,
	forbiddenTerms = DEFAULT_FORBIDDEN_PRIVATE_TERMS,
) {
	const text = normalizeText(value);
	for (const term of forbiddenTerms) {
		assertCondition(
			!text.includes(term),
			`${context} must stay proposal-neutral and not mention ${term}`,
		);
	}
}

export function validateValidationPocWritingConsumer(index, options) {
	const {
		exists,
		readText,
		forbiddenTerms = DEFAULT_FORBIDDEN_PRIVATE_TERMS,
	} = options;

	assertCondition(
		index.schema === WRITING_CONSUMER_SCHEMA,
		`Expected schema ${WRITING_CONSUMER_SCHEMA}`,
	);
	assertCondition(index.pocs?.length === 3, "Expected exactly 3 validation POCs");
	assertNoPrivateTerms(index, "poc evidence index", forbiddenTerms);

	for (const poc of index.pocs) {
		assertCondition(poc.evidence.readerStart?.uri, `${poc.id} must expose a reader start`);
		assertCondition(poc.evidence.annex?.uri, `${poc.id} must expose an annex`);
		assertCondition(poc.evidence.scorecard?.uri, `${poc.id} must expose a scorecard`);
		assertCondition(poc.evidence.limits?.uri, `${poc.id} must expose limits`);

		const limitsText = readText(poc.evidence.limits.uri);
		assertCondition(
			/Do Not Claim/.test(limitsText),
			`${poc.id} limits must include non-claims`,
		);
		assertNoPrivateTerms(limitsText, `${poc.id} limits`, forbiddenTerms);

		for (const claim of poc.writingClaims) {
			assertCondition(
				claim.carefulClaim,
				`${poc.id}/${claim.id} needs a careful claim`,
			);
			assertCondition(
				claim.doNotSayYet,
				`${poc.id}/${claim.id} needs a non-claim boundary`,
			);
			assertCondition(
				claim.primaryEvidence.length >= 2,
				`${poc.id}/${claim.id} needs at least two evidence anchors`,
			);
			assertNoPrivateTerms(
				claim.carefulClaim,
				`${poc.id}/${claim.id} claim`,
				forbiddenTerms,
			);
			assertNoPrivateTerms(
				claim.doNotSayYet,
				`${poc.id}/${claim.id} boundary`,
				forbiddenTerms,
			);

			for (const evidence of claim.primaryEvidence) {
				assertCondition(evidence.uri, `${poc.id}/${claim.id} evidence needs a URI`);
				assertCondition(
					exists(evidence.uri),
					`${poc.id}/${claim.id} evidence URI must exist: ${evidence.uri}`,
				);
			}
		}
	}

	return { ok: true, pocCount: index.pocs.length };
}
