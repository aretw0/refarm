import {
	CURRENT_RECORD_SCHEMA_VERSION,
	RECORDS_CAPABILITY,
	RECORDS_MANIFEST_VERSION,
	type KnowledgeRecord,
	type RecordAttachment,
	type RecordRelation,
	type RecordReview,
	type RecordSection,
	type RecordsManifest,
	type RecordsProvider,
	type RecordsValidationFailure,
	type RecordsValidationResult,
} from "./types.js";

export interface ReferenceRecordsProviderOptions {
	pluginId?: string;
	validateContentHash?: boolean;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
			left.localeCompare(right),
		);
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
	}

	return JSON.stringify(value);
}

function stableHash(value: unknown): string {
	const text = stableStringify(value);
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function recordHashInput(record: KnowledgeRecord): Record<string, unknown> {
	const { contentHash: _contentHash, ...rest } = record;
	return rest;
}

export function computeRecordContentHash(record: KnowledgeRecord): string {
	return stableHash(recordHashInput(record));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function requireString(
	value: unknown,
	failures: RecordsValidationFailure[],
	message: string,
	id?: string,
	path?: string,
): void {
	if (typeof value !== "string" || value.trim().length === 0) {
		failures.push({ id, message, path });
	}
}

function validateSections(
	record: KnowledgeRecord,
	failures: RecordsValidationFailure[],
): void {
	if (record.sections === undefined) return;
	if (!Array.isArray(record.sections)) {
		failures.push({
			id: record.id,
			message: "sections must be an array when provided",
			path: "$.sections",
		});
		return;
	}

	record.sections.forEach((section: RecordSection, index) => {
		requireString(section.key, failures, "section.key must be a non-empty string", record.id, `$.sections[${index}].key`);
		if (typeof section.content !== "string") {
			failures.push({
				id: record.id,
				message: "section.content must be a string",
				path: `$.sections[${index}].content`,
			});
		}
		if (section.attrs !== undefined && !isPlainObject(section.attrs)) {
			failures.push({
				id: record.id,
				message: "section.attrs must be an object when provided",
				path: `$.sections[${index}].attrs`,
			});
		}
	});
}

function validateRelations(
	record: KnowledgeRecord,
	recordIds: Set<string>,
	failures: RecordsValidationFailure[],
): void {
	if (record.relations === undefined) return;
	if (!Array.isArray(record.relations)) {
		failures.push({
			id: record.id,
			message: "relations must be an array when provided",
			path: "$.relations",
		});
		return;
	}

	record.relations.forEach((relation: RecordRelation, index) => {
		requireString(relation.type, failures, "relation.type must be a non-empty string", record.id, `$.relations[${index}].type`);
		requireString(relation.target, failures, "relation.target must be a non-empty string", record.id, `$.relations[${index}].target`);
		if (typeof relation.target === "string" && !recordIds.has(relation.target)) {
			failures.push({
				id: record.id,
				message: `relation target does not exist: ${relation.target}`,
				path: `$.relations[${index}].target`,
			});
		}
		if (relation.attrs !== undefined && !isPlainObject(relation.attrs)) {
			failures.push({
				id: record.id,
				message: "relation.attrs must be an object when provided",
				path: `$.relations[${index}].attrs`,
			});
		}
	});
}

function validateAttachments(
	record: KnowledgeRecord,
	failures: RecordsValidationFailure[],
): void {
	if (record.attachments === undefined) return;
	if (!Array.isArray(record.attachments)) {
		failures.push({
			id: record.id,
			message: "attachments must be an array when provided",
			path: "$.attachments",
		});
		return;
	}

	record.attachments.forEach((attachment: RecordAttachment, index) => {
		requireString(attachment.id, failures, "attachment.id must be a non-empty string", record.id, `$.attachments[${index}].id`);
		requireString(attachment.ref, failures, "attachment.ref must be a non-empty string", record.id, `$.attachments[${index}].ref`);
		if (attachment.mediaType !== undefined && typeof attachment.mediaType !== "string") {
			failures.push({
				id: record.id,
				message: "attachment.mediaType must be a string when provided",
				path: `$.attachments[${index}].mediaType`,
			});
		}
		if (attachment.hash !== undefined && typeof attachment.hash !== "string") {
			failures.push({
				id: record.id,
				message: "attachment.hash must be a string when provided",
				path: `$.attachments[${index}].hash`,
			});
		}
	});
}

function validateReview(record: KnowledgeRecord, failures: RecordsValidationFailure[]): void {
	if (record.review === undefined) return;
	const review = record.review as RecordReview;
	if (!isPlainObject(review)) {
		failures.push({ id: record.id, message: "review must be an object when provided", path: "$.review" });
		return;
	}
	requireString(review.state, failures, "review.state must be a non-empty string", record.id, "$.review.state");
	if (review.at !== undefined && Number.isNaN(Date.parse(review.at))) {
		failures.push({ id: record.id, message: "review.at must be an ISO-compatible timestamp", path: "$.review.at" });
	}
}

function validateRecord(
	record: KnowledgeRecord,
	recordIds: Set<string>,
	failures: RecordsValidationFailure[],
	validateContentHash: boolean,
): void {
	requireString(record.id, failures, "record.id must be a non-empty string", record.id, "$.id");
	if (!Number.isInteger(record.schemaVersion) || record.schemaVersion < 1) {
		failures.push({ id: record.id, message: "schemaVersion must be a positive integer", path: "$.schemaVersion" });
	}
	if (!isPlainObject(record.fields)) {
		failures.push({ id: record.id, message: "fields must be an object", path: "$.fields" });
	}
	requireString(record.contentHash, failures, "contentHash must be a non-empty string", record.id, "$.contentHash");

	if (record["@type"] !== undefined && typeof record["@type"] !== "string" && !isStringArray(record["@type"])) {
		failures.push({ id: record.id, message: "@type must be a string or string array", path: "$.@type" });
	}

	if (
		record["@context"] !== undefined &&
		typeof record["@context"] !== "string" &&
		!isPlainObject(record["@context"])
	) {
		failures.push({ id: record.id, message: "@context must be a string or object", path: "$.@context" });
	}

	if (record.sourceRefs !== undefined && !isStringArray(record.sourceRefs)) {
		failures.push({ id: record.id, message: "sourceRefs must be a string array when provided", path: "$.sourceRefs" });
	}

	validateSections(record, failures);
	validateRelations(record, recordIds, failures);
	validateAttachments(record, failures);
	validateReview(record, failures);

	if (validateContentHash && record.contentHash !== computeRecordContentHash(record)) {
		failures.push({ id: record.id, message: "contentHash must match canonical record content", path: "$.contentHash" });
	}
}

export function createReferenceRecordsFixture(): RecordsManifest {
	const baseRecords: KnowledgeRecord[] = [
		{
			id: "record:requirements-root",
			schemaVersion: CURRENT_RECORD_SCHEMA_VERSION,
			"@type": ["KnowledgeRecord", "Requirement"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: {
				title: "Requirements root",
				status: "draft",
			},
			sections: [
				{
					key: "description",
					content: "A sanitized requirement-like root record.",
				},
			],
			sourceRefs: ["source:v1:local:/requirements/root.md"],
			review: {
				state: "draft",
				at: "2026-06-30T00:00:00.000Z",
			},
			"future:preserved": { enabled: true },
			contentHash: "",
		},
		{
			id: "record:requirements-child",
			schemaVersion: CURRENT_RECORD_SCHEMA_VERSION,
			"@type": ["KnowledgeRecord", "Requirement"],
			fields: {
				title: "Requirements child",
				status: "reviewed",
			},
			sections: [
				{
					key: "acceptance",
					content: "- Must preserve unknown fields.",
				},
			],
			relations: [
				{
					type: "dependsOn",
					target: "record:requirements-root",
					attrs: { strength: "strong" },
				},
			],
			attachments: [
				{
					id: "attachment:source-snapshot",
					ref: "artifact:requirements-source-snapshot",
					mediaType: "application/json",
					hash: "sha256:fixture",
				},
			],
			sourceRefs: ["source:v1:local:/requirements/child.md"],
			review: {
				state: "reviewed",
				at: "2026-06-30T00:00:00.000Z",
			},
			contentHash: "",
		},
	];

	const records = baseRecords.map((record) => ({
		...record,
		contentHash: computeRecordContentHash({ ...record, contentHash: "" }),
	}));

	return {
		manifestVersion: RECORDS_MANIFEST_VERSION,
		records,
	};
}

export function createReferenceRecordsProvider(
	options: ReferenceRecordsProviderOptions = {},
): RecordsProvider {
	const pluginId = options.pluginId ?? "@refarm.dev/records-reference";
	const validateContentHash = options.validateContentHash ?? true;

	return {
		pluginId,
		capability: RECORDS_CAPABILITY,
		validate(manifest: RecordsManifest): RecordsValidationResult {
			const failures: RecordsValidationFailure[] = [];

			if (!manifest || typeof manifest !== "object") {
				return {
					ok: false,
					failures: [{ message: "manifest must be an object", path: "$" }],
				};
			}

			if (manifest.manifestVersion !== RECORDS_MANIFEST_VERSION) {
				failures.push({ message: "manifestVersion must be 1", path: "$.manifestVersion" });
			}

			if (!Array.isArray(manifest.records)) {
				return {
					ok: false,
					failures: [...failures, { message: "records must be an array", path: "$.records" }],
				};
			}

			const seen = new Set<string>();
			const recordIds = new Set<string>();
			for (const record of manifest.records) {
				if (typeof record.id === "string") {
					if (seen.has(record.id)) {
						failures.push({ id: record.id, message: `duplicate record id: ${record.id}`, path: "$.records" });
					}
					seen.add(record.id);
					recordIds.add(record.id);
				}
			}

			for (const record of manifest.records) {
				validateRecord(record, recordIds, failures, validateContentHash);
			}

			return {
				ok: failures.length === 0,
				failures,
			};
		},
		upcast(record: KnowledgeRecord): KnowledgeRecord {
			if (record.schemaVersion >= CURRENT_RECORD_SCHEMA_VERSION) {
				return { ...record };
			}

			return {
				...record,
				schemaVersion: CURRENT_RECORD_SCHEMA_VERSION,
				fields: isPlainObject(record.fields) ? { ...record.fields } : {},
			};
		},
	};
}
