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
		manifestUri: "validations/extension-sandbox-poc/fixtures/expected/task-artefacts.json",
	},
	{
		id: "citizen-data-wallet",
		theme: "citizen data wallet",
		root: "validations/citizen-data-wallet-poc/fixtures/expected",
		manifestUri: "validations/citizen-data-wallet-poc/fixtures/expected/task-artefacts.json",
	},
	{
		id: "governed-note-box",
		theme: "governed note box",
		root: "validations/governed-note-box-poc/fixtures/expected",
		manifestUri: "validations/governed-note-box-poc/fixtures/expected/task-artefacts.json",
	},
];

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function labelsOf(artefact) {
	return artefact.labels ?? [];
}

function hasLabels(artefact, labels) {
	return labels.every((label) => labelsOf(artefact).includes(label));
}

function relativeArtefactUri(poc, artefact) {
	return `${poc.root}/${artefact.uri}`;
}

function firstArtefact(manifest, predicate) {
	return manifest.artefacts.find(predicate);
}

function artefactRef(poc, artefact) {
	if (!artefact) return null;
	return {
		id: artefact.id,
		uri: relativeArtefactUri(poc, artefact),
		role: artefact.role,
		mediaType: artefact.mediaType,
		reviewState: artefact.reviewState ?? null,
		labels: labelsOf(artefact),
	};
}

function requiredRef(poc, manifest, id) {
	return artefactRef(poc, firstArtefact(manifest, (artefact) => artefact.id === id));
}

function labelledRef(poc, manifest, labels) {
	return artefactRef(poc, firstArtefact(manifest, (artefact) => hasLabels(artefact, labels)));
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
	return [...new Set(manifest.artefacts.flatMap((artefact) => labelsOf(artefact)))].sort();
}

function buildPocIndex(rootDir, poc) {
	const manifest = readJson(path.join(rootDir, poc.manifestUri));
	const claimPromotion = manifest.artefacts
		.filter((artefact) => hasLabels(artefact, ["claim-promotion"]))
		.map((artefact) => artefactRef(poc, artefact));

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
			riskAndStandards: labelledRef(poc, manifest, ["risk", "standards"]),
			limits: labelledRef(poc, manifest, ["limits", "adoption"]),
			claimPromotion,
			readerStart: labelledRef(poc, manifest, ["scenario"]),
		},
		consumerHints: {
			labels: uniqueLabels(manifest),
			countByRole: countBy(manifest.artefacts, (artefact) => artefact.role),
			countByReviewState: countBy(
				manifest.artefacts,
				(artefact) => artefact.reviewState ?? "unspecified",
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
