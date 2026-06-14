#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INDEX_SCHEMA = "refarm.validation-poc-evidence-index.v1";
export const CREATED_AT = "2026-01-01T00:00:00.000Z";

export const POCS = [
	{
		id: "extension-sandbox",
		theme: "extension governance",
		root: "validations/extension-sandbox-poc/fixtures/expected",
		manifestUri: "validations/extension-sandbox-poc/fixtures/expected/task-artifacts.json",
		writingClaims: [
			{
				id: "explicit-capability-decisions",
				carefulClaim:
					"A host can make extension capability decisions explicit and reviewable before promotion.",
				evidenceIds: ["policy-decision-json", "sandbox-report-json", "annex-md"],
				doNotSayYet: "Production plugin governance is solved.",
			},
			{
				id: "failure-policy-choice",
				carefulClaim:
					"Failure policy can be modeled as an operational choice, not hidden behavior.",
				evidenceIds: ["sandbox-report-md", "scorecard-json", "limits-md"],
				doNotSayYet: "Real host performance or complete isolation is proven.",
			},
			{
				id: "linked-real-wasm-path",
				carefulClaim:
					"Synthetic policy evidence is connected to a real WASM validation path.",
				evidenceIds: ["runtime-evidence-json", "task-artifacts"],
				doNotSayYet: "The synthetic report itself executed real WASM plugins.",
			},
			{
				id: "coding-agent-governance-shape",
				carefulClaim:
					"A coding-agent workflow can be framed with explicit capability review, provenance, and human promotion gates.",
				evidenceIds: [
					"coding-agent-evidence-json",
					"coding-agent-smoke-json",
					"policy-decision-json",
					"limits-md",
				],
				doNotSayYet:
					"A production autonomous coding agent or safe unattended repository mutation is proven.",
			},
		],
	},
	{
		id: "citizen-data-wallet",
		theme: "citizen data wallet",
		root: "validations/citizen-data-wallet-poc/fixtures/expected",
		manifestUri: "validations/citizen-data-wallet-poc/fixtures/expected/task-artifacts.json",
		writingClaims: [
			{
				id: "reviewable-purpose-and-disclosure",
				carefulClaim:
					"Purpose, scope, expiration, and selective disclosure can be represented as reviewable artifacts.",
				evidenceIds: [
					"service-request",
					"authorization-receipt",
					"selective-presentation",
				],
				doNotSayYet: "Formal wallet interoperability is proven.",
			},
			{
				id: "visible-tamper-and-revocation",
				carefulClaim:
					"Tamper detection and revocation can be made visible to the operator and holder journey.",
				evidenceIds: ["audit-trail", "revocation-event", "consent-decision"],
				doNotSayYet: "Legal compliance or production UX is ready.",
			},
			{
				id: "pilot-evaluation-before-adoption",
				carefulClaim:
					"The flow can be evaluated with pilot criteria before institutional adoption.",
				evidenceIds: ["scorecard", "risk-and-standards-matrix", "limits"],
				doNotSayYet:
					"LGPD, W3C VC, OpenID4VP, or EUDI conformance is certified.",
			},
		],
	},
	{
		id: "governed-note-box",
		theme: "governed note box",
		root: "validations/governed-note-box-poc/fixtures/expected",
		manifestUri: "validations/governed-note-box-poc/fixtures/expected/task-artifacts.json",
		writingClaims: [
			{
				id: "provenance-separated-workflow",
				carefulClaim:
					"Local knowledge artifacts can keep provenance while separating intake, lab, and publication snapshots.",
				evidenceIds: ["metadata-index", "lab-snapshot", "publication-snapshot"],
				doNotSayYet: "Real vault integration is implemented.",
			},
			{
				id: "human-review-before-publish",
				carefulClaim:
					"Publication can remain blocked on human review while still producing useful lab evidence.",
				evidenceIds: ["publication-preflight", "human-review", "scorecard"],
				doNotSayYet: "Editorial policy completeness is proven.",
			},
			{
				id: "manifest-selector-consumption",
				carefulClaim:
					"Downstream consumers can navigate evidence through manifest selectors instead of hard-coded file names.",
				evidenceIds: ["consumer-evidence", "task-artifacts", "poc-evidence-index"],
				doNotSayYet:
					"Obsidian, Astro, Marimo, or work-mirror UX is owned by Refarm.",
			},
		],
	},
];

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function labelsOf(artifact) {
	return artifact.labels ?? [];
}

function hasLabels(artifact, labels) {
	return labels.every((label) => labelsOf(artifact).includes(label));
}

function relativeArtifactUri(poc, artifact) {
	return `${poc.root}/${artifact.uri}`;
}

function firstArtifact(manifest, predicate) {
	return manifest.artifacts.find(predicate);
}

