import {
	defineRecordsViewCapability,
	type CapabilityDescriptor,
	type RecordsAnalyzeEnvelope,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import { createLocalRecordsCapabilityDeps } from "@refarm.dev/capability-host/node";
import { createCapabilityWebSurfacePlugin } from "@refarm.dev/capability-homestead-surface";
import {
	createRulesEnrichmentProvider,
	type EnrichmentRule,
} from "@refarm.dev/enrichment-contract-v1";
import { createWebSourceProvider, loadWebSourceTargetsSync } from "@refarm.dev/source-web";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
	{ id: "tag-cnpj", matchSource: ["body", "title"], matchPattern: /\bCNPJ\b/, outputTag: "req/cnpj" },
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
}

export function reqCapabilityBundle(options: RequirementsCapabilityOptions = {}) {
	const root = options.cacheRoot ?? mkdtempSync(path.join(os.tmpdir(), "reqbench-source-"));
	// The analyst's source systems come from THEIR ledger, not hardcoded here. `discover`
	// lists exactly what they declared (the sample ships EFD). An override lets tests point
	// at a temp ledger.
	const fixtures = loadWebSourceTargetsSync(options.sourcesConfigPath ?? sourcesConfigPath());
	return createLocalRecordsCapabilityDeps({
		seed: reqManifest,
		statePath: options.statePath,
		// The analyst's rules + the generic engine: text mentioning CNPJ/crédito/… gets tagged.
		enrichmentProvider: createRulesEnrichmentProvider({
			rules: REQ_ENRICHMENT_RULES,
			tagField: "req.tags",
		}),
		source: {
			sourceProvider: createWebSourceProvider({ cacheRoot: root, fixtures }),
		},
	});
}

const STATE_LABELS: Record<string, string> = {
	reviewed: "Requisitos revisados",
	draft: "Rascunhos a revisar",
	unreviewed: "Sem revisão",
};

function renderRequirementsMoc(env: RecordsAnalyzeEnvelope): string {
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
		lines.push(`## ${STATE_LABELS[group.key] ?? group.label} (${group.count})`);
		for (const record of group.records) {
			lines.push(`- [[${record.link.replace(/\.md$/, "")}|${record.title}]]`);
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
	const groups = env.groups
		.map((group) => {
			const items = group.records
				.map(
					(record) =>
						`<li><a href="${escapeHtml(record.link)}" class="refarm-code">${escapeHtml(record.title)}</a></li>`,
				)
				.join("");
			return `<div class="refarm-stack" data-moc-group="${escapeHtml(group.key)}">
				<p class="refarm-eyebrow">${escapeHtml(STATE_LABELS[group.key] ?? group.label)} (${group.count})</p>
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
		renderers: {
			tui: { section: "requirements" },
			web: { route: "/requirements/moc", icon: "requirements" },
		},
		options: [
			{ name: "by", kind: "string", summary: "Group by reviewState (default), type, or sourceRef" },
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
