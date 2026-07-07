import {
	createRecordsCapabilityGroup,
	defaultVaultDeps,
	type RecordsCommandDeps,
	type RefarmCapabilityDeps,
} from "@refarm.dev/capabilities-v1";
import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
} from "@refarm.dev/cli/capabilities";
import { buildJsonSuccessEnvelope } from "@refarm.dev/cli/json-output";
import {
	createReferenceEnrichmentProvider,
	type ReferenceEnrichmentEntry,
} from "@refarm.dev/enrichment-contract-v1";
import { createReferenceRecordsProvider } from "@refarm.dev/records-contract-v1";
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

/** The records deps, backed by a mutable in-memory manifest so a correction persists
 * and shows up in the MOC. A real deployment backs this with the vault. */
export function reqRecordsDeps(): RecordsCommandDeps {
	let manifest = reqManifest();
	return {
		loadManifest: () => manifest,
		saveManifest: (next) => {
			manifest = next;
		},
		enrichmentProvider: createReferenceEnrichmentProvider({
			fixture: REQ_ENRICHMENT_FIXTURE,
			keyField: "externalKey",
		}),
		recordsProvider: createReferenceRecordsProvider(),
	};
}

/** The full deps bundle for reqbench. Shares one records deps so `records correct` and
 * the MOC see the same state. */
export function reqCapabilityDeps(
	cacheRoot?: string,
	recordsDeps: RecordsCommandDeps = reqRecordsDeps(),
): RefarmCapabilityDeps {
	const root = cacheRoot ?? mkdtempSync(path.join(os.tmpdir(), "reqbench-source-"));
	return {
		source: {
			sourceProvider: createWebSourceProvider({
				cacheRoot: root,
				fixtures: REQ_SOURCE_FIXTURES,
			}),
		},
		vault: defaultVaultDeps({
			discover: () => ({ providers: [], rejected: [] }),
			submitEffort: async () => "reqbench-noop",
			seed: reqManifest,
		}),
		records: recordsDeps,
	};
}

/** Shape of the neutral analyze envelope the MOC consumes. */
interface AnalyzeEnvelope {
	summary: { total: number; byState: Record<string, number> };
	groups: Array<{
		key: string;
		label: string;
		count: number;
		records: Array<{ id: string; title: string; link: string }>;
	}>;
}

const STATE_LABELS: Record<string, string> = {
	reviewed: "Requisitos revisados",
	draft: "Rascunhos a revisar",
	unreviewed: "Sem revisão",
};

function renderRequirementsMoc(env: AnalyzeEnvelope): string {
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

/** The T3 persona verb: `requirements-moc` — the analyst's product view over the
 * neutral `records analyze` envelope. */
export function createRequirementsMocCapability(
	recordsDeps: RecordsCommandDeps,
): CapabilityDescriptor {
	const analyzeAction = createRecordsCapabilityGroup(recordsDeps).actions.analyze;
	return {
		name: "requirements-moc",
		summary: "The analyst's requirements bench — a navigable Map of Content (product)",
		options: [
			{ name: "by", kind: "string", summary: "Group by reviewState (default), type, or sourceRef" },
		],
		transports: {
			cli: {},
			repl: {},
			http: { method: "GET", path: "/requirements/moc" },
			agent: { tool: true, toolName: "requirements_moc" },
		},
		renderers: { tui: { section: "reqbench" } },
		async run(input): Promise<CapabilityEnvelope> {
			if (!analyzeAction) throw new Error("records analyze missing");
			const analyzed = (await analyzeAction.run({
				args: {},
				options: { by: (input.options.by as string) ?? "reviewState" },
				json: true,
			})) as unknown as AnalyzeEnvelope & { by: string };
			return buildJsonSuccessEnvelope({
				command: "requirements-moc",
				operation: "render",
				extra: {
					by: analyzed.by,
					total: analyzed.summary.total,
					moc: renderRequirementsMoc(analyzed),
					groupCount: analyzed.groups.length,
				},
			});
		},
	};
}
