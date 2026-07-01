#!/usr/bin/env node
import {
	TASK_ARTIFACT_MANIFEST_SCHEMA,
	validateTaskArtifactManifest,
} from "../../packages/artifact-contract-v1/dist/index.js";
import { buildEnvironmentPressureReport } from "./lib/environment-pressure.mjs";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReferenceEnrichmentProvider } from "../../packages/enrichment-contract-v1/dist/index.js";
import {
	computeRecordContentHash,
	createReferenceRecordsFixture,
	createReferenceRecordsProvider,
} from "../../packages/records-contract-v1/dist/index.js";
import { createWebSourceProvider } from "../../packages/source-web/dist/index.js";

const SCHEMA = "refarm.requirements-supply-composition.v1";
const DEFAULT_COMPLETED_AT = "2026-06-30T00:00:00.000Z";
const RUN_ID = "requirements-supply-composition-2026-06-30";

function issue(code, message, evidence = null) {
	return {
		code,
		message,
		...(evidence ? { evidence } : {}),
	};
}

function externalKeyFor(record, index) {
	if (typeof record.fields.externalKey === "string") {
		return record.fields.externalKey;
	}
	return `REQ-${index + 1}`;
}

function reviewStateCounts(records) {
	const counts = {};
	for (const record of records) {
		const state = record.review?.state ?? "unreviewed";
		counts[state] = (counts[state] ?? 0) + 1;
	}
	return counts;
}

function sourceCoverage(records) {
	const withSourceRefs = records.filter((record) => (record.sourceRefs ?? []).length > 0).length;
	return {
		total: records.length,
		withSourceRefs,
		complete: records.length > 0 && withSourceRefs === records.length,
	};
}

function stableStringify(value) {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
	}

	return JSON.stringify(value);
}

