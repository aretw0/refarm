import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	defineRecordsViewCapability,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type RecordsAnalyzeEnvelope,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import {
	createLocalRecordsCapabilityDeps,
	ingestSourceToRecords,
	type IngestSourceProvider,
	type SourceRecordParser,
} from "@refarm.dev/capability-host/node";
import type { KnowledgeRecord, RecordsManifest } from "@refarm.dev/records-contract-v1";
import { createCapabilityWebSurfacePlugin } from "@refarm.dev/capability-homestead-surface";
import {
	createRulesEnrichmentProvider,
	type EnrichmentRule,
} from "@refarm.dev/enrichment-contract-v1";
import {
	createWebSourceProvider,
	ensureAuthenticatedSession,
	fixtureLogin,
	loadWebSourceTargetsSync,
	withReauth,
	type InteractiveLogin,
	type WebSourceSessionEvidence,
} from "@refarm.dev/source-web";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createOslcFetchDriver, parseRequirementsFromRdf } from "./oslc.js";
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
			fields: { title, tipo, status: "draft", externalKey: key, body: text },
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
	/** The login driver, so a live pull can RE-AUTHENTICATE when the session expires mid-pull
	 * (a Jazz 401 → re-login → retry, the way the real vault recovers). Defaults to the fixture
	 * login; a real deployment injects a browser login. Only used when a live fetch is wired. */
	login?: InteractiveLogin;
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
			? { fetcher: liveOslcFetcher(options.fetchImpl, options.login ?? fixtureLogin()) }
			: {}),
	});
}

/** The live fetcher: the OSLC driver, wrapped so a recoverable 401 re-authenticates (re-runs
 * the login) and retries. The reauth rebuilds the login target from the FAILING request — its
 * session's credentialRef identifies where to re-login, its url's host is the system. */
function liveOslcFetcher(fetchImpl: typeof fetch, login: InteractiveLogin) {
	const oslc = createOslcFetchDriver({ fetchImpl });
	return withReauth(oslc, {
		reauth: (failed) => {
			const identity = (() => {
				try {
					return new URL(failed.url).hostname;
				} catch {
					return "";
				}
			})();
			return login({ identity, credentialRef: failed.session.credentialRef });
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
	return { ...bundle, sourceProvider };
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
				// offline:false so a wired OSLC driver fetches the system LIVE; with no driver the
				// provider still replays the fixture, so out-of-the-box behavior is unchanged.
				// parseRequirements dispatches HTML (fixture) vs RDF/XML (live OSLC) by media type.
				const ingested = await ingestSourceToRecords({
					sourceProvider,
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
