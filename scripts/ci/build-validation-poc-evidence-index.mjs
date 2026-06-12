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
	},
	{
		id: "citizen-data-wallet",
		theme: "citizen data wallet",
		root: "validations/citizen-data-wallet-poc/fixtures/expected",
		manifestUri: "validations/citizen-data-wallet-poc/fixtures/expected/task-artifacts.json",
	},
	{
		id: "governed-note-box",
		theme: "governed note box",
		root: "validations/governed-note-box-poc/fixtures/expected",
		manifestUri: "validations/governed-note-box-poc/fixtures/expected/task-artifacts.json",
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
			riskAndStandards: labelledRef(poc, manifest, ["risk", "standards"]),
			limits: labelledRef(poc, manifest, ["limits", "adoption"]),
			claimPromotion,
			readerStart: labelledRef(poc, manifest, ["scenario"]),
		},
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
