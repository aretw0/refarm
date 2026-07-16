import { type CapabilityDescriptor, type RecordsCommandDeps } from "@refarm.dev/capability-host";
import { createEvidenceBundleCapability, type EvidenceFile } from "@refarm.dev/capability-host/node";

import { buildVaultOverview } from "./vault-overview.js";

/**
 * REPORT — materialize the T3 record material to disk (the analyst-bench evidence for the writeup).
 *
 * The example already computes the vault's whole state (coverage, traceability, health, last
 * change); this consolidates it into a `report.md` a writeup embeds — the numbers that come from
 * the corpus, not from assertion. Reuses buildVaultOverview; nothing new is computed. `--apply`
 * writes it (a caller injects the writer). NOT a panel — a document that feeds the text.
 */

/** Build the T3 record material: a markdown report of the vault's state with real numbers. */
export function buildReqbenchReport(recordsDeps: RecordsCommandDeps): EvidenceFile[] {
	const o = buildVaultOverview(recordsDeps.loadManifest());
	const coverage = (label: string, counts: Record<string, number>): string =>
		`- **${label}:** ${Object.entries(counts).map(([k, n]) => `${k} (${n})`).join(" · ") || "—"}`;
	const health = o.health.healthy
		? "saudável — sem órfãos, duplicados ou danglings"
		: `${o.health.orphans} órfão(s) · ${o.health.duplicates} duplicado(s) · ${o.health.dangling} dangling(s)`;
	const last = o.lastChange
		? `${o.lastChange.origin ?? "—"} em ${o.lastChange.recordedAt} (${o.lastChange.totalRevisions} revisões)`
		: "sem histórico ainda";

	const md = `# T3 — Caixa de Notas de Requisitos: o estado do vault

> Material de registro gerado pelo próprio exemplo (dgk report). Os números vêm do corpus,
> não de afirmação. Figuras: \`diagrams/composition.svg\`, \`diagrams/flow.svg\`.

## Cobertura

${o.total} requisitos no vault.

${coverage("Sistema", o.bySistema)}
${coverage("Tipo", o.byTipo)}
${coverage("Status", o.byStatus)}

## Rastreabilidade

- **Relações in-corpus:** ${o.relations}
- **Anexos materializados:** ${o.attachments}

A rastreabilidade vem dos próprios requisitos: o parser OSLC/RDF extrai os predicados de link
(elaboratedBy / decomposedBy / satisfiedBy / references) como relações tipadas, que viram arestas
do grafo (\`requirements-graph\`) e sobrevivem na nota materializada (bloco "Rastreabilidade").

## Saúde do corpus

${health}. Órfãos, duplicados e danglings são detectados cross-record (\`requirements-health\`) —
o que gates por-nota não veem.

## Histórico

Última mudança: ${last}. O vault versiona (history:v1): um requisito que muda entre dois pulls
tem uma timeline e um diff de campos (\`requirements-history\` / \`requirements-diff\`); uma
correção (\`records correct\`) também entra no histórico.

## O que os testes garantem

- **multi-fonte**: dois ALMs (EFD, NFE) agregam num vault, roteados por sistema.
- **rastreabilidade**: as relações do RDF live populam o grafo e a nota, não só o fixture.
- **saúde**: o corpus é auditado por órfãos/duplicados/danglings.
- **histórico**: pull → pull → correct deixa uma timeline durável [pull, pull, correct].

Cada afirmação acima tem um teste que a comprova.
`;

	return [{ path: ".dgk/report/T3-report.md", content: md }];
}

export interface ReportVerbOptions {
	writeReport?: (relativePath: string, content: string) => void | Promise<void>;
}

/**
 * `requirements-report [--apply]` — generate the T3 record material: a markdown report of the
 * vault's state (coverage, traceability, health, history) with the real numbers. `--apply` writes
 * (with a SHA-256 execution stamp). The verb shape is the shared evidence-bundle capability.
 */
export function createRequirementsReportCapability(
	recordsDeps: RecordsCommandDeps,
	options: ReportVerbOptions = {},
): CapabilityDescriptor {
	return createEvidenceBundleCapability({
		name: "requirements-report",
		summary: "Generate the record material — a report of the vault's state (coverage/traceability/health/history)",
		command: "dgk",
		httpPath: "/requirements/report",
		renderers: { tui: { section: "requirements" }, ide: { command: "dgk.requirements-report" } },
		build: () => buildReqbenchReport(recordsDeps),
		...(options.writeReport ? { writeFile: options.writeReport } : {}),
		nextVerb: "requirements",
	});
}
