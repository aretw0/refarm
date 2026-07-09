import {
	defineRecordsViewCapability,
	type CapabilityDescriptor,
	type RecordsAnalyzeEnvelope,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import { createLocalRecordsCapabilityDeps } from "@refarm.dev/capability-host/node";
import {
	createReferenceEnrichmentProvider,
	type ReferenceEnrichmentEntry,
} from "@refarm.dev/enrichment-contract-v1";
import { createWebSourceProvider } from "@refarm.dev/source-web";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { REQ_SOURCE_FIXTURES, reqManifest } from "./fixture.js";

/**
 * The T3 persona (result mode). reqbench presents the analyst's requirements bench as a
 * finished product: the analyst discovers a system, pulls, corrects, and reads a
 * navigable requirements MOC — never the neutral engine underneath.
 */

/** The analyst's enrichment lookup — adds domain fields keyed by externalKey. */
const REQ_ENRICHMENT_FIXTURE: Record<string, ReferenceEnrichmentEntry> = {
	"REQ-1": {
		fields: { "req.prioridade": "alta", "req.modulo": "cadastro" },
		sourceRef: "fixture:reqbench/enrichment#REQ-1",
	},
	"REQ-2": {
		fields: { "req.prioridade": "media", "req.modulo": "validacao" },
		sourceRef: "fixture:reqbench/enrichment#REQ-2",
	},
};

/** The records deps, backed by a mutable manifest and optional local state file so a
 * correction persists and shows up in the MOC. A real deployment backs this with the
 * vault. */
export interface RequirementsStateOptions {
	statePath?: string;
}

export interface RequirementsCapabilityOptions extends RequirementsStateOptions {
	cacheRoot?: string;
}

export function reqCapabilityBundle(options: RequirementsCapabilityOptions = {}) {
	const root = options.cacheRoot ?? mkdtempSync(path.join(os.tmpdir(), "reqbench-source-"));
	return createLocalRecordsCapabilityDeps({
		seed: reqManifest,
		statePath: options.statePath,
		enrichmentProvider: createReferenceEnrichmentProvider({
			fixture: REQ_ENRICHMENT_FIXTURE,
			keyField: "externalKey",
		}),
		source: {
			sourceProvider: createWebSourceProvider({
				cacheRoot: root,
				fixtures: REQ_SOURCE_FIXTURES,
			}),
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
			groupCount: analyzed.groups.length,
		}),
	});
}
