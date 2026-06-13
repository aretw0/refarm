import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUED_AT = "2026-01-01T00:00:00.000Z";
export const TASK_ID = "task-governed-note-box-poc";
export const EFFORT_ID = "effort-governed-note-box-poc-001";
export const RUN_ID = "governed-note-box-poc-001";
export const PRODUCER_PROCESS = {
	command: "node",
	args: ["validations/governed-note-box-poc/governed-note-box-poc.mjs"],
	display: "node validations/governed-note-box-poc/governed-note-box-poc.mjs",
};

const NOTES = [
	{
		id: "note-001",
		title: "Sandboxed Extensions",
		body: "Synthetic note about extension capability review.",
		tags: ["extensions", "governance"],
		links: ["note-002"],
		status: "ready",
		createdAt: "2026-01-01",
	},
	{
		id: "note-002",
		title: "Consent Receipts",
		body: "Synthetic note about scoped authorization evidence.",
		tags: ["identity", "audit"],
		links: ["note-001", "note-003"],
		status: "ready",
		createdAt: "2026-01-02",
	},
	{
		id: "note-003",
		title: "Publication Review",
		body: "Synthetic draft that should stay out of the publication snapshot.",
		tags: ["publication", "review"],
		links: ["note-002"],
		status: "draft",
		createdAt: "2026-01-03",
	},
];

function sha256Text(value) {
	return createHash("sha256").update(value).digest("hex");
}

