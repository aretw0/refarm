import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUED_AT = "2026-01-01T00:00:00.000Z";
export const TASK_ID = "task-governed-note-box-poc";
export const EFFORT_ID = "effort-governed-note-box-poc-001";
export const RUN_ID = "governed-note-box-poc-001";

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

export function buildTaskArtefactManifest(writtenArtifacts) {
	const roles = {
		"intake-snapshot.json": "dataset",
		"metadata-index.json": "dataset",
		"lab-snapshot.json": "dataset",
		"publication-snapshot.json": "dataset",
		"publication-preflight.json": "audit-trail",
		"scorecard.json": "report",
		"human-review.md": "report",
	};
	const labels = {
		"intake-snapshot.json": ["ingestion"],
		"metadata-index.json": ["metadata", "lab"],
		"lab-snapshot.json": ["lab"],
		"publication-snapshot.json": ["publication"],
		"publication-preflight.json": ["publication", "preflight"],
		"scorecard.json": ["scorecard", "pilot"],
		"human-review.md": ["publication", "human-review"],
	};

	return {
		schema: "refarm.task-artefacts.v1",
		taskId: TASK_ID,
		effortId: EFFORT_ID,
		createdAt: ISSUED_AT,
		artefacts: Object.entries(writtenArtifacts).map(([fileName, contents]) => ({
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
				command: "pnpm run governed-note-box:poc",
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
	const writtenArtifacts = {
		"intake-snapshot.json": jsonText(report.intakeSnapshot),
		"metadata-index.json": jsonText(report.metadataIndex),
		"lab-snapshot.json": jsonText(report.labSnapshot),
		"publication-snapshot.json": jsonText(report.publicationSnapshot),
		"publication-preflight.json": jsonText(report.publicationPreflight),
		"scorecard.json": jsonText(scorecard),
		"human-review.md": buildReviewMarkdown(report),
	};
	const manifest = buildTaskArtefactManifest(writtenArtifacts);

	mkdirSync(outDir, { recursive: true });
	for (const [fileName, contents] of Object.entries(writtenArtifacts)) {
		writeFileSync(path.join(outDir, fileName), contents);
	}
	writeFileSync(path.join(outDir, "task-artefacts.json"), jsonText(manifest));
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
