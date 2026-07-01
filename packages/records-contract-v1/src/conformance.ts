import {
	computeRecordContentHash,
	createReferenceRecordsFixture,
} from "./reference.js";
import {
	CURRENT_RECORD_SCHEMA_VERSION,
	RECORDS_CAPABILITY,
	type KnowledgeRecord,
	type RecordsConformanceResult,
	type RecordsManifest,
	type RecordsProvider,
} from "./types.js";

function cloneManifest(manifest: RecordsManifest): RecordsManifest {
	return JSON.parse(JSON.stringify(manifest)) as RecordsManifest;
}

function fixtureWithDanglingRelation(): RecordsManifest {
	const fixture = cloneManifest(createReferenceRecordsFixture());
	const child = fixture.records.find((record) => record.id === "record:requirements-child");
	if (child?.relations?.[0]) {
		child.relations[0] = {
			...child.relations[0],
			target: "record:missing",
		};
		child.contentHash = computeRecordContentHash(child);
	}
	return fixture;
}

function olderRecordWithUnknownFields(): KnowledgeRecord {
	const record = createReferenceRecordsFixture().records[0];
	if (!record) {
		throw new Error("reference fixture must include at least one record");
	}

	return {
		...record,
		schemaVersion: 0,
		"future:unknown": {
			nested: true,
		},
	};
}

export async function runRecordsV1Conformance(
	provider: RecordsProvider,
	sampleManifest: RecordsManifest = createReferenceRecordsFixture(),
): Promise<RecordsConformanceResult> {
	const failures: string[] = [];

	if (provider.capability !== RECORDS_CAPABILITY) {
		failures.push("provider.capability must be 'records:v1'");
	}

	if (!provider.pluginId || provider.pluginId.trim().length === 0) {
		failures.push("provider.pluginId must be a non-empty string");
	}

	try {
		const result = provider.validate(sampleManifest);
		if (!result.ok) {
			failures.push(`valid fixture must pass validation: ${result.failures.map((item) => item.message).join("; ")}`);
		}
	} catch (error) {
		failures.push(`validate(valid fixture) threw: ${String(error)}`);
	}

	try {
		const result = provider.validate(fixtureWithDanglingRelation());
		if (result.ok) {
			failures.push("dangling relation targets must fail validation");
		}
		if (!result.failures.some((failure) => failure.message.includes("relation target does not exist"))) {
			failures.push("dangling relation failures must identify the missing target");
		}
	} catch (error) {
		failures.push(`validate(dangling relation fixture) threw: ${String(error)}`);
	}

	try {
		const record = sampleManifest.records[0];
		if (!record) {
			failures.push("sample manifest must include at least one record");
		} else {
			const firstHash = computeRecordContentHash(record);
			const secondHash = computeRecordContentHash(JSON.parse(JSON.stringify(record)) as KnowledgeRecord);
			if (firstHash !== secondHash) {
				failures.push("content hash must be stable for canonical content");
			}
		}
	} catch (error) {
		failures.push(`content hash check threw: ${String(error)}`);
	}

	try {
		const older = olderRecordWithUnknownFields();
		const upcast = provider.upcast(older);
		if (upcast.schemaVersion !== CURRENT_RECORD_SCHEMA_VERSION) {
			failures.push("upcast() must raise older records to the current schema version");
		}
		if (JSON.stringify(upcast["future:unknown"]) !== JSON.stringify(older["future:unknown"])) {
			failures.push("upcast() must preserve unknown fields");
		}
		if (upcast.id !== older.id || upcast.contentHash !== older.contentHash) {
			failures.push("upcast() must preserve record identity and contentHash");
		}
	} catch (error) {
		failures.push(`upcast() threw: ${String(error)}`);
	}

	const failed = failures.length;
	return {
		pass: failed === 0,
		total: 8,
		failed,
		failures,
	};
}