function jsonText(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function metadataFor(note) {
	return {
		id: note.id,
		title: note.title,
		tags: [...note.tags].sort(),
		links: [...note.links].sort(),
		status: note.status,
		createdAt: note.createdAt,
		bodyHash: sha256Text(note.body),
	};
}

export function runGovernedNoteBoxPoc() {
	const intakeSnapshot = {
		source: "synthetic-local-notes",
		capturedAt: ISSUED_AT,
		notes: NOTES,
	};
	const metadataIndex = {
		createdAt: ISSUED_AT,
		notes: NOTES.map(metadataFor),
		byTag: Object.fromEntries(
			[...new Set(NOTES.flatMap((note) => note.tags))]
				.sort()
				.map((tag) => [
					tag,
					NOTES.filter((note) => note.tags.includes(tag)).map((note) => note.id),
				]),
		),
	};
	const labSnapshot = {
		createdAt: ISSUED_AT,
		metrics: {
			notes: NOTES.length,
			readyNotes: NOTES.filter((note) => note.status === "ready").length,
			draftNotes: NOTES.filter((note) => note.status === "draft").length,
			links: NOTES.reduce((total, note) => total + note.links.length, 0),
			tags: Object.keys(metadataIndex.byTag).length,
		},
		graph: NOTES.map((note) => ({
			id: note.id,
			title: note.title,
			links: note.links,
		})),
	};
	const publicationSnapshot = {
		createdAt: ISSUED_AT,
		notes: NOTES.filter((note) => note.status === "ready").map((note) => ({
			id: note.id,
			title: note.title,
			tags: note.tags,
		})),
	};
	const publicationPreflight = {
		createdAt: ISSUED_AT,
		checks: {
			allNotesHaveMetadata: metadataIndex.notes.every(
				(note) => note.title && note.createdAt && note.bodyHash,
			),
			draftsExcludedFromPublication: publicationSnapshot.notes.every(
				(note) => metadataIndex.notes.find((item) => item.id === note.id)?.status === "ready",
			),
			humanReviewRequired: true,
			noExternalServices: true,
		},
		blockers: [],
		warnings: ["Synthetic draft note withheld from publication snapshot."],
	};

	return {
		id: "governed-note-box-poc",
		createdAt: ISSUED_AT,
		question:
			"Can a local note workflow preserve metadata, create lab and publication snapshots, and require human review before publish?",
		scope: {
			data: "synthetic",
			externalServices: false,
			vaultUx: "out-of-scope",
		},
		intakeSnapshot,
		metadataIndex,
		labSnapshot,
		publicationSnapshot,
		publicationPreflight,
		checks: publicationPreflight.checks,
	};
}

export function buildReviewMarkdown(report) {
	return `# Governed Note Box PoC Review

Scope: synthetic local validation only. No real vault, work draft, personal data, institutional data, or secrets are used.

| Check | Result |
| --- | --- |
| All notes have metadata | ${report.checks.allNotesHaveMetadata} |
| Drafts excluded from publication | ${report.checks.draftsExcludedFromPublication} |
| Human review required | ${report.checks.humanReviewRequired} |
| External services used | ${!report.checks.noExternalServices} |

## Metrics

- Notes ingested: ${report.labSnapshot.metrics.notes}
- Ready notes: ${report.labSnapshot.metrics.readyNotes}
- Draft notes: ${report.labSnapshot.metrics.draftNotes}
- Publication notes: ${report.publicationSnapshot.notes.length}
- Tags indexed: ${report.labSnapshot.metrics.tags}
- Links indexed: ${report.labSnapshot.metrics.links}
`;
}

export function buildScenarioMarkdown(report) {
	return `# Governed Note Box PoC Scenario

Scope: synthetic local validation only. No real vault, work draft, personal data, institutional data, or secrets are used.

## Problem

A local knowledge base needs to preserve provenance and publish only reviewed material without turning the vault workflow into hidden automation. The scenario asks whether notes can move from intake to lab and publication snapshots with metadata, review gates, and explicit publication limits.

## Actors

- Author: creates synthetic notes.
- Curator: reviews metadata and publication readiness.
- Lab consumer: uses graph and metrics snapshots.
- Publication consumer: receives only reviewed note metadata.

## Decision Points

1. Every note must keep title, tags, links, status, date, and body hash.
2. Draft notes must be excluded from publication output.
3. The lab snapshot must expose graph and metric evidence.
4. Publication must remain blocked on human review.

## Outcome

The synthetic run ingested ${report.labSnapshot.metrics.notes} notes, kept ${report.labSnapshot.metrics.draftNotes} draft out of publication, and produced ${report.publicationSnapshot.notes.length} publication candidates. Human review remains required before publishing.
`;
}

export function buildAnnexMarkdown(report, scorecard) {
	const scoreRows = Object.entries(scorecard.scores)
		.map(([criterion, score]) => {
			const weight = scorecard.weights[criterion];
			return `| ${criterion} | ${score} | ${weight} | ${evidenceForNoteCriterion(criterion)} |`;
		})
		.join("\n");
	const flowRows = [
		["1", "Notes ingested", "Preserve source body and metadata", "intake-snapshot.json"],
		["2", "Metadata indexed", "Hash body, tags, links, status, and dates", "metadata-index.json"],
		["3", "Lab snapshot built", "Expose graph and metrics", "lab-snapshot.json"],
		["4", "Publication filtered", "Exclude draft notes", "publication-snapshot.json"],
		["5", "Preflight checked", "Require human review before publish", "publication-preflight.json"],
		["6", "Pilot reviewed", "Read scorecard and annex", "continue or needs-human-review gate"],
	]
		.map((row) => `| ${row.join(" | ")} |`)
		.join("\n");

	return `# Governed Note Box PoC Annex

## Flow Table

| Step | Event | Control | Output |
| ---: | --- | --- | --- |
${flowRows}

## Evidence Map

| Claim | Generated evidence |
| --- | --- |
| Metadata is preserved | \`metadata-index.json\` |
| Drafts stay out of publication | \`publication-snapshot.json\`, \`publication-preflight.json\` |
| Lab consumers have graph and metrics | \`lab-snapshot.json\` |
| Human review remains explicit | \`publication-preflight.json\`, \`human-review.md\` |
| Pilot decision is measurable | \`scorecard.json\` |

## Scorecard Criteria

| Criterion | Score | Weight | Evidence |
| --- | ---: | ---: | --- |
${scoreRows}

## Reader Path

1. Read \`scenario.md\` for the workflow question.
2. Inspect \`publication-preflight.json\` for readiness and warnings.
3. Inspect \`scorecard.json\` for thresholds and limits.
4. Use \`task-artifacts.json\` to verify hashes and provenance.
`;
}

export function buildLimitsMarkdown() {
	return `# Governed Note Box PoC Limits

Scope: synthetic local validation only. No real vault, work draft, personal data, institutional data, or secrets are used.

## Do Not Claim

- Real vault integration.
- Complete Obsidian, Astro, Marimo, or work-mirror publication workflow.
- Replacement of vault-local UX.
- Editorial policy completeness.

## Adoption Risks

- A real vault may contain schemas, links, embeds, and naming conventions not represented here.
- Publication packaging may require project-specific review and approval steps.
- Lab consumers may need notebook or dashboard adapters outside this POC.
- Editorial rules may change what counts as ready for publication.

## Promotion Path

Promote claims only after a consumer project reads the manifest, produces vault-local output, and exercises project-specific editorial, export, and publication gates.
`;
}

export function buildResultsTableMarkdown(report) {
	return `# Governed Note Box PoC Results Table

Scope: synthetic local validation only. No real vault, work draft, personal data, institutional data, or secrets are used.

| Criterion | Observed result | Gate | Evidence |
| --- | --- | --- | --- |
| Intake stays controlled | ${report.intakeSnapshot.notes.length} synthetic notes ingested | pass | \`intake-snapshot.json\` |
| Metadata is preserved | ${report.metadataIndex.notes.length} metadata records with body hashes | pass | \`metadata-index.json\` |
| Lab evidence is available | ${report.labSnapshot.metrics.links} links and ${report.labSnapshot.metrics.tags} tags indexed | pass | \`lab-snapshot.json\` |
| Drafts stay unpublished | ${report.labSnapshot.metrics.draftNotes} draft withheld from publication | pass | \`publication-snapshot.json\` |
| Human review remains explicit | review required before publish | watch | \`publication-preflight.json\`, \`human-review.md\` |

## Claim Boundary

Use this table to describe the controlled synthetic note workflow. Do not use it to claim real vault integration, complete publication workflow, or ownership of downstream vault UX by Refarm.
`;
}

export function buildPilotScorecard(report) {
	const scores = {
		metadataPreservation: report.checks.allNotesHaveMetadata ? 5 : 0,
		publicationHygiene: report.checks.draftsExcludedFromPublication ? 5 : 0,
		labSnapshot: report.labSnapshot.metrics.tags > 0 && report.labSnapshot.metrics.links > 0 ? 5 : 2,
		humanReview: report.checks.humanReviewRequired ? 4 : 0,
		localOnlyOperation: report.checks.noExternalServices ? 5 : 0,
	};
	const weights = {
		metadataPreservation: 0.25,
		publicationHygiene: 0.25,
		labSnapshot: 0.2,
		humanReview: 0.15,
		localOnlyOperation: 0.15,
	};
	const finalScore = weightedScore(scores, weights);

	return {
		id: "scorecard-governed-note-box-001",
		createdAt: ISSUED_AT,
		scale: 5,
		gate: finalScore >= 4.5 ? "continue" : "needs-human-review",
		finalScore,
		scores,
		weights,
		thresholds: {
			continue: 4.5,
			needsHumanReview: 3.5,
			doNotScaleBelow: 3.5,
		},
		limits: [
			"Synthetic notes only; this does not replace a vault product workflow.",
			"Publication readiness still requires vault-local editorial and UX review.",
		],
	};
}

export function buildRiskAndStandardsMatrix(report) {
	return {
		id: "risk-and-standards-governed-note-box-001",
		createdAt: ISSUED_AT,
		conformanceClaim: false,
		frameworks: [
			{
				id: "local-first-knowledge-workflow",
				name: "Local-first knowledge workflow",
				stance: "architecture-alignment",
				note:
					"This POC preserves metadata and publication gates without replacing vault, notebook, or publishing UX.",
			},
			{
				id: "publication-preflight-governance",
				name: "Publication preflight governance",
				stance: "control-pressure",
				note:
					"Draft exclusion, metadata checks, and human review are explicit before publishing.",
			},
		],
		controls: [
			{
				id: "metadata-preservation",
				risk: "notes lose source context during ingestion",
				evidence: ["intake-snapshot.json", "metadata-index.json"],
				status: report.checks.allNotesHaveMetadata ? "demonstrated" : "needs-work",
			},
			{
				id: "publication-hygiene",
				risk: "draft notes leak into publication output",
				evidence: ["publication-snapshot.json", "publication-preflight.json"],
				status: report.checks.draftsExcludedFromPublication ? "demonstrated" : "needs-work",
			},
			{
				id: "human-review",
				risk: "automation publishes without editorial review",
				evidence: ["publication-preflight.json", "human-review.md"],
				status: report.checks.humanReviewRequired ? "demonstrated" : "needs-work",
			},
		],
		gaps: [
			{
				id: "real-vault-consumer",
				neededForClaim: "real vault integration",
				nextEvidence: "Have a consumer project read the manifest and produce vault-local output.",
			},
			{
				id: "publication-outbox",
				neededForClaim: "complete publication workflow",
				nextEvidence: "Exercise outbox generation, preview, approval, and publish handoff.",
			},
			{
				id: "editorial-policy",
				neededForClaim: "editorial policy completeness",
				nextEvidence: "Attach project-specific editorial rules and acceptance criteria.",
			},
		],
	};
}

export function buildConsumerEvidence(report) {
	return {
		id: "consumer-evidence-governed-note-box-001",
		createdAt: ISSUED_AT,
		claim: "governed note artifacts are ready for downstream vault and lab consumers",
		claimStatus: "manifest-consumer-ready",
		scope: {
			data: report.scope.data,
			vaultUx: report.scope.vaultUx,
			externalServices: report.scope.externalServices,
			realVaultIntegration: false,
		},
		consumerSelectors: [
			{
				id: "lab-datasets",
				intent: "load graph and metadata for analysis notebooks or lab dashboards",
				query: {
					labels: ["lab"],
					mediaTypes: ["application/json"],
					reviewStates: ["accepted"],
					roles: ["dataset"],
					source: "validations/governed-note-box-poc",
				},
				expectedArtifacts: ["metadata-index", "lab-snapshot"],
			},
			{
				id: "publication-datasets",
				intent: "load publication candidates while preserving unreviewed status",
				query: {
					labels: ["publication"],
					reviewStates: ["unreviewed"],
					roles: ["dataset"],
				},
				expectedArtifacts: ["publication-snapshot"],
			},
			{
				id: "publication-preflight",
				intent: "load preflight evidence before any publish handoff",
				query: {
					labels: ["publication", "preflight"],
					roles: ["audit-trail"],
				},
				expectedArtifacts: ["publication-preflight"],
			},
			{
				id: "consumer-readiness-report",
				intent: "load the explicit downstream readiness boundary",
				query: {
					labels: ["consumer", "vault"],
					roles: ["report"],
				},
				expectedArtifacts: ["consumer-evidence"],
			},
		],
		evidenceCommands: [
			"pnpm run governed-note-box:poc:test",
			"pnpm run validation-pocs:consumer:test",
		],
		linkedEvidence: [
			"task-artifacts.json",
			"metadata-index.json",
			"lab-snapshot.json",
			"publication-preflight.json",
			"human-review.md",
			"scripts/ci/check-validation-poc-consumers.mjs",
		],
		canSay: [
			"downstream consumers can select governed note artifacts through the shared manifest contract",
			"lab and publication evidence have separate labels, roles, media types, and review states",
			"publication remains blocked on human review in the synthetic preflight evidence",
		],
		cannotSay: [
			"real vault integration is implemented",
			"Obsidian, Astro, Marimo, or work-mirror publication UX is implemented",
			"editorial policy completeness is proven",
		],
		nextPromotion: [
			"Have a consumer project read task-artifacts.json and produce vault-local output.",
			"Keep vault-specific schemas, commands, and publication packaging outside this POC.",
		],
	};
}

function evidenceForNoteCriterion(criterion) {
	const evidence = {
		metadataPreservation: "Metadata index contains hash, tags, links, status, and dates.",
		publicationHygiene: "Publication snapshot excludes draft notes.",
		labSnapshot: "Lab snapshot exposes graph and metric data.",
		humanReview: "Publication preflight requires human review.",
		localOnlyOperation: "Preflight records no external service dependency.",
	};
	return evidence[criterion] ?? "Synthetic note workflow evidence.";
}

export function buildTaskArtifactManifest(writtenArtifacts) {
	const roles = {
		"intake-snapshot.json": "dataset",
		"metadata-index.json": "dataset",
		"lab-snapshot.json": "dataset",
		"publication-snapshot.json": "dataset",
		"publication-preflight.json": "audit-trail",
		"scorecard.json": "report",
		"risk-and-standards-matrix.json": "report",
		"consumer-evidence.json": "report",
		"scenario.md": "report",
		"annex.md": "report",
		"limits.md": "report",
		"results-table.md": "report",
		"human-review.md": "report",
	};
	const labels = {
		"intake-snapshot.json": ["ingestion"],
		"metadata-index.json": ["metadata", "lab"],
		"lab-snapshot.json": ["lab"],
		"publication-snapshot.json": ["publication"],
		"publication-preflight.json": ["publication", "preflight"],
		"scorecard.json": ["scorecard", "pilot"],
		"risk-and-standards-matrix.json": ["risk", "standards", "claim-promotion"],
		"consumer-evidence.json": ["consumer", "vault", "claim-promotion"],
		"scenario.md": ["scenario", "reader-path"],
		"annex.md": ["annex", "evidence-map"],
		"limits.md": ["limits", "adoption", "claim-boundary"],
		"results-table.md": ["results-table", "reader-path", "claim-boundary"],
		"human-review.md": ["publication", "human-review"],
	};

	return {
		schema: "refarm.task-artifacts.v1",
		taskId: TASK_ID,
		effortId: EFFORT_ID,
		createdAt: ISSUED_AT,
		artifacts: Object.entries(writtenArtifacts).map(([fileName, contents]) => ({
			id: fileName.replace(/\.[^.]+$/, ""),
			uri: fileName,
			mediaType: fileName.endsWith(".md") ? "text/markdown" : "application/json",
			role: roles[fileName] ?? "other",
			hash: {
				algorithm: "sha256",
				value: sha256Text(contents),
			},
			reviewState: fileName === "publication-snapshot.json" ? "unreviewed" : "accepted",
			provenance: {
				runId: RUN_ID,
				producer: "governed-note-box:poc",
				command: PRODUCER_PROCESS.display,
				process: PRODUCER_PROCESS,
				source: "validations/governed-note-box-poc",
				sourceVersion: "synthetic-v1",
				producedAt: ISSUED_AT,
			},
			labels: labels[fileName] ?? [],
		})),
	};
}

export function writeArtifacts(outDir) {
	const report = runGovernedNoteBoxPoc();
	const scorecard = buildPilotScorecard(report);
	const riskAndStandardsMatrix = buildRiskAndStandardsMatrix(report);
	const consumerEvidence = buildConsumerEvidence(report);
	const writtenArtifacts = {
		"intake-snapshot.json": jsonText(report.intakeSnapshot),
		"metadata-index.json": jsonText(report.metadataIndex),
		"lab-snapshot.json": jsonText(report.labSnapshot),
		"publication-snapshot.json": jsonText(report.publicationSnapshot),
		"publication-preflight.json": jsonText(report.publicationPreflight),
		"scorecard.json": jsonText(scorecard),
		"risk-and-standards-matrix.json": jsonText(riskAndStandardsMatrix),
		"consumer-evidence.json": jsonText(consumerEvidence),
		"scenario.md": buildScenarioMarkdown(report),
		"annex.md": buildAnnexMarkdown(report, scorecard),
		"limits.md": buildLimitsMarkdown(),
		"results-table.md": buildResultsTableMarkdown(report),
		"human-review.md": buildReviewMarkdown(report),
	};
	const manifest = buildTaskArtifactManifest(writtenArtifacts);

	mkdirSync(outDir, { recursive: true });
	for (const [fileName, contents] of Object.entries(writtenArtifacts)) {
		writeFileSync(path.join(outDir, fileName), contents);
	}
	writeFileSync(path.join(outDir, "task-artifacts.json"), jsonText(manifest));
	return report;
}

function weightedScore(scores, weights) {
	const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
	const total = Object.entries(scores).reduce(
		(sum, [key, score]) => sum + score * (weights[key] ?? 0),
		0,
	);
	return Math.round((total / totalWeight) * 100) / 100;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const outDir =
		process.argv[2] ??
		path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "expected");
	const report = writeArtifacts(outDir);
	console.log(
		JSON.stringify(
			{
				ok: true,
				outDir,
				notes: report.labSnapshot.metrics.notes,
				readyNotes: report.labSnapshot.metrics.readyNotes,
				draftNotes: report.labSnapshot.metrics.draftNotes,
				publicationNotes: report.publicationSnapshot.notes.length,
				humanReviewRequired: report.checks.humanReviewRequired,
			},
			null,
			2,
		),
	);
}