function artifactRef(poc, artifact) {
	if (!artifact) return null;
	return {
		id: artifact.id,
		uri: relativeArtifactUri(poc, artifact),
		role: artifact.role,
		mediaType: artifact.mediaType,
		reviewState: artifact.reviewState ?? null,
		labels: labelsOf(artifact),
	};
}

function requiredRef(poc, manifest, id) {
	return artifactRef(poc, firstArtifact(manifest, (artifact) => artifact.id === id));
}

function claimEvidenceRef(poc, manifest, id) {
	if (id === "task-artifacts") {
		return {
			id,
			uri: poc.manifestUri,
			role: "manifest",
			mediaType: "application/json",
			reviewState: "accepted",
			labels: ["provenance", "manifest"],
		};
	}
	if (id === "poc-evidence-index") {
		return {
			id,
			uri: "validations/poc-evidence-index.json",
			role: "manifest",
			mediaType: "application/json",
			reviewState: "accepted",
			labels: ["suite-index", "claim-map"],
		};
	}
	return requiredRef(poc, manifest, id);
}

function buildWritingClaims(poc, manifest) {
	return poc.writingClaims.map((claim) => ({
		id: claim.id,
		carefulClaim: claim.carefulClaim,
		primaryEvidence: claim.evidenceIds.map((id) => {
			const evidence = claimEvidenceRef(poc, manifest, id);
			if (!evidence) {
				throw new Error(`${poc.id} writing claim ${claim.id} references missing artifact ${id}`);
			}
			return evidence;
		}),
		doNotSayYet: claim.doNotSayYet,
	}));
}

function labelledRef(poc, manifest, labels) {
	return artifactRef(poc, firstArtifact(manifest, (artifact) => hasLabels(artifact, labels)));
}

function countBy(items, keyFor) {
	return Object.fromEntries(
		[...items.reduce((counts, item) => {
			const key = keyFor(item);
			counts.set(key, (counts.get(key) ?? 0) + 1);
			return counts;
		}, new Map())].sort(([left], [right]) => left.localeCompare(right)),
	);
}

function uniqueLabels(manifest) {
	return [...new Set(manifest.artifacts.flatMap((artifact) => labelsOf(artifact)))].sort();
}

function buildPocIndex(rootDir, poc) {
	const manifest = readJson(path.join(rootDir, poc.manifestUri));
	const claimPromotion = manifest.artifacts
		.filter((artifact) => hasLabels(artifact, ["claim-promotion"]))
		.map((artifact) => artifactRef(poc, artifact));

	return {
		id: poc.id,
		theme: poc.theme,
		manifestUri: poc.manifestUri,
		taskId: manifest.taskId,
		effortId: manifest.effortId,
		evidence: {
			scenario: labelledRef(poc, manifest, ["scenario"]),
			annex: labelledRef(poc, manifest, ["annex"]),
			scorecard: labelledRef(poc, manifest, ["scorecard"]),
			resultsTable: labelledRef(poc, manifest, ["results-table"]),
			riskAndStandards: labelledRef(poc, manifest, ["risk", "standards"]),
			limits: labelledRef(poc, manifest, ["limits", "adoption"]),
			claimPromotion,
			readerStart: labelledRef(poc, manifest, ["scenario"]),
		},
		writingClaims: buildWritingClaims(poc, manifest),
		consumerHints: {
			labels: uniqueLabels(manifest),
			countByRole: countBy(manifest.artifacts, (artifact) => artifact.role),
			countByReviewState: countBy(
				manifest.artifacts,
				(artifact) => artifact.reviewState ?? "unspecified",
			),
		},
	};
}

export function buildValidationPocEvidenceIndex(rootDir = process.cwd()) {
	const pocs = POCS.map((poc) => buildPocIndex(rootDir, poc));
	return {
		schema: INDEX_SCHEMA,
		createdAt: CREATED_AT,
		purpose:
			"Reader-facing index for synthetic validation POC evidence without copying consumer-specific vault semantics.",
		boundary: {
			canUseFor: [
				"proposal evidence navigation",
				"downstream lab or vault consumer mapping",
				"claim-boundary review before writing",
			],
			mustNotUseFor: [
				"formal standards conformance claims",
				"real vault or service integration claims",
				"submission-specific wording",
			],
		},
		pocs,
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const rootDir = process.cwd();
	const outPath = path.join(rootDir, "validations", "poc-evidence-index.json");
	const index = buildValidationPocEvidenceIndex(rootDir);
	writeFileSync(outPath, `${JSON.stringify(index, null, 2)}\n`);
	console.log(JSON.stringify({ ok: true, outPath, pocs: index.pocs.length }, null, 2));
}