function sha256(value) {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function applyEnrichment(manifest, enrichmentResult) {
	const byId = new Map(enrichmentResult.records.map((record) => [record.id, record]));
	return {
		...manifest,
		records: manifest.records.map((record) => {
			const enriched = byId.get(record.id);
			if (!enriched || enriched.skipped || enriched.changes.length === 0) {
				return record;
			}

			const nextRecord = {
				...record,
				fields: {
					...record.fields,
					...Object.fromEntries(enriched.changes.map((change) => [change.field, change.after])),
				},
				enrichmentProvenance: enriched.changes.map((change) => change.provenance),
				contentHash: "",
			};
			nextRecord.contentHash = computeRecordContentHash(nextRecord);
			return nextRecord;
		}),
	};
}

function decideGate({ pressure, validation, coverage, enrichment }) {
	if (!pressure.ok) return "refuse";
	if (!validation.ok || !coverage.complete) return "refuse";
	if (pressure.decision !== "continue") return "serialize";
	if (enrichment.diagnostics.skipped > 0) return "degrade";
	return "allow";
}

function buildReviewReport({ coverage, enrichment, finalValidation, sourceProvenance, gateDecision }) {
	return {
		schema: "refarm.requirements-supply-review.v1",
		gateDecision,
		source: {
			authenticatedFixture: sourceProvenance?.session.authenticated === true,
			offlineReplay: sourceProvenance?.cache.offlineReplay === true,
			redacted: sourceProvenance?.redaction.applied === true,
		},
		records: {
			sourceCoverage: coverage,
			validation: finalValidation,
		},
		enrichment: {
			mode: enrichment.mode,
			diagnostics: enrichment.diagnostics,
		},
	};
}

function buildArtifactManifest({
	completedAt,
	enrichedManifest,
	enrichment,
	reviewReport,
	sourceMaterialize,
	sourceProvenance,
}) {
	const command = "pnpm run requirements:supply:composition";
	const process = {
		command: "pnpm",
		args: ["run", "requirements:supply:composition"],
		display: command,
		cwd: "/workspaces/refarm",
		packageManager: "pnpm",
	};
	const baseProvenance = {
		runId: RUN_ID,
		producer: "refarm:requirements-supply-composition",
		command,
		process,
		source: "requirements-supply-fixture",
		sourceVersion: "synthetic-v1",
		producedAt: completedAt,
	};

	return {
		schema: TASK_ARTIFACT_MANIFEST_SCHEMA,
		taskId: "work-3-requirements-supply",
		effortId: RUN_ID,
		createdAt: completedAt,
		artifacts: [
			{
				id: "source-web-snapshot",
				uri: sourceMaterialize.location.path,
				mediaType: "application/vnd.refarm.source-web.snapshot+json",
				role: "dataset",
				reviewState: "accepted",
				hash: {
					algorithm: "sha256",
					value: sourceProvenance?.cache.hash.replace(/^sha256:/, "") ?? sha256(sourceMaterialize),
				},
				provenance: {
					...baseProvenance,
					inputHashes: sourceProvenance
						? [{ algorithm: "sha256", value: sourceProvenance.cache.hash.replace(/^sha256:/, "") }]
						: undefined,
				},
				labels: ["source-web", "offline-replay", "redacted"],
			},
			{
				id: "records-manifest",
				uri: "memory:requirements-supply/records-manifest.json",
				mediaType: "application/vnd.refarm.records+json",
				role: "manifest",
				reviewState: "accepted",
				hash: {
					algorithm: "sha256",
					value: sha256(enrichedManifest),
				},
				provenance: baseProvenance,
				labels: ["records:v1", "knowledge-graph"],
			},
			{
				id: "enrichment-report",
				uri: "memory:requirements-supply/enrichment-report.json",
				mediaType: "application/vnd.refarm.enrichment-report+json",
				role: "report",
				reviewState: enrichment.diagnostics.skipped === 0 ? "accepted" : "unreviewed",
				hash: {
					algorithm: "sha256",
					value: sha256(enrichment),
				},
				provenance: baseProvenance,
				labels: ["enrichment:v1", "dry-run"],
			},
			{
				id: "review-report",
				uri: "memory:requirements-supply/review-report.json",
				mediaType: "application/vnd.refarm.requirements-supply-review+json",
				role: "audit-trail",
				reviewState: "accepted",
				hash: {
					algorithm: "sha256",
					value: sha256(reviewReport),
				},
				provenance: baseProvenance,
				labels: ["review", "preflight", "composition"],
			},
		],
	};
}

export async function buildRequirementsSupplyComposition({
	completedAt = DEFAULT_COMPLETED_AT,
	cwd = process.cwd(),
} = {}) {
	const issues = [];
	const sourceCacheRoot = await mkdtemp(path.join(os.tmpdir(), "requirements-supply-source-web-"));
	const sourceProvider = createWebSourceProvider({ cacheRoot: sourceCacheRoot });
	const recordsProvider = createReferenceRecordsProvider();
	const enrichmentProvider = createReferenceEnrichmentProvider();
	const sourceMaterialize = await sourceProvider.materialize("web:requirements-fixture", { offline: true });
	const sourceStatus = await sourceProvider.status("web:requirements-fixture");
	const sourceProvenance = await sourceProvider.snapshotProvenance("web:requirements-fixture");
	if (!sourceStatus.materialized || !sourceProvenance) {
		issues.push(issue(
			"SOURCE_WEB_SNAPSHOT_NOT_READY",
			"Expected source-web fixture to materialize an offline replay snapshot with provenance.",
			{ status: sourceStatus, materialize: sourceMaterialize },
		));
	}

	const manifest = createReferenceRecordsFixture();
	const initialValidation = recordsProvider.validate(manifest);
	if (!initialValidation.ok) {
		issues.push(issue(
			"INITIAL_RECORDS_INVALID",
			"Expected the sanitized records fixture to validate before enrichment.",
			initialValidation.failures,
		));
	}

	const inputs = manifest.records.map((record, index) => ({
		id: record.id,
		fields: {
			...record.fields,
			externalKey: externalKeyFor(record, index),
		},
		sourceRef: record.sourceRefs?.[0],
	}));
	const selected = enrichmentProvider.select(inputs);
	if (selected.length !== inputs.length) {
		issues.push(issue(
			"ENRICHMENT_SELECTION_INCOMPLETE",
			"Expected every sanitized record fixture to expose a deterministic external key.",
			{ selected: selected.length, total: inputs.length },
		));
	}

	const enrichment = await enrichmentProvider.enrich(selected, { mode: "dry-run" });
	const enrichedManifest = applyEnrichment(manifest, enrichment);
	const finalValidation = recordsProvider.validate(enrichedManifest);
	if (!finalValidation.ok) {
		issues.push(issue(
			"ENRICHED_RECORDS_INVALID",
			"Expected records:v1 validation to pass after consumer-owned enrichment application.",
			finalValidation.failures,
		));
	}

	const coverage = sourceCoverage(enrichedManifest.records);
	if (!coverage.complete) {
		issues.push(issue(
			"SOURCE_COVERAGE_INCOMPLETE",
			"Expected every sanitized record to carry at least one source:v1 reference.",
			coverage,
		));
	}

	const pressure = buildEnvironmentPressureReport({
		command: "requirements-supply-composition",
		operation: "preflight",
		cwd,
	});
	const gateDecision = decideGate({
		pressure,
		validation: finalValidation,
		coverage,
		enrichment,
	});
	const reviewReport = buildReviewReport({
		coverage,
		enrichment,
		finalValidation,
		sourceProvenance,
		gateDecision,
	});
	const artifactManifest = buildArtifactManifest({
		completedAt,
		enrichedManifest,
		enrichment,
		reviewReport,
		sourceMaterialize,
		sourceProvenance,
	});
	const artifactValidation = validateTaskArtifactManifest(artifactManifest);
	if (!artifactValidation.ok) {
		issues.push(issue(
			"ARTIFACT_MANIFEST_INVALID",
			"Expected the sanitized artifact:v1 manifest to validate.",
			artifactValidation.issues,
		));
	}

	return {
		schema: SCHEMA,
		completedAt,
		ok: issues.length === 0 && gateDecision !== "refuse",
		mode: "synthetic-sanitized-composition",
		gateDecision,
		pressure: {
			ok: pressure.ok,
			decision: pressure.decision,
			signalCount: pressure.signals.length,
			nextCommands: pressure.nextCommands,
		},
		source: {
			providerId: sourceProvider.pluginId,
			capability: sourceProvider.capability,
			kinds: sourceProvider.kinds,
			ref: sourceProvenance?.cache.ref ?? "web:requirements-fixture",
			location: sourceMaterialize.location,
			action: sourceMaterialize.action,
			status: {
				materialized: sourceStatus.materialized,
				kind: sourceStatus.kind,
				clean: sourceStatus.clean,
				dirty: sourceStatus.dirty,
				head: sourceStatus.head,
				lastFetchedAt: sourceStatus.lastFetchedAt,
			},
			provenance: sourceProvenance
				? {
					session: {
						kind: sourceProvenance.session.kind,
						authenticated: sourceProvenance.session.authenticated,
						credentialRef: sourceProvenance.session.credentialRef,
					},
					pacing: sourceProvenance.pacing,
					cache: sourceProvenance.cache,
					redaction: sourceProvenance.redaction,
				}
				: null,
		},
		records: {
			providerId: recordsProvider.pluginId,
			capability: recordsProvider.capability,
			total: enrichedManifest.records.length,
			initialValidation: {
				ok: initialValidation.ok,
				failureCount: initialValidation.failures.length,
			},
			finalValidation: {
				ok: finalValidation.ok,
				failureCount: finalValidation.failures.length,
			},
			sourceCoverage: coverage,
			reviewStates: reviewStateCounts(enrichedManifest.records),
		},
		enrichment: {
			providerId: enrichmentProvider.pluginId,
			capability: enrichmentProvider.capability,
			description: enrichmentProvider.describe(),
			mode: enrichment.mode,
			diagnostics: enrichment.diagnostics,
			changedRecordIds: enrichment.records
				.filter((record) => !record.skipped && record.changes.length > 0)
				.map((record) => record.id),
		},
		artifacts: {
			capability: "artifact:v1",
			validation: {
				ok: artifactValidation.ok,
				issueCount: artifactValidation.issues.length,
			},
			manifest: artifactManifest,
			reviewReport,
		},
		boundaries: [
			"does not run browser automation",
			"does not import private source selectors or login flows",
			"does not persist consumer vocabulary into Refarm packages",
			"does not generate handoff tarballs; official publication handoff remains release:vault-seed:handoff",
		],
		nextActions: [
			"keep the downstream reference-vault proof linked to release-policy promotion",
			"keep private selectors, login, enrichment providers, and vocabulary downstream-owned",
		],
		issueCount: issues.length,
		issues,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const json = process.argv.includes("--json");
	const result = await buildRequirementsSupplyComposition();
	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`requirements-supply-composition: ${result.ok ? "ok" : "blocked"} (${result.gateDecision})`);
	}
	process.exit(result.ok ? 0 : 1);
}
