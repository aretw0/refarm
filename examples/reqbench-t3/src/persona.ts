import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	defineRecordsViewCapability,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type RecordsAnalyzeEnvelope,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import {
	createLocalRecordsCapabilityDeps,
	ingestSourceToRecords,
	type IngestSourceProvider,
	type SourceRecordParser,
} from "@refarm.dev/capability-host/node";
import {
	computeRecordContentHash,
	type KnowledgeRecord,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";
import { stampProvenance } from "@refarm.dev/provenance-contract-v1";
import {
	createReferenceVaultSurface,
	organizeRecords,
	planRecordFiles,
	recordToVaultNote,
	searchRecords,
	type OrganizeDispatcher,
	type RecordFilePlan,
	type SearchDispatcher,
	type VaultProfile,
} from "@refarm.dev/vault-contract-v1";
import { createReferenceVaultSurfaceComponent } from "@refarm.dev/vault-surface-ref";
import { graphFromRecords, graphToSvg, type GraphRecord } from "@refarm.dev/surveyor";
import {
	buildLabManifest,
	exportHashes,
	runNotebookExports,
	type LabCatalog,
	type NotebookExportResult,
	type ProcessExecutor,
} from "@refarm.dev/lab-contract-v1";
import {
	checkNotes,
	createNoteQualityChecker,
	type QualityProfile,
} from "@refarm.dev/quality-contract-v1";
import { createCapabilityWebSurfacePlugin } from "@refarm.dev/capability-homestead-surface";
import { createHash } from "node:crypto";
import {
	createRulesEnrichmentProvider,
	type EnrichmentRule,
} from "@refarm.dev/enrichment-contract-v1";
import {
	crawlSource,
	createWebSourceProvider,
	downloadAttachment,
	emptyCacheManifest,
	HttpFetchError,
	ensureAuthenticatedSession,
	fixtureLogin,
	loadWebSourceTargetsSync,
	normalizeCacheManifest,
	syncManifest,
	withReauth,
	type AttachmentResult,
	type BinaryFetchDriver,
	type CacheManifest,
	type CrawlSeed,
	type InteractiveLogin,
	type SyncReport,
	type WebFetchDriver,
	type WebSourceSessionEvidence,
} from "@refarm.dev/source-web";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	createOslcCrawlExtractor,
	createOslcFetchDriver,
	extractAttachmentRef,
	parseRequirementsFromRdf,
} from "./oslc.js";
import { reqManifest } from "./fixture.js";

/**
 * The T3 persona (result mode). reqbench presents the analyst's requirements bench as a
 * finished product: the analyst discovers a system, pulls, corrects, and reads a
 * navigable requirements MOC — never the neutral engine underneath.
 */

/** The analyst's OWN enrichment rules — domain patterns that tag a requirement when its
 * text mentions them. The engine is generic (@refarm.dev/enrichment-contract-v1); these
 * rules are the analyst's fiscal vocabulary. Swap them for yours. */
const REQ_ENRICHMENT_RULES: EnrichmentRule[] = [
	{
		id: "tag-cnpj",
		matchSource: ["body", "title"],
		matchPattern: /\bCNPJ\b/,
		outputTag: "req/cnpj",
	},
	{
		id: "tag-credito",
		matchSource: "body",
		matchPattern: /cr[ée]dito|ressarcimento|apura[çc][ãa]o/i,
		outputTag: "req/credito",
	},
	{
		id: "tag-integracao",
		matchSource: ["body", "section"],
		matchPattern: /integra[çc][ãa]o|layout|arquivo/i,
		outputTag: "req/integracao",
	},
];

/** The analyst's PARSER — turns a pulled system's HTML into requirement records. This is
 * the domain step of ingest: the generic mechanism (materialize → read → parse → hash) is
 * in @refarm.dev/capability-host; this knows THIS ALM's `<article>` shape. A different
 * analyst's system would ship a different parser. */
