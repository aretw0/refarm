import {
	ENRICHMENT_CAPABILITY,
	type EnrichmentChange,
	type EnrichmentConformanceResult,
	type EnrichmentErrorCode,
	type EnrichmentInput,
	type EnrichmentProvider,
	type EnrichmentRecordResult,
	type EnrichmentResult,
} from "./types.js";

const SAMPLE_INPUTS: EnrichmentInput[] = [
	{
		id: "note-1",
		fields: { externalKey: "REQ-1", title: "Offline fixture" },
		sourceRef: "local:/requirements/note-1.md",
	},
	{
		id: "note-missing-key",
		fields: { title: "No key" },
		sourceRef: "local:/requirements/no-key.md",
	},
	{
		id: "note-no-match",
		fields: { externalKey: "REQ-404", title: "No match" },
		sourceRef: "local:/requirements/no-match.md",
	},
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertDescription(provider: EnrichmentProvider, failures: string[]): void {
	try {
		const description = provider.describe();
		if (!isPlainObject(description)) {
			failures.push("describe() must return an object");
			return;
		}

		if (!description.providerId || description.providerId.trim().length === 0) {
			failures.push("describe().providerId must be a non-empty string");
		}

		if (!Array.isArray(description.needsKeyFrom) || description.needsKeyFrom.length === 0) {
			failures.push("describe().needsKeyFrom must be a non-empty array");
		}

		if (!Array.isArray(description.addsFields)) {
			failures.push("describe().addsFields must be an array");
		}
	} catch (error) {
		failures.push(`describe() threw: ${String(error)}`);
	}
}

function assertSelected(provider: EnrichmentProvider, failures: string[]): void {
	try {
		const selected = provider.select(SAMPLE_INPUTS);
		if (!Array.isArray(selected)) {
			failures.push("select() must return an array");
			return;
		}

		if (!selected.some((input) => input.id === "note-1")) {
			failures.push("select() must include compatible inputs");
		}

		if (selected.some((input) => input.id === "note-missing-key")) {
			failures.push("select() must not include inputs without a usable key");
		}
	} catch (error) {
		failures.push(`select() threw: ${String(error)}`);
	}
}

function validateDiagnostics(result: EnrichmentResult, failures: string[]): void {
	const total = result.records.length;
	const enriched = result.records.filter((record) => record.changes.length > 0 && !record.skipped).length;
	const skippedRecords = result.records.filter((record) => record.skipped);
	const skipped = skippedRecords.length;
	const byCode: Partial<Record<EnrichmentErrorCode, number>> = {};

	for (const record of skippedRecords) {
		const code = record.skipped?.code;
		if (!code) continue;
		byCode[code] = (byCode[code] ?? 0) + 1;
	}

	if (result.diagnostics.total !== total) {
		failures.push("diagnostics.total must equal records.length");
	}

	if (result.diagnostics.enriched !== enriched) {
		failures.push("diagnostics.enriched must equal records with changes");
	}

	if (result.diagnostics.skipped !== skipped) {
		failures.push("diagnostics.skipped must equal skipped records");
	}

	for (const [code, count] of Object.entries(byCode)) {
		if (result.diagnostics.byCode[code as EnrichmentErrorCode] !== count) {
			failures.push(`diagnostics.byCode.${code} must equal skipped records for that code`);
		}
	}
}

function validateProvenance(change: EnrichmentChange, failures: string[]): void {
	if (!change.field || change.field.trim().length === 0) {
		failures.push("changes[].field must be a non-empty string");
	}

	if (!change.provenance.providerId || change.provenance.providerId.trim().length === 0) {
		failures.push("change provenance must include providerId");
	}

	if (!change.provenance.key || change.provenance.key.trim().length === 0) {
		failures.push("change provenance must include key");
	}

	if (!change.provenance.hash || change.provenance.hash.trim().length === 0) {
		failures.push("change provenance must include hash");
	}

	if (Number.isNaN(Date.parse(change.provenance.at))) {
		failures.push("change provenance at must be an ISO-compatible timestamp");
	}
}

function validateRecord(record: EnrichmentRecordResult, failures: string[]): void {
	if (!record.id || record.id.trim().length === 0) {
		failures.push("records[].id must be a non-empty string");
	}

	if (!Array.isArray(record.changes)) {
		failures.push("records[].changes must be an array");
		return;
	}

	if (record.skipped && record.changes.length > 0) {
		failures.push("skipped records must not include changes");
	}

	for (const change of record.changes) {
		validateProvenance(change, failures);
	}
}

function normalizeChanges(result: EnrichmentResult): unknown {
	return result.records.map((record) => ({
		id: record.id,
		changes: record.changes,
		skipped: record.skipped,
	}));
}

export async function runEnrichmentV1Conformance(
	provider: EnrichmentProvider,
	sampleInputs: EnrichmentInput[] = SAMPLE_INPUTS,
): Promise<EnrichmentConformanceResult> {
	const failures: string[] = [];

	if (provider.capability !== ENRICHMENT_CAPABILITY) {
		failures.push("provider.capability must be 'enrichment:v1'");
	}

	if (!provider.pluginId || provider.pluginId.trim().length === 0) {
		failures.push("provider.pluginId must be a non-empty string");
	}

	assertDescription(provider, failures);
	assertSelected(provider, failures);

	let dryRun: EnrichmentResult | undefined;
	let applied: EnrichmentResult | undefined;

	try {
		dryRun = await provider.enrich(sampleInputs, { mode: "dry-run" });
		if (dryRun.mode !== "dry-run") {
			failures.push("enrich(..., dry-run).mode must be 'dry-run'");
		}
		for (const record of dryRun.records) {
			validateRecord(record, failures);
		}
		validateDiagnostics(dryRun, failures);
	} catch (error) {
		failures.push(`enrich(dry-run) threw: ${String(error)}`);
	}

	try {
		applied = await provider.enrich(sampleInputs, { mode: "apply" });
		if (applied.mode !== "apply") {
			failures.push("enrich(..., apply).mode must be 'apply'");
		}
		for (const record of applied.records) {
			validateRecord(record, failures);
		}
		validateDiagnostics(applied, failures);
	} catch (error) {
		failures.push(`enrich(apply) threw: ${String(error)}`);
	}

	if (dryRun && applied) {
		if (JSON.stringify(normalizeChanges(dryRun)) !== JSON.stringify(normalizeChanges(applied))) {
			failures.push("dry-run and apply must produce identical changes for identical inputs");
		}

		if (!dryRun.records.some((record) => record.skipped?.code === "NO_KEY")) {
			failures.push("conformance inputs without a key must be skipped with NO_KEY");
		}

		if (!dryRun.records.some((record) => record.skipped?.code === "NO_MATCH")) {
			failures.push("conformance unmatched inputs must be skipped with NO_MATCH");
		}
	}

	const failed = failures.length;
	return {
		pass: failed === 0,
		total: 10,
		failed,
		failures,
	};
}
