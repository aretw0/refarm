import YAML from "yaml";

import { computeRecordContentHash } from "./reference.js";
import {
	CURRENT_RECORD_SCHEMA_VERSION,
	type KnowledgeRecord,
} from "./types.js";

export const RECORDS_YAML_LD_MEDIA_TYPE = "application/yaml+ld;profile=records:v1" as const;

export interface RecordsYamlLdPropertyKeyMap {
	id?: string;
	schemaVersion?: string;
	context?: string;
	type?: string;
	fields?: string;
	sections?: string;
	relations?: string;
	attachments?: string;
	sourceRefs?: string;
	contentHash?: string;
	review?: string;
}

export interface RecordsYamlLdCodecOptions {
	propertyKeyMap?: RecordsYamlLdPropertyKeyMap;
	fieldKeyMap?: Record<string, string>;
	recomputeContentHash?: boolean;
}

export interface RecordsYamlLdFrontMatterResult {
	record: KnowledgeRecord;
	frontMatter: string;
	body: string;
}

const DEFAULT_PROPERTY_KEY_MAP = {
	id: "id",
	schemaVersion: "schemaVersion",
	context: "@context",
	type: "@type",
	fields: "fields",
	sections: "sections",
	relations: "relations",
	attachments: "attachments",
	sourceRefs: "sourceRefs",
	contentHash: "contentHash",
	review: "review",
} satisfies Required<RecordsYamlLdPropertyKeyMap>;

const RESERVED_RECORD_KEYS = new Set(Object.values(DEFAULT_PROPERTY_KEY_MAP));

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function propertyKeyMap(options: RecordsYamlLdCodecOptions): Required<RecordsYamlLdPropertyKeyMap> {
	return {
		...DEFAULT_PROPERTY_KEY_MAP,
		...options.propertyKeyMap,
	};
}

function valueAt(input: Record<string, unknown>, key: string): unknown {
	return input[key];
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function integerValue(value: unknown, fallback: number): number {
	return Number.isInteger(value) ? value as number : fallback;
}

function plainObjectValue(value: unknown): Record<string, unknown> {
	return isPlainObject(value) ? { ...value } : {};
}

function mappedReservedKeys(map: Required<RecordsYamlLdPropertyKeyMap>): Set<string> {
	return new Set([...RESERVED_RECORD_KEYS, ...Object.values(map)]);
}

function applyFieldKeyMap(
	input: Record<string, unknown>,
	fields: Record<string, unknown>,
	fieldKeyMap: Record<string, string> | undefined,
): Record<string, unknown> {
	if (!fieldKeyMap) return fields;
	const output = { ...fields };
	for (const [yamlKey, fieldKey] of Object.entries(fieldKeyMap)) {
		if (Object.hasOwn(input, yamlKey)) {
			output[fieldKey] = input[yamlKey];
		}
	}
	return output;
}

function unknownRecordFields(
	input: Record<string, unknown>,
	map: Required<RecordsYamlLdPropertyKeyMap>,
	fieldKeyMap: Record<string, string> | undefined,
): Record<string, unknown> {
	const reserved = mappedReservedKeys(map);
	for (const key of Object.keys(fieldKeyMap ?? {})) {
		reserved.add(key);
	}

	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (!reserved.has(key)) {
			output[key] = value;
		}
	}
	return output;
}

function yamlToPlainObject(yamlText: string): Record<string, unknown> {
	const parsed = YAML.parse(yamlText);
	if (!isPlainObject(parsed)) {
		throw new TypeError("records:v1 YAML-LD must parse to an object");
	}
	return parsed;
}