export const parseRequirementsFromHtml: SourceRecordParser = (body, context) => {
	const records: ReturnType<SourceRecordParser> = [];
	// Provenance is the same for every record pulled in this ingest — WHERE they came from.
	// Stamped generically via provenance:v1 (a refarm block), so the analyst's product is
	// auditable ("this requirement came from THIS system, at THIS time, fingerprinted").
	const contentSha256 = createHash("sha256").update(body).digest("hex");
	const collectedAt = new Date().toISOString();
	const re =
		/<article data-req="([^"]+)" data-type="([^"]+)" data-title="([^"]+)">([^<]*)<\/article>/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(body)) !== null) {
		const key = match[1] ?? "";
		const tipo = match[2] ?? "";
		const title = match[3] ?? "";
		const text = match[4] ?? "";
		records.push({
			id: `record:req-${key.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
			schemaVersion: 1,
			"@type": ["KnowledgeRecord", "Requirement"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: stampProvenance(
				{ title, tipo, status: "draft", externalKey: key, body: text },
				{
					channel: "requirements-pull",
					originLink: context.ref,
					sourcePath: context.location,
					...(context.mediaType ? { mediaType: context.mediaType } : {}),
					collectedAt,
					contentSha256,
				},
			),
			sections: [{ key: "conteudo", content: text }],
			sourceRefs: [context.ref],
			review: { state: "draft" },
		});
	}
	return records;
};

/** The path to the analyst's source-targets ledger — the systems they declared they can
 * access. Resolved next to the example (ships a sample EFD target); a real analyst edits it. */
function sourcesConfigPath(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	// dist/persona.js → ../.dgk/sources.json ; src/persona.ts → ../.dgk/sources.json
	return path.resolve(here, "..", ".dgk", "sources.json");
}

/** The records deps, backed by a mutable manifest and optional local state file so a
 * correction persists and shows up in the MOC. A real deployment backs this with the
 * vault. */
export interface RequirementsStateOptions {
	statePath?: string;
}

export interface RequirementsCapabilityOptions extends RequirementsStateOptions {
	cacheRoot?: string;
	/** Override the source-targets ledger path (tests point at a temp file). */
	sourcesConfigPath?: string;
	/** The HTTP impl the OSLC driver uses for a LIVE pull. Injected so a test drives it with a
	 * canned RDF response and a real deployment binds it to an authenticated browser/session.
	 * Absent = no live fetch wired (offline fixture replay, out-of-the-box). */
	fetchImpl?: typeof fetch;
	/** RE-AUTHENTICATE on a mid-pull 401 (an expired Jazz session): re-run the real browser login
	 * and return a FRESH cookie-carrying fetch impl to retry with — the way the vault recovers.
	 * Absent = a 401 is not recoverable. Only used when a live fetch is wired. */
	reauthenticate?: () => Promise<typeof fetch>;
}

/**
 * Turn a pulled system's body into requirement records. Dispatches on media type: a live OSLC
 * pull returns RDF/XML → the RDF parser; the offline fixture ships HTML → the HTML parser. The
 * records are identical either way, so the rest of the bench doesn't care where the body came
 * from. This is the analyst's domain parser — the substrate's ingest just calls it.
 */
export const parseRequirements: SourceRecordParser = (body, context) => {
	const isRdf =
		(context.mediaType ?? "").includes("rdf") ||
		/<(?:rdf:RDF|rdf:Description|oslc_rm:Requirement)\b/.test(body);
	return isRdf ? parseRequirementsFromRdf(body, context) : parseRequirementsFromHtml(body, context);
};

/** The analyst's source provider — reads their declared systems from the ledger, and (when a
 * fetch impl is provided) wires the OSLC driver so a `pull` retrieves the system LIVE over the
 * OSLC/RDF contract. Exposed so both the capability bundle and the ingest flow use the SAME
 * provider (materialize a pulled system, then parse it with `parseRequirements`). */
export function createRequirementsSourceProvider(options: RequirementsCapabilityOptions = {}) {
	const root = options.cacheRoot ?? mkdtempSync(path.join(os.tmpdir(), "reqbench-source-"));
	// The analyst's source systems come from THEIR ledger, not hardcoded here. `discover`
	// lists exactly what they declared (the sample ships EFD).
	const fixtures = loadWebSourceTargetsSync(options.sourcesConfigPath ?? sourcesConfigPath());
	// Egress allowlist = the hosts the analyst DECLARED (a live pull may only reach a system
	// they configured). Derived from the targets' URLs, so a declared ALM is allowed by
	// construction and nothing else is — the ledger is the authority, not a hardcoded host.
	const allowedHosts = declaredHostsFrom(fixtures);
	return createWebSourceProvider({
		cacheRoot: root,
		fixtures,
		...(allowedHosts.length ? { egress: { allowedHosts } } : {}),
		// The OSLC driver is the analyst's domain knowledge; the substrate just calls it when a
		// live pull happens (http target, not offline). No fetchImpl → offline fixture replay.
		// Wrapped with withReauth so an expired session mid-pull (Jazz 401) re-logs-in and
		// retries — the vault's recovery loop, generic in the substrate, login injected here.
		...(options.fetchImpl
			? { fetcher: liveOslcFetcher(options.fetchImpl, options.reauthenticate) }
			: {}),
	});
}

/**
 * The live fetcher: the OSLC driver, wrapped so a recoverable 401 re-authenticates and retries.
 * The vault answers an expired Jazz session with a 401 mid-pull; recovery must produce FRESH
 * COOKIES, not just fresh session evidence — so `reauthenticate` re-runs the real browser login
 * and returns a new cookie-carrying `fetchImpl`, which we swap in before retrying. Without a
 * `reauthenticate` (offline/tests), a 401 is not recoverable (it just propagates).
 */
export function liveOslcFetcher(fetchImpl: typeof fetch, reauthenticate?: () => Promise<typeof fetch>) {
	// A mutable fetch cell so re-auth can replace the cookies the OSLC driver uses.
	let current = fetchImpl;
	const oslc = createOslcFetchDriver({ fetchImpl: (input, init) => current(input, init) });
	if (!reauthenticate) return oslc;
	return withReauth(oslc, {
		reauth: async (failed) => {
			current = await reauthenticate(); // re-open the browser, capture fresh cookies
			return failed.session; // evidence unchanged; the cookies (in `current`) are what matter
		},
	});
}

/** The distinct http(s) hosts of the analyst's declared targets — the egress allowlist for a
 * live pull. A target with a non-http url (an offline capture) contributes no host. */
function declaredHostsFrom(fixtures: Record<string, { url: string }>): string[] {
	const hosts = new Set<string>();
	for (const { url } of Object.values(fixtures)) {
		try {
			const u = new URL(url);
			if (u.protocol === "http:" || u.protocol === "https:") hosts.add(u.hostname.toLowerCase());
		} catch {
			// non-URL declared body target → contributes no egress host
		}
	}
	return [...hosts];
}

// --- Whole-project crawl: walk a Jazz RM project and ingest EVERY requirement (block: crawl) ---

export interface CrawlRequirementsOptions {
	/** The authenticated OSLC fetch driver — offline tests inject a fixture site; a live run
	 * passes `liveOslcFetcher(fetchImpl, reauthenticate)` (cookies + OSLC contract + re-auth). */
	fetcher: WebFetchDriver;
	/** The seed URL(s) to start the crawl from — a project folder/dashboard root. */
	seeds: readonly CrawlSeed[];
	/** The session evidence (from login-garantido) to fetch under. */
	session: WebSourceSessionEvidence;
	/** The Configuration-Context (streamURI) carried onto every discovered request. */
	streamURI?: string;
	/** The ref the ingested records attribute to (their sourceRef). */
	ref: string;
	/** The accumulative cache manifest from the prior run (incremental sync). Default: empty. */
	priorManifest?: CacheManifest;
	/** BFS depth / page caps (bound an unbounded project tree). */
	maxDepth?: number;
	maxPages?: number;
	/** Polite pacing between fetches, ms. */
	pacingMs?: number;
	/** ISO timestamp stamped on synced cache entries (injected — no ambient clock). */
	syncedAt?: string;
	/** Progress hook — one call per fetched page. */
	onPage?: (url: string, depth: number) => void;
	/** OPTIONAL binary fetch driver — when present, an artifact that wraps a file (Jazz RM
	 * `wrappedResource`) has its attachment downloaded under the substrate's size/type policy,
	 * and the outcome (materialized hash+extension, or a skip reason) is recorded on the record.
	 * Absent → attachments are not fetched (text-only crawl). Injected so tests stay offline. */
	binaryFetcher?: BinaryFetchDriver;
	/** Max bytes to materialize an attachment (default from the substrate policy). */
	maxAttachmentBytes?: number;
}

export interface CrawlRequirementsResult {
	records: KnowledgeRecord[];
	/** The updated accumulative cache manifest — persist it for the next incremental run. */
	manifest: CacheManifest;
	/** The sync report: per-URI new|changed|unchanged decisions + aggregate counts. */
	sync: SyncReport;
	/** True if the crawl hit its page budget with links still unvisited. */
	truncated: boolean;
	/** How many distinct URLs the crawl saw. */
	seen: number;
	/** The attachments encountered on file artifacts (materialized or skipped placeholders). Empty
	 * when no binaryFetcher was injected. The caller persists the materialized bytes. */
	attachments: AttachmentResult[];
}

/**
 * Crawl a whole Jazz RM project and ingest every requirement — the "grosso da raspagem" the
 * single-resource pull can't do. This is the DOMAIN assembly of five generic substrate blocks:
 * `crawlSource` (BFS engine) drives the OSLC link extractor (`createOslcCrawlExtractor`, the
 * project's link graph), each artifact page is parsed with `parseRequirementsFromRdf`, and the
 * accumulative cache (`syncManifest`) classifies each artifact new|changed|unchanged so a
 * re-run only re-ingests what moved. The fetcher is injected, so an offline fixture drives the
 * whole flow in a test and a browser-backed OSLC fetch scrapes the real VPN system unchanged.
 *
 * Nothing here is a new mechanism — the crawl, the sync, the parse are all the substrate's; the
 * analyst supplies only the seeds, the OSLC extractor's URL heuristics, and the RDF parser.
 */
export async function crawlRequirements(
	options: CrawlRequirementsOptions,
): Promise<CrawlRequirementsResult> {
	const extractLinks = createOslcCrawlExtractor(
		options.streamURI ? { streamURI: options.streamURI } : {},
	);
	const crawl = await crawlSource(options.fetcher, options.seeds, {
		session: options.session,
		extractLinks,
		...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
		...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
		...(options.pacingMs !== undefined ? { pacingMs: options.pacingMs } : {}),
		...(options.onPage ? { onPage: (p): void => options.onPage!(p.url, p.depth) } : {}),
	});

	// Fold every fetched page into the accumulative cache (incremental sync), then parse only the
	// pages whose content is new or changed into requirement records. An unchanged artifact is
	// already ingested — re-parsing it would be wasted work (and is exactly what the cache buys).
	const sync = syncManifest(
		normalizeCacheManifest(options.priorManifest ?? emptyCacheManifest()),
		crawl.pages.map((page) => ({ uri: page.url, content: page.body })),
		options.syncedAt,
	);
	const changedByUri = new Map(sync.decisions.map((d) => [d.uri, d.status]));

	const records: KnowledgeRecord[] = [];
	const attachments: AttachmentResult[] = [];
	for (const page of crawl.pages) {
		if (changedByUri.get(page.url) === "unchanged") continue; // already ingested; skip re-parse
		const parsed = parseRequirementsFromRdf(page.body, {
			ref: options.ref,
			location: page.url,
			mediaType: page.mediaType,
		}) as KnowledgeRecord[];

		// A file artifact wraps a binary (Jazz RM wrappedResource). When a binary driver is wired,
		// download it under the substrate's size/type policy and stamp the outcome on the record so
		// the analyst's note links the attachment (materialized → hash+extension; skipped → reason).
		if (options.binaryFetcher) {
			const att = extractAttachmentRef(page.body);
			if (att) {
				const result = await downloadAttachment(att.wrappedResourceUri, {
					session: options.session,
					title: att.title ?? att.wrappedResourceUri,
					fetcher: options.binaryFetcher,
					...(options.maxAttachmentBytes !== undefined ? { maxBytes: options.maxAttachmentBytes } : {}),
				});
				attachments.push(result);
				for (const record of parsed) {
					record.fields.attachmentKind = result.kind;
					record.fields.attachmentExtension = result.extension;
					if (result.hash) record.fields.attachmentHash = result.hash;
					if (result.skipReason) record.fields.attachmentSkipReason = result.skipReason;
				}
			}
		}
		records.push(...parsed);
	}

	return {
		records,
		manifest: sync.manifest,
		sync,
		truncated: crawl.truncated,
		seen: crawl.seen,
		attachments,
	};
}

/**
 * Resolve the vault surface the bench routes with — the SOVEREIGN, zero-import WASM
 * component when it is built, else the pure-TS reference surface. The host/bundle picks
 * sovereignty ONCE here, so a verb just uses the injected surface (it never instantiates
 * or chooses one). This is the DX move: the example is agnostic to how routing is
 * sandboxed. Cached so the WASM component loads at most once.
 */
/** The surface the bench dispatches through — a reference/WASM surface whose `run` returns a full
 * result, so it satisfies BOTH the organize and search dispatchers (its result has `.plans` AND
 * `.hits`). A verb narrows to the dispatcher it needs; the surface serves any vault verb. */
type VaultDispatcher = OrganizeDispatcher & SearchDispatcher;

let cachedVaultSurface: Promise<VaultDispatcher> | undefined;
export function resolveVaultSurface(): Promise<VaultDispatcher> {
	cachedVaultSurface ??= (async (): Promise<VaultDispatcher> => {
		try {
			// The sovereign, zero-import WASM surface when its component is built. Its `run` returns
			// the full result (`.plans` AND `.hits`), so it satisfies every vault dispatcher — no
			// wrapper/cast — the DX point: the sovereign surface drops straight in.
			return await createReferenceVaultSurfaceComponent();
		} catch {
			// Not built (no pkg/) → the pure reference surface. Same contract, same routing;
			// only the sandbox boundary differs, and the bench doesn't care which it got.
			return createReferenceVaultSurface();
		}
	})();
	return cachedVaultSurface;
}

export function reqCapabilityBundle(options: RequirementsCapabilityOptions = {}) {
	// One provider shared by the source group (discover/pull) and the requirements-pull verb
	// (ingest), so both see the same declared systems + cache.
	const sourceProvider = createRequirementsSourceProvider(options);
	const bundle = createLocalRecordsCapabilityDeps({
		seed: reqManifest,
		statePath: options.statePath,
		// The analyst's rules + the generic engine: text mentioning CNPJ/crédito/… gets tagged.
		enrichmentProvider: createRulesEnrichmentProvider({
			rules: REQ_ENRICHMENT_RULES,
			tagField: "req.tags",
		}),
		source: { sourceProvider },
	});
	// The vault surface the organize verb routes with — resolved by the bundle (sovereign
	// WASM when built, else reference), so the verb never instantiates one.
	return { ...bundle, sourceProvider, vaultSurface: resolveVaultSurface };
}

const STATE_LABELS: Record<string, string> = {
	reviewed: "Requisitos revisados",
	draft: "Rascunhos a revisar",
	unreviewed: "Sem revisão",
};

/** Labels for the requirement TYPES (the default MOC grouping = field:tipo). */
const TYPE_LABELS: Record<string, string> = {
	"regra-de-negocio": "Regras de Negócio",
	"caso-de-uso": "Casos de Uso",
	funcional: "Requisitos Funcionais",
	"nao-funcional": "Requisitos Não Funcionais",
	"visao-solucao": "Visão da Solução",
	glossario: "Glossário",
	unspecified: "Sem tipo",
};

/** A group's human label — types when grouping by tipo, review states otherwise. */
function groupLabel(env: RecordsAnalyzeEnvelope, key: string, fallback: string): string {
	if (env.by === "field:tipo") return TYPE_LABELS[key] ?? key;
	return STATE_LABELS[key] ?? fallback;
}

/** Build id → { title, link } across every record in the envelope, so a relation can
 * render the TARGET's title (a navigable wikilink), the way the vault's MOC does. */
function recordIndex(env: RecordsAnalyzeEnvelope): Map<string, { title: string; link: string }> {
	const index = new Map<string, { title: string; link: string }>();
	for (const group of env.groups) {
		for (const record of group.records) {
			index.set(record.id, { title: record.title, link: record.link });
		}
	}
	return index;
}

function renderRequirementsMoc(env: RecordsAnalyzeEnvelope): string {
	const index = recordIndex(env);
	const lines: string[] = [
		"# Mapa de Conteúdo — Requisitos",
		"",
		`> ${env.summary.total} requisitos · ` +
			Object.entries(env.summary.byState)
				.map(([state, n]) => `${n} ${STATE_LABELS[state] ?? state}`)
				.join(" · "),
		"",
	];
	for (const group of env.groups) {
		lines.push(`## ${groupLabel(env, group.key, group.label)} (${group.count})`);
		for (const record of group.records) {
			lines.push(`- [[${record.link.replace(/\.md$/, "")}|${record.title}]]`);
			// The record's outgoing relations → nested navigable links (the graph).
			for (const rel of record.relations ?? []) {
				const target = index.get(rel.target);
				const label = target?.title ?? rel.target;
				const link = target?.link.replace(/\.md$/, "") ?? rel.target;
				lines.push(`  - ${rel.type} → [[${link}|${label}]]`);
			}
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd() + "\n";
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** The requirements MOC as NAVIGABLE web HTML — the T3 "TELAS importam mais" richness.
 * The MOC is markdown-with-wikilinks; dumping it raw renders `- [[link|title]]` literally.
 * So this projects the SAME structured groups/records into native <nav>/<ul><li><a> with
 * DS classes — a navigable map, no markdown parser. This is what the web bridge's content
 * seam turns into the panel body (above the launcher cards). */
export function renderRequirementsMocHtml(env: RecordsAnalyzeEnvelope): string {
	const summary =
		`${env.summary.total} requisitos · ` +
		Object.entries(env.summary.byState)
			.map(([state, n]) => `${n} ${STATE_LABELS[state] ?? state}`)
			.join(" · ");
	const index = recordIndex(env);
	const groups = env.groups
		.map((group) => {
			const items = group.records
				.map((record) => {
					const rels = (record.relations ?? [])
						.map((rel) => {
							const target = index.get(rel.target);
							const label = target?.title ?? rel.target;
							const link = target?.link ?? rel.target;
							return `<li data-relation="${escapeHtml(rel.type)}">${escapeHtml(rel.type)} → <a href="${escapeHtml(link)}" class="refarm-code">${escapeHtml(label)}</a></li>`;
						})
						.join("");
					const relList = rels ? `<ul class="refarm-muted-list">${rels}</ul>` : "";
					return `<li><a href="${escapeHtml(record.link)}" class="refarm-code">${escapeHtml(record.title)}</a>${relList}</li>`;
				})
				.join("");
			return `<div class="refarm-stack" data-moc-group="${escapeHtml(group.key)}">
				<p class="refarm-eyebrow">${escapeHtml(groupLabel(env, group.key, group.label))} (${group.count})</p>
				<ul>${items}</ul>
			</div>`;
		})
		.join("");
	return `<nav class="refarm-stack" data-requirements-moc>
		<p class="refarm-eyebrow">Mapa de Conteúdo — Requisitos</p>
		<p>${escapeHtml(summary)}</p>
		${groups}
	</nav>`;
}

/** Render the requirements as a force-directed GRAPH (SVG) — the analyst's requirement network
 * drawn spatially, so a hub requirement (many relations) reads bigger and central. Assembles the
 * generic Surveyor: each record becomes a GraphRecord (its externalKey is the label + a wikilink
 * alias), and the records' OSLC relations become the graph edges. The layout + SVG are the
 * substrate's; this only supplies the domain data. Deterministic → a stable graph per corpus. */
/** Build the requirement graph DATA from the analyze envelope: the `{nodes,links}` plus a
 * label-by-id map. Shared by the static SVG render and the interactive web face (which mounts
 * the same graph client-side). Each record → a GraphRecord; wikilinks + OSLC relations → edges. */
export function buildRequirementsGraph(env: RecordsAnalyzeEnvelope): {
	graph: ReturnType<typeof graphFromRecords>;
	labels: Record<string, string>;
} {
	const records: GraphRecord[] = [];
	const extraLinks: Array<{ source: string; target: string }> = [];
	const labels: Record<string, string> = {};
	for (const group of env.groups) {
		for (const record of group.records) {
			const externalKey =
				typeof record.fields?.externalKey === "string" ? (record.fields.externalKey as string) : undefined;
			const body = typeof record.fields?.body === "string" ? (record.fields.body as string) : "";
			labels[record.id] = externalKey ?? record.title;
			records.push({
				id: record.id,
				title: record.title,
				text: body, // any [[wikilinks]] in the requirement body become edges
				...(externalKey ? { aliases: [externalKey] } : {}),
			});
			// The record's typed OSLC relations are structural edges (target is another record id).
			for (const rel of record.relations ?? []) {
				extraLinks.push({ source: record.id, target: rel.target });
			}
		}
	}
	return { graph: graphFromRecords(records, { extraLinks }), labels };
}

export function renderRequirementsGraphSvg(env: RecordsAnalyzeEnvelope): string {
	const { graph, labels } = buildRequirementsGraph(env);
	return graphToSvg(graph, {
		labelFor: (id) => labels[id] ?? id,
		hrefFor: (id) => `#${id}`,
		title: `Rede de Requisitos (${env.summary.total})`,
	});
}

/** Merge freshly-ingested records into a manifest by id (new ones added, existing ones
 * REPLACED with the pulled version — a re-pull refreshes). */
function mergeRecords(manifest: RecordsManifest, incoming: KnowledgeRecord[]): RecordsManifest {
	const byId = new Map(manifest.records.map((r) => [r.id, r]));
	for (const record of incoming) byId.set(record.id, record);
	return { ...manifest, records: [...byId.values()] };
}

/** Options for the pull verb. `login` is the LOGIN-GARANTIDO driver — the fixture logs in
 * instantly (offline, out-of-the-box); the analyst swaps a real light browser driver later
 * (their `dgk` binary injects it) without the verb changing. */
export interface RequirementsPullOptions {
	login?: InteractiveLogin;
	sourcesConfigPath?: string;
	/** Build a LIVE source provider (browser-backed) for `--live`. Given the ref being pulled,
	 * returns a provider whose fetch hits the real system. Absent → `--live` reports that live
	 * mode isn't wired. This is where `dgk` injects the browser driver (block E); the offline
	 * provider (the default `sourceProvider` arg) is used without `--live`. */
	liveProviderFactory?: (ref: string) => Promise<IngestSourceProvider>;
}

/** Read the session the analyst DECLARED for a ref in their ledger (if any), to reuse as an
 * already-known session — so a still-valid declared session is honored and login is skipped.
 * The ref is `web:<identity>`; the ledger keys targets by identity. */
function declaredSessionForRef(
	ref: string,
	sourcesConfigPath?: string,
): { identity: string; credentialRef?: string; existing?: WebSourceSessionEvidence } {
	const identity = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
	const snapshots = loadWebSourceTargetsSync(sourcesConfigPath ?? sourcesConfigPath0());
	const snapshot = snapshots[identity];
	return { identity, credentialRef: snapshot?.session?.credentialRef, existing: snapshot?.session };
}

// Local alias so declaredSessionForRef can default to the same ledger path resolver.
const sourcesConfigPath0 = sourcesConfigPath;

export interface LiveProviderOptions {
	sourcesConfigPath?: string;
	cacheRoot?: string;
	/** Where the browser persists its profile + the cookie storageState (reused across runs). */
	sessionDir?: string;
	/** Path to Chrome (else CHROME_PATH / puppeteer's default lookup). */
	chromePath?: string;
	/** Run the browser headless (default false — the human needs to see the SSO/VPN login). */
	headless?: boolean;
	/** How login-complete is DETECTED (no keypress). Tune these for the real SSO so the pull
	 * doesn't false-positive on an auth interstitial or time out on an auth-in-the-URL path.
	 * All optional; passed straight to the browser driver's login signals. */
	loginSignals?: {
		/** Substring the post-login URL must contain (e.g. a dashboard path). Default: base host. */
		urlIncludes?: string;
		/** A CSS selector present only once authenticated (e.g. a dashboard element). */
		readySelector?: string;
		/** The session cookie name that appears once authenticated (e.g. "JSESSIONID"). */
		cookieNamed?: string;
		/** Regex of URL fragments that mean "still logging in" (success requires NOT matching).
		 * Default `login|sso|auth|signin` — override if a real authed URL contains one of those. */
		loginUrlPattern?: string;
	};
	/** How long to wait for login to be detected, ms (default 3 min). Raise for a slow VPN/SSO. */
	loginTimeoutMs?: number;
}

/**
 * Build a `liveProviderFactory` for the pull verb: given a ref, it reads the target's declared
 * URL from the ledger, drives the analyst's Chrome through the SSO/VPN login (reusing a
 * persisted cookie session) via the GENERIC @refarm.dev/browser-driver, and returns a source
 * provider whose OSLC fetch carries those cookies. The browser mechanism is the framework's
 * (any work / an agent can reuse it); this only adds the OSLC glue on top. The browser is
 * constructed only when `--live` is used (puppeteer-core imported lazily inside the driver).
 */
export function createLiveRequirementsProviderFactory(
	options: LiveProviderOptions = {},
): (ref: string) => Promise<IngestSourceProvider> {
	return async (ref: string) => {
		const identity = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
		const snapshots = loadWebSourceTargetsSync(options.sourcesConfigPath ?? sourcesConfigPath());
		const target = snapshots[identity];
		if (!target) {
			throw new Error(
				`LIVE_NO_TARGET: no target "${identity}" in your ledger — see \`dgk source discover\`.`,
			);
		}
		const base = new URL(target.url);
		const baseUrl = `${base.protocol}//${base.host}`;
		const statePath = options.sessionDir
			? path.join(options.sessionDir, "auth-state.json")
			: undefined;
		// The framework's browser-login block: sign in via the operator's Chrome, reuse the cookie
		// session. puppeteer adapter imported lazily — only a live run pays for it. This closure
		// is used for the initial login AND for re-auth on a mid-pull 401 (a fresh browser sign-in
		// producing fresh cookies) — the way the real vault recovers an expired session.
		const openLiveFetch = async (forceRelogin: boolean): Promise<typeof fetch> => {
			const { createLiveFetch } = await import("@refarm.dev/browser-driver");
			const { createPuppeteerSession } = await import("@refarm.dev/browser-driver/puppeteer");
			const session = await createPuppeteerSession({
				executablePath: options.chromePath,
				userDataDir: options.sessionDir,
				headless: options.headless,
				...(options.loginTimeoutMs ? { loginTimeoutMs: options.loginTimeoutMs } : {}),
				...(options.loginSignals ? { signals: options.loginSignals } : {}),
			});
			const live = await createLiveFetch({
				session,
				baseUrl,
				// On re-auth, ignore the persisted cookies (they expired) and force a fresh login.
				...(forceRelogin ? {} : statePath ? { statePath } : {}),
			});
			return live.fetchImpl;
		};

		// The provider re-wraps this cookie-carrying fetch with the OSLC contract (RDF headers +
		// Configuration-Context), so the combination = authenticated OSLC GETs. reauthenticate
		// re-opens the browser for fresh cookies when a pull hits a 401.
		return createRequirementsSourceProvider({
			cacheRoot: options.cacheRoot,
			sourcesConfigPath: options.sourcesConfigPath,
			fetchImpl: await openLiveFetch(false),
			reauthenticate: () => openLiveFetch(true),
		});
	};
}

/** The T3 persona verb: `requirements-pull <system>` — the real ingest step of the journey.
 * It LOGS IN to the chosen system (login-garantido: reuse a valid declared session or run
 * the injected driver), materializes it (from the analyst's ledger), parses its requirements,
 * merges them into the manifest, and persists. "pick EFD → pull → the requirements appear"
 * is a real command: discover → login+ingest HERE → analyze/MOC. */
export function createRequirementsPullCapability(
	recordsDeps: RecordsCommandDeps,
	sourceProvider: IngestSourceProvider,
	options: RequirementsPullOptions = {},
): CapabilityDescriptor {
	// The out-of-the-box driver is the fixture (instant, offline). A real deployment injects
	// a browser driver here; the gate below is identical either way.
	const login = options.login ?? fixtureLogin();
	return {
		name: "requirements-pull",
		summary: "Pull a system's requirements into the bench (login + materialize + ingest + persist)",
		args: [{ name: "ref", required: true }],
		options: [
			{
				name: "live",
				kind: "boolean",
				summary: "Scrape the real system via the browser login (else replay the offline fixture)",
			},
		],
		transports: { http: { path: "/requirements/pull" } },
		renderers: { tui: { section: "requirements" } },
		async run(input): Promise<CapabilityEnvelope> {
			const ref = String(input.args.ref ?? "");
			if (!ref) {
				return buildJsonErrorEnvelope({
					command: "requirements-pull",
					operation: "pull",
					error: "no_ref",
					message: "Pass a system ref to pull (e.g. web:efd — see `dgk source discover`).",
					nextAction: "dgk source discover",
				});
			}
			const live = input.options.live === true;
			if (live && !options.liveProviderFactory) {
				return buildJsonErrorEnvelope({
					command: "requirements-pull",
					operation: "pull",
					error: "live_unavailable",
					message:
						"--live needs a browser driver wired (puppeteer-core + Chrome). This build has none; " +
						"run without --live for the offline fixture.",
					nextAction: "dgk requirements-pull " + ref,
				});
			}
			try {
				// LOGIN-GARANTIDO: authenticate before scraping. Reuse a still-valid declared
				// session; otherwise the injected driver signs in. This gate is what makes the
				// pull honest — you can't ingest a system you're not authenticated to.
				const declared = declaredSessionForRef(ref, options.sourcesConfigPath);
				const auth = await ensureAuthenticatedSession({
					target: { identity: declared.identity, credentialRef: declared.credentialRef },
					existing: declared.existing,
					login,
				});
				// --live: the browser-backed provider hits the real system; otherwise the default
				// (offline) provider replays the fixture. offline:false lets a wired driver fetch;
				// parseRequirements dispatches HTML (fixture) vs RDF/XML (live OSLC) by media type.
				const provider =
					live && options.liveProviderFactory
						? await options.liveProviderFactory(ref)
						: sourceProvider;
				const ingested = await ingestSourceToRecords({
					sourceProvider: provider,
					ref,
					parse: parseRequirements,
					offline: false,
				});
				if (!recordsDeps.saveManifest) {
					// No persistence sink → report what WOULD be ingested (dry-run), don't claim to save.
					return buildJsonSuccessEnvelope({
						command: "requirements-pull",
						operation: "pull",
						nextCommand: "dgk requirements",
						nextCommands: ["dgk requirements"],
						extra: {
							ref,
							ingested: ingested.records.length,
							persisted: false,
							dryRun: true,
							live,
							loggedIn: auth.loggedIn,
							principal: auth.session.principal,
						},
					});
				}
				const merged = mergeRecords(recordsDeps.loadManifest(), ingested.records);
				await recordsDeps.saveManifest(merged);
				return buildJsonSuccessEnvelope({
					command: "requirements-pull",
					operation: "pull",
					nextCommand: "dgk requirements",
					nextCommands: ["dgk requirements"],
					extra: {
						ref,
						ingested: ingested.records.length,
						persisted: true,
						total: merged.records.length,
						live,
						loggedIn: auth.loggedIn,
						principal: auth.session.principal,
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "requirements-pull",
					operation: "pull",
					error: "pull_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction:
						"Check the ref is one `dgk source discover` lists, and its snapshot has a body.",
				});
			}
		},
	};
}

/** What a live crawl needs, resolved for one ref: the authenticated OSLC fetcher (browser
 * cookies + OSLC contract + re-auth), the seed URL(s) to start from, the stream context, and
 * the session evidence. Built by a `liveCrawlerFactory` (browser-backed) or injected in a test. */
export interface LiveCrawlContext {
	fetcher: WebFetchDriver;
	/** The authenticated BINARY fetch driver (same cookies, bytes not text) for attachments. */
	binaryFetcher?: BinaryFetchDriver;
	seeds: CrawlSeed[];
	session: WebSourceSessionEvidence;
	streamURI?: string;
}

/** Build an authenticated binary GET from the browser's cookie `fetchImpl` — the attachment
 * download seam. Same session as the OSLC text fetch; returns raw bytes + media type. A non-OK
 * response throws HttpFetchError so a 401 mid-crawl still triggers re-auth on the text path. */
export function liveBinaryFetcher(fetchImpl: typeof fetch): BinaryFetchDriver {
	return async (request) => {
		const response = await fetchImpl(request.url, { method: "GET", headers: request.headers ?? {} });
		if (!response.ok) throw new HttpFetchError(response.status, request.url);
		const buffer = new Uint8Array(await response.arrayBuffer());
		const mediaType = response.headers.get("content-type") ?? "application/octet-stream";
		const declared = response.headers.get("content-length");
		return {
			bytes: buffer,
			mediaType,
			...(declared ? { declaredSize: Number(declared) } : {}),
		};
	};
}

/**
 * Build a `liveCrawlerFactory` for the crawl verb — the whole-project analogue of
 * createLiveRequirementsProviderFactory. It resolves the target from the ledger, drives the
 * analyst's Chrome through the SSO/VPN login (the GENERIC browser-driver, reusing a persisted
 * cookie session), and returns the OSLC fetcher + the seed(s) to crawl from. The seed is the
 * target's `componentURI` (the project root) when declared, else its `url`. The browser is
 * constructed only when `--live` is used (puppeteer imported lazily inside the driver).
 */
export function createLiveCrawlerFactory(
	options: LiveProviderOptions = {},
): (ref: string) => Promise<LiveCrawlContext> {
	return async (ref: string) => {
		const identity = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
		const snapshots = loadWebSourceTargetsSync(options.sourcesConfigPath ?? sourcesConfigPath());
		const target = snapshots[identity];
		if (!target) {
			throw new Error(
				`LIVE_NO_TARGET: no target "${identity}" in your ledger — see \`dgk source discover\`.`,
			);
		}
		const base = new URL(target.url);
		const baseUrl = `${base.protocol}//${base.host}`;
		const streamURI = target.attributes?.streamURI;
		// The project root to crawl from: the declared componentURI (a project/folder root) if the
		// analyst set one, else the single resource url (a one-artifact crawl, still valid).
		const seedUrl = target.attributes?.componentURI ?? target.url;

		const openLiveFetch = async (forceRelogin: boolean): Promise<typeof fetch> => {
			const { createLiveFetch } = await import("@refarm.dev/browser-driver");
			const { createPuppeteerSession } = await import("@refarm.dev/browser-driver/puppeteer");
			const statePath = options.sessionDir ? path.join(options.sessionDir, "auth-state.json") : undefined;
			const session = await createPuppeteerSession({
				executablePath: options.chromePath,
				userDataDir: options.sessionDir,
				headless: options.headless,
				...(options.loginTimeoutMs ? { loginTimeoutMs: options.loginTimeoutMs } : {}),
				...(options.loginSignals ? { signals: options.loginSignals } : {}),
			});
			const live = await createLiveFetch({
				session,
				baseUrl,
				...(forceRelogin ? {} : statePath ? { statePath } : {}),
			});
			return live.fetchImpl;
		};

		const fetchImpl = await openLiveFetch(false);
		return {
			fetcher: liveOslcFetcher(fetchImpl, () => openLiveFetch(true)),
			binaryFetcher: liveBinaryFetcher(fetchImpl),
			seeds: [{ url: seedUrl, ...(streamURI ? { attributes: { streamURI } } : {}) }],
			session: { kind: "authenticated", authenticated: true },
			...(streamURI ? { streamURI } : {}),
		};
	};
}

export interface RequirementsCrawlOptions {
	login?: InteractiveLogin;
	sourcesConfigPath?: string;
	/** Build the LIVE crawl context (browser-backed) for `--live`. Absent → `--live` reports that
	 * live mode isn't wired. Injected by the CLI (the browser driver); a test injects a fixture. */
	liveCrawlerFactory?: (ref: string) => Promise<LiveCrawlContext>;
	/** Load/persist the accumulative cache manifest across runs (incremental sync). Absent → the
	 * crawl still runs but is not incremental (every run starts from an empty manifest). */
	loadCacheManifest?: (ref: string) => CacheManifest;
	saveCacheManifest?: (ref: string, manifest: CacheManifest) => void | Promise<void>;
	/** BFS caps for a large project. */
	maxDepth?: number;
	maxPages?: number;
	pacingMs?: number;
	/** Injected clock (ISO) for the cache's syncedAt — defaults to Date.now() at run time. */
	now?: () => string;
}

/**
 * The T3 persona verb: `requirements-crawl <ref> [--live]` — walk a WHOLE ALM project and ingest
 * every requirement, incrementally. Where `requirements-pull` fetches one declared resource, this
 * seeds from the project root, follows the OSLC link graph (folders → artifacts) via the generic
 * crawl engine, parses each artifact, and syncs against the accumulative cache so a re-run only
 * re-ingests what changed. This is the "grosso da raspagem" for the Serpro/VPN run.
 */
export function createRequirementsCrawlCapability(
	recordsDeps: RecordsCommandDeps,
	options: RequirementsCrawlOptions = {},
): CapabilityDescriptor {
	const login = options.login ?? fixtureLogin();
	const now = options.now ?? ((): string => new Date().toISOString());
	return {
		name: "requirements-crawl",
		summary: "Crawl a whole ALM project and ingest every requirement (incremental sync)",
		args: [{ name: "ref", required: true }],
		options: [
			{
				name: "live",
				kind: "boolean",
				summary: "Crawl the real system via the browser login (else the offline fixture project)",
			},
		],
		transports: { http: { path: "/requirements/crawl" } },
		renderers: { tui: { section: "requirements" } },
		async run(input): Promise<CapabilityEnvelope> {
			const ref = String(input.args.ref ?? "");
			if (!ref) {
				return buildJsonErrorEnvelope({
					command: "requirements-crawl",
					operation: "crawl",
					error: "no_ref",
					message: "Pass a system ref to crawl (e.g. web:efd — see `dgk source discover`).",
					nextAction: "dgk source discover",
				});
			}
			const live = input.options.live === true;
			if (live && !options.liveCrawlerFactory) {
				return buildJsonErrorEnvelope({
					command: "requirements-crawl",
					operation: "crawl",
					error: "live_unavailable",
					message:
						"--live needs a browser driver wired (puppeteer-core + Chrome). This build has none.",
					nextAction: "dgk requirements-crawl " + ref,
				});
			}
			try {
				// LOGIN-GARANTIDO: authenticate before scraping (reuse a valid declared session).
				const declared = declaredSessionForRef(ref, options.sourcesConfigPath);
				const auth = await ensureAuthenticatedSession({
					target: { identity: declared.identity, credentialRef: declared.credentialRef },
					existing: declared.existing,
					login,
				});
				// The crawl context: live (browser) or the fixture project.
				const ctx =
					live && options.liveCrawlerFactory
						? await options.liveCrawlerFactory(ref)
						: fixtureCrawlContext(ref, options.sourcesConfigPath);

				const prior = options.loadCacheManifest?.(ref) ?? emptyCacheManifest();
				const result = await crawlRequirements({
					fetcher: ctx.fetcher,
					...(ctx.binaryFetcher ? { binaryFetcher: ctx.binaryFetcher } : {}),
					seeds: ctx.seeds,
					session: ctx.session,
					ref,
					...(ctx.streamURI ? { streamURI: ctx.streamURI } : {}),
					priorManifest: prior,
					syncedAt: now(),
					...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
					...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
					...(options.pacingMs !== undefined ? { pacingMs: options.pacingMs } : {}),
				});
				await options.saveCacheManifest?.(ref, result.manifest);

				const summary = {
					ref,
					live,
					pagesSeen: result.seen,
					truncated: result.truncated,
					sync: result.sync.counts,
					ingested: result.records.length,
					attachments: {
						materialized: result.attachments.filter((a) => a.kind === "materialized").length,
						skipped: result.attachments.filter((a) => a.kind === "placeholder").length,
					},
					loggedIn: auth.loggedIn,
					principal: auth.session.principal,
				};
				if (!recordsDeps.saveManifest) {
					return buildJsonSuccessEnvelope({
						command: "requirements-crawl",
						operation: "crawl",
						nextCommand: "dgk requirements",
						nextCommands: ["dgk requirements"],
						extra: { ...summary, persisted: false, dryRun: true },
					});
				}
				const merged = mergeRecords(recordsDeps.loadManifest(), result.records);
				await recordsDeps.saveManifest(merged);
				return buildJsonSuccessEnvelope({
					command: "requirements-crawl",
					operation: "crawl",
					nextCommand: "dgk requirements",
					nextCommands: ["dgk requirements"],
					extra: { ...summary, persisted: true, total: merged.records.length },
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "requirements-crawl",
					operation: "crawl",
					error: "crawl_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the ref is one `dgk source discover` lists, and the VPN is connected.",
				});
			}
		},
	};
}

/** The offline crawl context: a fixture "project" the crawl walks without a browser — the target's
 * declared body served for its own url, so a no-`--live` crawl still exercises the whole pipeline
 * (seed → parse) against the analyst's fixture. */
function fixtureCrawlContext(ref: string, configPath?: string): LiveCrawlContext {
	const identity = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
	const snapshots = loadWebSourceTargetsSync(configPath ?? sourcesConfigPath());
	const target = snapshots[identity];
	const url = target?.url ?? ref;
	const body = target?.body ?? "";
	const mediaType = target?.mediaType ?? "text/html";
	const streamURI = target?.attributes?.streamURI;
	const fetcher: WebFetchDriver = async (req) => ({ body: req.url === url ? body : "", mediaType });
	return {
		fetcher,
		seeds: [{ url, ...(streamURI ? { attributes: { streamURI } } : {}) }],
		session: { kind: "fixture", authenticated: true },
		...(streamURI ? { streamURI } : {}),
	};
}

/** The T3 persona verb: `requirements` - the analyst's product view over the
 * neutral `records analyze` envelope. */
export function createRequirementsCapability(
	recordsDeps: RecordsCommandDeps,
): CapabilityDescriptor {
	return defineRecordsViewCapability({
		name: "requirements",
		summary: "The analyst's requirements bench — a navigable Map of Content (product)",
		records: recordsDeps,
		httpPath: "/requirements/moc",
		// Default grouping = by requirement TYPE (regra-de-negócio / caso-de-uso / funcional),
		// the way a real requirements MOC is organized — over the generic field:<name> lens.
		groupBy: "field:tipo",
		renderers: {
			tui: { section: "requirements" },
			web: { route: "/requirements/moc", icon: "requirements" },
		},
		options: [
			{
				name: "by",
				kind: "string",
				summary: "Group by field:tipo (default), reviewState, type, or sourceRef",
			},
		],
		project: (analyzed) => ({
			by: analyzed.by,
			total: analyzed.summary.total,
			moc: renderRequirementsMoc(analyzed),
			mocHtml: renderRequirementsMocHtml(analyzed),
			groupCount: analyzed.groups.length,
		}),
	});
}

/** The T3 persona verb: `requirements-graph` — the analyst's requirement network as a
 * force-directed SVG (a hub requirement reads bigger and central). Same neutral `records analyze`
 * envelope as the MOC, projected through the generic Surveyor (graphFromRecords → layout → SVG)
 * instead of a list. The SVG is self-contained (a diagram to embed, screenshot, or serve). */
export function createRequirementsGraphCapability(recordsDeps: RecordsCommandDeps): CapabilityDescriptor {
	return defineRecordsViewCapability({
		name: "requirements-graph",
		summary: "The analyst's requirement network as a force-directed graph (SVG)",
		records: recordsDeps,
		httpPath: "/requirements/graph",
		groupBy: "field:tipo",
		renderers: {
			tui: { section: "requirements" },
			web: { route: "/requirements/graph", icon: "requirements" },
		},
		project: (analyzed) => {
			const { graph, labels } = buildRequirementsGraph(analyzed);
			return {
				total: analyzed.summary.total,
				svg: renderRequirementsGraphSvg(analyzed),
				// The raw graph + labels, so the WEB face mounts the SAME graph interactively
				// (pan/zoom/drag) client-side via the substrate's mountGraph — no re-derivation.
				graph,
				labels,
			};
		},
	});
}

/** The analyst's LAB catalog — DATA: the requirement graph is published as a dataset a reactive
 * Marimo notebook analyses (orphan requirements, hubs, relation density), and the notebook is
 * exported to HTML+WASM the browser runs. Editing THIS (not code) adds a notebook/dataset. The
 * notebook source ships in `lab/`; the dataset is produced from the corpus at run time. */
const REQUIREMENTS_LAB_CATALOG: LabCatalog = {
	datasets: [
		{
			id: "grafo-de-requisitos",
			title: "Grafo de Requisitos",
			description: "A rede de requisitos (nós + relações) para análise no notebook.",
			source: ".dgk/lab/grafo-de-requisitos.json",
			output: "grafo-de-requisitos.json",
			format: "json",
		},
	],
	notebooks: [
		{
			id: "analise-grafo",
			title: "Análise do Grafo de Requisitos",
			description: "Hubs, órfãos e densidade de relações — reativo, roda no navegador (WASM).",
			source: "lab/analise-grafo.py",
			output: "analise-grafo.html",
		},
	],
};

export interface RequirementsLabOptions {
	/** Persist the dataset snapshot to disk (the file a notebook reads). Given the relative path +
	 * JSON, writes it. Optional — absent → the manifest is still built (the dataset is fingerprinted
	 * in-process either way). Injected by the CLI (a node fs writer). */
	writeDataset?: (relativePath: string, json: string) => void | Promise<void>;
	now?: () => string;
	/** Fingerprint the dataset payload (default sha256 via node:crypto, injected so pure in tests). */
	hashData?: (json: string) => string;
	/** Execute a command (the marimo export). Injected by the CLI (a uvx spawn). When present AND
	 * `--export` is passed, the notebooks are exported to HTML+WASM for real and the manifest
	 * fingerprints the produced files. Absent → the verb only PLANS the export (records the command). */
	executor?: ProcessExecutor;
	/** Fingerprint a produced notebook HTML file (injected — reads the file, returns its sha256). */
	hashOutput?: (outputPath: string) => Promise<{ algorithm: "sha256"; value: string }>;
	/** The dir exports run from / write under (the CLI resolves it beside the state file). */
	labCwd?: string;
}

/**
 * The T3 persona verb: `requirements-lab` — publish the requirement graph as a Lab dataset and
 * emit the artifact:v1 manifest for the Lab (the dataset + the analysis notebook, with the
 * Marimo→WASM export recorded as provenance). This is the "notebooks marimo" step: the corpus
 * becomes a reactive, browser-runnable analysis. The example DECLARES the catalog (data) and
 * builds the graph; the manifest machinery is the substrate's lab-contract-v1.
 *
 * Uses defineRecordsViewCapability's project (which hands us the analyze envelope). The dataset is
 * fingerprinted in-process, so the manifest always carries a real hash; the fs write is a side
 * effect the CLI wires (the same payload).
 */
export function createRequirementsLabCapability(
	recordsDeps: RecordsCommandDeps,
	options: RequirementsLabOptions = {},
): CapabilityDescriptor {
	const now = options.now ?? ((): string => new Date().toISOString());
	const hashData = options.hashData ?? ((json: string): string => createHash("sha256").update(json).digest("hex"));
	return defineRecordsViewCapability({
		name: "requirements-lab",
		summary: "Publish the requirement graph as a Lab dataset + notebook (Marimo→WASM manifest)",
		records: recordsDeps,
		httpPath: "/requirements/lab",
		groupBy: "field:tipo",
		options: [
			{ name: "export", kind: "boolean", summary: "Actually run the Marimo→WASM export (needs uvx/marimo)" },
		],
		renderers: { tui: { section: "requirements" } },
		project: async (analyzed, input) => {
			const { graph, labels } = buildRequirementsGraph(analyzed);
			const dataset = {
				schemaVersion: 1,
				source: "requirements-lab",
				nodeCount: graph.nodes.length,
				linkCount: graph.links.length,
				nodes: graph.nodes.map((n) => ({ ...n, label: labels[n.id] ?? n.id })),
				links: graph.links,
			};
			const datasetJson = JSON.stringify(dataset, null, 2);
			const datasetHash = hashData(datasetJson);
			// Persist the snapshot the notebook reads (before an export, so the notebook can load it).
			await options.writeDataset?.(".dgk/lab/grafo-de-requisitos.json", datasetJson);

			// --export: actually produce the HTML+WASM (when a runner is wired), fingerprinting each.
			const wantExport = input.options?.export === true;
			let exportResults: NotebookExportResult[] = [];
			let notebookHashes: Record<string, { algorithm: "sha256"; value: string }> = {};
			if (wantExport && options.executor) {
				exportResults = await runNotebookExports(REQUIREMENTS_LAB_CATALOG.notebooks, {
					executor: options.executor,
					...(options.hashOutput ? { hashOutput: options.hashOutput } : {}),
					...(options.labCwd ? { cwd: options.labCwd } : {}),
				});
				notebookHashes = exportHashes(exportResults) as Record<string, { algorithm: "sha256"; value: string }>;
			}

			const manifest = buildLabManifest(REQUIREMENTS_LAB_CATALOG, {
				producer: "reqbench",
				producedAt: now(),
				hashes: { "grafo-de-requisitos": { algorithm: "sha256", value: datasetHash }, ...notebookHashes },
			});
			return {
				nodeCount: dataset.nodeCount,
				linkCount: dataset.linkCount,
				exported: wantExport,
				exportResults: exportResults.map((r) => ({ id: r.notebookId, ok: r.ok, output: r.outputPath, error: r.error })),
				artifacts: manifest.artifacts.map((a) => ({ id: a.id, role: a.role, uri: a.uri })),
				// The export commands (Marimo→WASM), for the operator (or the runner, when not --export).
				exports: manifest.artifacts
					.filter((a) => a.role === "report")
					.map((a) => a.provenance.process?.display),
				manifest,
			};
		},
	});
}

/** The analyst's PARA taxonomy — pure DATA: which area a requirement lands in, by its
 * `tipo` first, then its source `sistema`, else a triage fallback. Editing THIS (not code)
 * re-routes the whole bench — the point of taxonomy-as-data. */
const REQUIREMENTS_TAXONOMY: VaultProfile = {
	name: "requirements-para",
	rules: [
		{
			id: "route-para",
			verb: "organize",
			match: JSON.stringify({
				type: "taxonomy-route",
				axes: [
					{
						field: "tipo",
						map: {
							"regra-de-negocio": "40 - Resources",
							funcional: "40 - Resources",
							"caso-de-uso": "20 - Projects",
						},
					},
					{ field: "sistema", map: { EFD: "20 - Projects/EFD" } },
				],
				fallback: "40 - Resources/Triagem",
			}),
		},
	],
};

/** The T3 persona verb: `requirements-organize [--apply]` — route the pulled requirements
 * to their PARA areas. The analyst brings a taxonomy (DATA); the framework does the routing
 * over the injected (sovereign) vault surface. Dry-run shows the plan; `--apply` persists
 * each record's resolved destination. The example is thin BECAUSE the framework carries the
 * plumbing — one organizeRecords call, no surface instantiation. */
export function createRequirementsOrganizeCapability(
	recordsDeps: RecordsCommandDeps,
	vaultSurface: () => Promise<OrganizeDispatcher>,
): CapabilityDescriptor {
	return {
		name: "requirements-organize",
		summary: "Route the pulled requirements to their PARA areas (by tipo/sistema)",
		options: [
			{ name: "apply", kind: "boolean", summary: "Persist each record's resolved PARA destination" },
		],
		transports: { http: { path: "/requirements/organize" } },
		renderers: { tui: { section: "requirements" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const manifest = recordsDeps.loadManifest();
			const plans = await organizeRecords(await vaultSurface(), manifest.records, REQUIREMENTS_TAXONOMY);
			const apply = input.options?.apply === true;

			if (apply && recordsDeps.saveManifest) {
				const dest = new Map(plans.map((p) => [p.recordId, p.destination]));
				const records = manifest.records.map((r) => {
					const destination = dest.get(r.id);
					if (!destination) return r;
					// Persist the routed destination on the record (the PARA area it belongs to).
					const updated = { ...r, fields: { ...r.fields, paraDestination: destination } };
					updated.contentHash = computeRecordContentHash(updated);
					return updated;
				});
				await recordsDeps.saveManifest({ ...manifest, records });
			}

			return buildJsonSuccessEnvelope({
				command: "requirements-organize",
				operation: "organize",
				nextCommand: "dgk requirements",
				nextCommands: ["dgk requirements"],
				extra: {
					routed: plans.length,
					applied: apply,
					plans: plans.map((p) => ({ id: p.recordId, destination: p.destination })),
				},
			});
		},
	};
}

/** The T3 persona verb: `requirements-search <query> [--tipo --sistema]` — find requirements in
 * the vault by text, filtered by frontmatter facets. The analyst asks "where did I write about
 * nota fiscal?"; the SAME sovereign vault surface that ROUTES also SEARCHES (the query is data
 * the surface interprets). Thin BECAUSE the framework carries the search — one searchRecords call.
 * `--tipo`/`--sistema` post-filter the hit records by their frontmatter facet. */
export function createRequirementsSearchCapability(
	recordsDeps: RecordsCommandDeps,
	vaultSurface: () => Promise<SearchDispatcher>,
): CapabilityDescriptor {
	return {
		name: "requirements-search",
		summary: "Search the requirements vault by text, filtered by tipo/sistema",
		args: [{ name: "query", required: true }],
		options: [
			{ name: "tipo", kind: "string", summary: "Only requirements of this tipo (e.g. requisito)" },
			{ name: "sistema", kind: "string", summary: "Only requirements of this sistema (e.g. EFD)" },
		],
		transports: { http: { path: "/requirements/search" } },
		renderers: { tui: { section: "requirements" }, web: { route: "/search", icon: "search" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const query = String(input.args.query ?? "").trim();
			if (!query) {
				return buildJsonErrorEnvelope({
					command: "requirements-search",
					operation: "search",
					error: "no_query",
					message: "Pass a search query (e.g. requirements-search \"nota fiscal\").",
					nextAction: "requirements-search <query>",
				});
			}
			const manifest = recordsDeps.loadManifest();
			// Optional facet filter — narrow the corpus BEFORE searching (a real analyst scopes by
			// system/type). Applied to the records, not the query, so it composes with any term.
			const tipo = input.options?.tipo ? String(input.options.tipo) : undefined;
			const sistema = input.options?.sistema ? String(input.options.sistema) : undefined;
			const scoped = manifest.records.filter(
				(r) =>
					(!tipo || String(r.fields?.tipo ?? "") === tipo) &&
					(!sistema || String(r.fields?.sistema ?? "") === sistema),
			);

			const hits = await searchRecords(await vaultSurface(), scoped, query);
			// One entry per matched record (a record can match several terms → dedup, keep best score).
			const byRecord = new Map<string, { recordId: string; title: string; tipo?: string; sistema?: string; score: number }>();
			for (const hit of hits) {
				const record = manifest.records.find((r) => r.id === hit.recordId);
				const existing = byRecord.get(hit.recordId);
				const score = (existing?.score ?? 0) + (hit.score ?? 1);
				byRecord.set(hit.recordId, {
					recordId: hit.recordId,
					title: String(record?.fields?.title ?? hit.recordId),
					tipo: record?.fields?.tipo ? String(record.fields.tipo) : undefined,
					sistema: record?.fields?.sistema ? String(record.fields.sistema) : undefined,
					score,
				});
			}
			// Most-relevant first (more matched terms = higher score).
			const results = [...byRecord.values()].sort((a, b) => b.score - a.score);

			return buildJsonSuccessEnvelope({
				command: "requirements-search",
				operation: "search",
				nextCommand: "dgk requirements",
				nextCommands: ["dgk requirements"],
				extra: {
					query,
					scope: { tipo, sistema, searched: scoped.length },
					matched: results.length,
					results,
				},
			});
		},
	};
}

/** Stamp the ALM CANONICAL frontmatter onto a record's fields before it is written to a note —
 * the coordinates a later incremental sync reads back (the artifact's own URI, its ALM modified
 * timestamp, when we last synced). Domain-specific (the analyst's ALM), so it lives here, not in
 * the substrate's planRecordFiles. Anonymized field names carry no institution. */
function stampAlmFrontmatter(record: KnowledgeRecord, syncedAt: string): KnowledgeRecord {
	const artifactUri = record.fields.artifactUri;
	return {
		...record,
		fields: {
			...record.fields,
			...(typeof artifactUri === "string" ? { alm_artifact_uri: artifactUri } : {}),
			alm_last_sync_at: syncedAt,
		},
	};
}

export interface RequirementsMaterializeOptions {
	sourcesConfigPath?: string;
	/** The vault root to write notes under (a directory). Absent → dry-run (plan only, no write). */
	vaultRoot?: string;
	/** The filesystem writer (injected so a test drives it in memory). Given a relative path +
	 * text, writes idempotently (skip if the on-disk content already matches). Returns whether it
	 * wrote (true) or skipped as unchanged (false). Absent + vaultRoot present → a node fs writer. */
	writeNote?: (relativePath: string, text: string) => boolean | Promise<boolean>;
	/** Injected clock for alm_last_sync_at (ISO). */
	now?: () => string;
}

/**
 * The T3 persona verb: `requirements-materialize [--apply]` — write the ingested requirements to
 * Obsidian-style notes on disk (the "geração de mocs"). It ORGANIZES the records (PARA routing),
 * plans the files via the substrate's pure planRecordFiles, stamps ALM canonical frontmatter, and
 * writes each note idempotently under the vault root. Without a vault root it is a dry-run (it
 * reports the file plan). This is the last backend step before a face: a scraped project becomes
 * a navigable note vault, incrementally (an unchanged note is skipped).
 */
export function createRequirementsMaterializeCapability(
	recordsDeps: RecordsCommandDeps,
	vaultSurface: () => Promise<OrganizeDispatcher>,
	options: RequirementsMaterializeOptions = {},
): CapabilityDescriptor {
	const now = options.now ?? ((): string => new Date().toISOString());
	return {
		name: "requirements-materialize",
		summary: "Write the requirements to Obsidian notes on disk (organize + frontmatter + idempotent)",
		options: [
			{ name: "apply", kind: "boolean", summary: "Actually write the notes (else dry-run: plan only)" },
		],
		transports: { http: { path: "/requirements/materialize" } },
		renderers: { tui: { section: "requirements" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const manifest = recordsDeps.loadManifest();
			const syncedAt = now();
			// Stamp ALM frontmatter, then organize for PARA placement, then plan the files (pure).
			const stamped = manifest.records.map((r) => stampAlmFrontmatter(r as KnowledgeRecord, syncedAt));
			const plans = await organizeRecords(await vaultSurface(), stamped, REQUIREMENTS_TAXONOMY);
			const files: RecordFilePlan[] = planRecordFiles(stamped, {
				plans,
				// The ALM external key is the stable, human file name (RN-632504.md).
				fileNameFor: (r) =>
					typeof r.fields.externalKey === "string" ? `${r.fields.externalKey}.md` : `${r.id}.md`,
			});

			const apply = input.options?.apply === true;
			let written = 0;
			let skipped = 0;
			if (apply && options.writeNote) {
				for (const file of files) {
					const didWrite = await options.writeNote(file.relativePath, file.text);
					if (didWrite) written += 1;
					else skipped += 1;
				}
			}

			return buildJsonSuccessEnvelope({
				command: "requirements-materialize",
				operation: "materialize",
				nextCommand: "dgk requirements",
				nextCommands: ["dgk requirements"],
				extra: {
					planned: files.length,
					applied: apply,
					written,
					skipped,
					dryRun: !apply || !options.writeNote,
					files: files.map((f) => ({ id: f.recordId, path: f.relativePath })),
				},
			});
		},
	};
}

/** The analyst's REQUIREMENT GATES — pure DATA: a requirement must declare its tipo, carry
 * its source provenance, and have real content; a dangling wikilink is flagged. Editing THIS
 * (not code) changes what the bench enforces. The matchers are the framework's note gates. */
const REQUIREMENTS_GATES: QualityProfile = {
	name: "requirements-gates",
	rules: [
		{
			id: "require-tipo",
			severity: "fail",
			description: "a requirement must declare its tipo",
			check: { type: "frontmatter-required", field: "tipo" },
		},
		{
			id: "require-provenance",
			severity: "fail",
			description: "a requirement must record where it came from",
			check: { type: "frontmatter-required", field: "provenance" },
		},
		{
			id: "min-body",
			severity: "warn",
			description: "a requirement needs real content, not a stub",
			check: { type: "min-words", min: 4 },
		},
		{
			id: "no-empty-link",
			severity: "warn",
			description: "an empty wikilink is a dangling reference",
			check: { type: "wikilink-shape" },
		},
	],
};

/** The T3 persona verb: `requirements-check` — validate the requirements corpus against the
 * gates. The analyst brings gate rules (DATA); the framework's note checker does the checking
 * over records rendered to notes. Thin: declare gates + one checkNotes call. */
export function createRequirementsCheckCapability(
	recordsDeps: RecordsCommandDeps,
): CapabilityDescriptor {
	return {
		name: "requirements-check",
		summary: "Validate the requirements corpus (required fields, content, links)",
		transports: { http: { path: "/requirements/check" } },
		renderers: { tui: { section: "requirements" } },
		async run(): Promise<CapabilityEnvelope> {
			const records = recordsDeps.loadManifest().records;
			const notes = records.map(recordToVaultNote);
			const findings = await checkNotes(createNoteQualityChecker(), notes, REQUIREMENTS_GATES);
			const failed = findings.filter((f) => f.severity === "fail").length;
			return buildJsonSuccessEnvelope({
				command: "requirements-check",
				operation: "check",
				nextCommand: "dgk requirements",
				nextCommands: ["dgk requirements"],
				extra: {
					checked: records.length,
					findings: findings.length,
					failed,
					// The gate results, keyed to each requirement — the analyst's governance view.
					results: findings.map((f) => ({
						id: f.subjectPath,
						rule: f.ruleId,
						severity: f.severity,
						message: f.message,
					})),
				},
			});
		},
	};
}

/** The requirements bench web surface — T3 RESULT mode as a web PRODUCT. The bridge
 * renders the launcher cards; the content seam renders the navigable MOC (from
 * `host.data.mocHtml`) ABOVE them, so the analyst sees the actual requirements map, not
 * just a launcher. A host runs `requirements`, calls renderRequirementsMocHtml on the
 * envelope, and puts the HTML on host.data.mocHtml — the generic content path, no bespoke
 * panel. The one deep thing (real content) T3 must show; the rest is declared breadth. */
export function reqWebSurface(registry: Parameters<typeof createCapabilityWebSurfacePlugin>[0]) {
	return createCapabilityWebSurfacePlugin(registry, {
		pluginId: "reqbench-t3/web",
		name: "Bancada de Requisitos",
		title: "Bancada de Requisitos do Analista",
		surfaceId: "requirements-panel",
		content: (data) => (typeof data.mocHtml === "string" ? data.mocHtml : ""),
	});
}
