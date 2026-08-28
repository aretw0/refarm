import YAML from "yaml";

import {
	CURRENT_RECORD_SCHEMA_VERSION,
	RECORDS_MANIFEST_VERSION,
	computeRecordContentHash,
	createReferenceRecordsProvider,
	type KnowledgeRecord,
	type RecordRelation,
	type RecordsValidationResult,
} from "@refarm.dev/records-contract-v1";

export interface FrontmatterParseResult {
	data: Record<string, unknown>;
	body: string;
	frontmatter: string | null;
}

export interface WikiLink {
	raw: string;
	target: string;
	label?: string;
}

export interface MarkdownLink {
	raw: string;
	target: string;
	label: string;
	title?: string;
}

export interface ContentProjectionItem {
	path: string;
	text: string;
	id?: string;
	sourceRef?: string;
	mediaType?: "text/markdown" | "text/mdx" | string;
}

export interface ContentProjectionConfig {
	context?: KnowledgeRecord["@context"];
	defaultType?: KnowledgeRecord["@type"];
	folderTypes?: Record<string, KnowledgeRecord["@type"]>;
	fieldMap?: Record<string, string>;
	includeFrontmatterKeys?: string[];
	relationType?: string;
	reviewState?: string;
	idPrefix?: string;
}

export interface ProjectedContentRecord extends KnowledgeRecord {
	"content-projection:path": string;
	"content-projection:mediaType": string;
	"content-projection:externalLinks"?: MarkdownLink[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?([\s\S]*)$/u;
const WIKILINK_RE = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/gu;
const MARKDOWN_LINK_RE = /(?<!!)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/gu;
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/iu;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slugify(value: string): string {
	return value
		.trim()
		.replace(/\\/gu, "/")
		.replace(/\.[^.\/]+$/u, "")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9/]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.replace(/\/-+|-+\//gu, "/")
		.replace(/\/+/gu, "/");
}

function inferMediaType(path: string): string {
	return path.toLowerCase().endsWith(".mdx") ? "text/mdx" : "text/markdown";
}

function normalizePath(path: string): string {
	return path.replace(/\\/gu, "/").replace(/^\/+/u, "");
}

function stripFragment(target: string): string {
	return target.split("#", 1)[0] ?? target;
}

function decodeTarget(target: string): string {
	try {
		return decodeURIComponent(target);
	} catch {
		return target;
	}
}

function isExternalTarget(target: string): boolean {
	return URL_SCHEME_RE.test(target);
}

function localLinkCandidates(target: string): string[] {
	const decoded = decodeTarget(stripFragment(target.trim()));
	const normalized = normalizePath(decoded.replace(/^\.\//u, ""));
	const withoutExtension = normalized.replace(/\.[^.\/]+$/u, "");
	return [...new Set([target, decoded, normalized, withoutExtension, slugify(withoutExtension)])];
}

function recordIdFor(item: ContentProjectionItem, config: ContentProjectionConfig): string {
	if (item.id) return item.id;
	const prefix = config.idPrefix ?? "record:content:";
	return `${prefix}${slugify(item.path)}`;
}

function titleFromPath(path: string): string {
	const fileName = normalizePath(path).split("/").at(-1) ?? path;
	return fileName
		.replace(/\.[^.]+$/u, "")
		.replace(/[-_]+/gu, " ")
		.trim();
}

function folderTypeFor(path: string, config: ContentProjectionConfig): KnowledgeRecord["@type"] {
	const normalized = normalizePath(path);
	const entries = Object.entries(config.folderTypes ?? {}).sort(
		([left], [right]) => right.length - left.length,
	);
	for (const [folder, type] of entries) {
		const normalizedFolder = normalizePath(folder).replace(/\/$/u, "");
		if (normalized === normalizedFolder || normalized.startsWith(`${normalizedFolder}/`)) {
			return type;
		}
	}
	return config.defaultType ?? ["KnowledgeRecord", "Content"];
}

function fieldsFromFrontmatter(
	data: Record<string, unknown>,
	config: ContentProjectionConfig,
): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	const keys = config.includeFrontmatterKeys ?? Object.keys(data);
	for (const key of keys) {
		if (!Object.hasOwn(data, key)) continue;
		fields[config.fieldMap?.[key] ?? key] = data[key];
	}
	return fields;
}

function uniqueRelationsByTarget(relations: RecordRelation[]): RecordRelation[] {
	const seen = new Set<string>();
	return relations.filter((relation) => {
		if (seen.has(relation.target)) return false;
		seen.add(relation.target);
		return true;
	});
}

export function parseFrontmatter(text: string): FrontmatterParseResult {
	const match = FRONTMATTER_RE.exec(text);
	if (!match) {
		return { data: {}, body: text, frontmatter: null };
	}

	const frontmatter = match[1] ?? "";
	// Unparseable frontmatter degrades to empty data rather than throwing: the
	// line below already returns `{}` for YAML that parses to a non-object, and
	// a parse error is the same kind of "no usable data" for a caller. Throwing
	// here would take a whole vault down for one malformed file, and the raw
	// text stays in `frontmatter` for callers that want to inspect it.
	let parsed: unknown;
	try {
		parsed = YAML.parse(frontmatter);
	} catch {
		parsed = undefined;
	}
	return {
		data: isPlainObject(parsed) ? parsed : {},
		body: match[2] ?? "",
		frontmatter,
	};
}

export function extractWikilinks(body: string): WikiLink[] {
	return [...body.matchAll(WIKILINK_RE)]
		.map((match) => ({
			raw: match[0],
			target: match[1]?.trim() ?? "",
			...(match[2] ? { label: match[2].trim() } : {}),
		}))
		.filter((link) => link.target.length > 0);
}

export function extractMarkdownLinks(body: string): MarkdownLink[] {
	return [...body.matchAll(MARKDOWN_LINK_RE)]
		.map((match) => ({
			raw: match[0],
			label: match[1]?.trim() ?? "",
			target: match[2]?.trim() ?? "",
			...(match[3] ? { title: match[3].trim() } : {}),
		}))
		.filter((link) => link.label.length > 0 && link.target.length > 0);
}

export function extractExternalMarkdownLinks(body: string): MarkdownLink[] {
	return extractMarkdownLinks(body).filter((link) => isExternalTarget(link.target));
}

export function buildContentIdIndex(
	items: ContentProjectionItem[],
	config: Pick<ContentProjectionConfig, "idPrefix"> = {},
): Map<string, string> {
	const index = new Map<string, string>();
	for (const item of items) {
		const id = recordIdFor(item, config);
		const parsed = parseFrontmatter(item.text);
		const title =
			typeof parsed.data.title === "string" ? parsed.data.title : titleFromPath(item.path);
		const aliases = Array.isArray(parsed.data.aliases) ? parsed.data.aliases : [];
		for (const key of [
			item.id,
			item.path,
			normalizePath(item.path),
			normalizePath(item.path).replace(/\.[^.\/]+$/u, ""),
			title,
			slugify(title),
			...aliases.filter((alias): alias is string => typeof alias === "string"),
		]) {
			if (key && key.length > 0) index.set(key, id);
		}
	}
	return index;
}

export function resolveWikilinks(
	links: WikiLink[],
	index: ReadonlyMap<string, string>,
	options: { selfId?: string; relationType?: string } = {},
): RecordRelation[] {
	const relationType = options.relationType ?? "references";
	const seen = new Set<string>();
	const relations: RecordRelation[] = [];
	for (const link of links) {
		const target = index.get(link.target) ?? index.get(slugify(link.target));
		if (!target || target === options.selfId || seen.has(target)) continue;
		seen.add(target);
		relations.push({
			type: relationType,
			target,
			attrs: {
				raw: link.raw,
				label: link.label ?? link.target,
			},
		});
	}
	return relations;
}

export function resolveMarkdownLinks(
	links: MarkdownLink[],
	index: ReadonlyMap<string, string>,
	options: { selfId?: string; relationType?: string } = {},
): RecordRelation[] {
	const relationType = options.relationType ?? "references";
	const seen = new Set<string>();
	const relations: RecordRelation[] = [];
	for (const link of links) {
		if (isExternalTarget(link.target)) continue;
		const target = localLinkCandidates(link.target)
			.map((candidate) => index.get(candidate))
			.find((candidate) => candidate);
		if (!target || target === options.selfId || seen.has(target)) continue;
		seen.add(target);
		relations.push({
			type: relationType,
			target,
			attrs: {
				raw: link.raw,
				label: link.label,
				kind: "markdown-link",
				...(link.title ? { title: link.title } : {}),
			},
		});
	}
	return relations;
}

export function projectContentToRecords(
	items: ContentProjectionItem[],
	config: ContentProjectionConfig = {},
): ProjectedContentRecord[] {
	const index = buildContentIdIndex(items, config);
	return items.map((item) => {
		const parsed = parseFrontmatter(item.text);
		const markdownLinks = extractMarkdownLinks(parsed.body);
		const externalLinks = markdownLinks.filter((link) => isExternalTarget(link.target));
		const id = recordIdFor(item, config);
		const fields = {
			title: typeof parsed.data.title === "string" ? parsed.data.title : titleFromPath(item.path),
			...fieldsFromFrontmatter(parsed.data, config),
		};
		const record: ProjectedContentRecord = {
			id,
			schemaVersion: CURRENT_RECORD_SCHEMA_VERSION,
			"@type": folderTypeFor(item.path, config),
			...(config.context ? { "@context": config.context } : {}),
			fields,
			sections: [{ key: "body", content: parsed.body }],
			relations: uniqueRelationsByTarget([
				...resolveWikilinks(extractWikilinks(parsed.body), index, {
					selfId: id,
					relationType: config.relationType,
				}),
				...resolveMarkdownLinks(markdownLinks, index, {
					selfId: id,
					relationType: config.relationType,
				}),
			]),
			sourceRefs: [item.sourceRef ?? `source:v1:local:${normalizePath(item.path)}`],
			review: { state: config.reviewState ?? "draft" },
			"content-projection:path": normalizePath(item.path),
			"content-projection:mediaType": item.mediaType ?? inferMediaType(item.path),
			...(externalLinks.length > 0 ? { "content-projection:externalLinks": externalLinks } : {}),
			contentHash: "",
		};
		record.contentHash = computeRecordContentHash(record);
		return record;
	});
}

export function validateProjectedRecords(records: KnowledgeRecord[]): RecordsValidationResult {
	return createReferenceRecordsProvider({ validateContentHash: true }).validate({
		manifestVersion: RECORDS_MANIFEST_VERSION,
		records,
	});
}
