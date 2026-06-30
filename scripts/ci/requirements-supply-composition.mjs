#!/usr/bin/env node
import { buildEnvironmentPressureReport } from "@refarm.dev/health/environment-pressure";
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
		boundaries: [
			"does not run browser automation",
			"does not import private source selectors or login flows",
			"does not persist consumer vocabulary into Refarm packages",
			"does not add release-policy or vault-seed-ready metadata",
		],
		nextActions: [
			"attach a sanitized artifact manifest and review report before release-policy promotion",
			"record downstream local handoff evidence before release-policy promotion",
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