export function recordFromYamlLdObject(
	input: Record<string, unknown>,
	options: RecordsYamlLdCodecOptions = {},
): KnowledgeRecord {
	const map = propertyKeyMap(options);
	const fields = applyFieldKeyMap(
		input,
		plainObjectValue(valueAt(input, map.fields)),
		options.fieldKeyMap,
	);
	const record: KnowledgeRecord = {
		...unknownRecordFields(input, map, options.fieldKeyMap),
		id: stringValue(valueAt(input, map.id), "record:yaml-ld"),
		schemaVersion: integerValue(valueAt(input, map.schemaVersion), CURRENT_RECORD_SCHEMA_VERSION),
		fields,
		contentHash: stringValue(valueAt(input, map.contentHash), ""),
	};

	const context = valueAt(input, map.context);
	if (context !== undefined) record["@context"] = context as KnowledgeRecord["@context"];
	const type = valueAt(input, map.type);
	if (type !== undefined) record["@type"] = type as KnowledgeRecord["@type"];
	const sections = valueAt(input, map.sections);
	if (sections !== undefined) record.sections = sections as KnowledgeRecord["sections"];
	const relations = valueAt(input, map.relations);
	if (relations !== undefined) record.relations = relations as KnowledgeRecord["relations"];
	const attachments = valueAt(input, map.attachments);
	if (attachments !== undefined) record.attachments = attachments as KnowledgeRecord["attachments"];
	const sourceRefs = valueAt(input, map.sourceRefs);
	if (sourceRefs !== undefined) record.sourceRefs = sourceRefs as KnowledgeRecord["sourceRefs"];
	const review = valueAt(input, map.review);
	if (review !== undefined) record.review = review as KnowledgeRecord["review"];

	if (options.recomputeContentHash ?? (record.contentHash.length === 0)) {
		record.contentHash = computeRecordContentHash(record);
	}

	return record;
}

export function recordToYamlLdObject(
	record: KnowledgeRecord,
	options: Pick<RecordsYamlLdCodecOptions, "propertyKeyMap"> = {},
): Record<string, unknown> {
	const map = propertyKeyMap(options);
	const output: Record<string, unknown> = {};
	const reserved = mappedReservedKeys(map);

	for (const [key, value] of Object.entries(record)) {
		if (!reserved.has(key) && key !== "@context" && key !== "@type") {
			output[key] = value;
		}
	}

	output[map.id] = record.id;
	output[map.schemaVersion] = record.schemaVersion;
	if (record["@context"] !== undefined) output[map.context] = record["@context"];
	if (record["@type"] !== undefined) output[map.type] = record["@type"];
	output[map.fields] = record.fields;
	if (record.sections !== undefined) output[map.sections] = record.sections;
	if (record.relations !== undefined) output[map.relations] = record.relations;
	if (record.attachments !== undefined) output[map.attachments] = record.attachments;
	if (record.sourceRefs !== undefined) output[map.sourceRefs] = record.sourceRefs;
	output[map.contentHash] = record.contentHash;
	if (record.review !== undefined) output[map.review] = record.review;

	return output;
}

export function parseRecordsYamlLd(
	yamlText: string,
	options: RecordsYamlLdCodecOptions = {},
): KnowledgeRecord {
	return recordFromYamlLdObject(yamlToPlainObject(yamlText), options);
}

export function stringifyRecordsYamlLd(
	record: KnowledgeRecord,
	options: Pick<RecordsYamlLdCodecOptions, "propertyKeyMap"> = {},
): string {
	return YAML.stringify(recordToYamlLdObject(record, options), {
		lineWidth: 0,
		sortMapEntries: true,
	});
}

export function parseRecordsYamlLdFrontMatter(
	markdown: string,
	options: RecordsYamlLdCodecOptions = {},
): RecordsYamlLdFrontMatterResult {
	const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?([\s\S]*)$/u.exec(markdown);
	if (!match) {
		throw new TypeError("records:v1 YAML-LD front matter must start with a YAML front matter block");
	}

	const [, frontMatter = "", body = ""] = match;
	return {
		record: parseRecordsYamlLd(frontMatter, options),
		frontMatter,
		body,
	};
}

export function stringifyRecordsYamlLdFrontMatter(
	record: KnowledgeRecord,
	body = "",
	options: Pick<RecordsYamlLdCodecOptions, "propertyKeyMap"> = {},
): string {
	return `---\n${stringifyRecordsYamlLd(record, options)}---\n${body}`;
}
