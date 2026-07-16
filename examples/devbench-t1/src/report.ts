import { type CapabilityDescriptor, type SurfaceableManifest } from "@refarm.dev/capability-host";
import { createEvidenceBundleCapability, type EvidenceFile } from "@refarm.dev/capability-host/node";
import { graphToSvg } from "@refarm.dev/surveyor";

import { runGovernancePoc } from "./governance-poc.js";
import { buildExtensionGraph, pluginShortName, type BuildExtensionGraphOptions } from "./extension-graph.js";

/**
 * REPORT — materialize the writeup's evidence to disk (the T1 record material).
 *
 * The example already produces the writeup's artifacts (the governance scorecard, the SPI graph,
 * the executed edges) — but they only ever came back in an envelope. This consolidates them into
 * files a writeup embeds: a `report.md` narrating what the example PROVES with the real numbers,
 * and the SPI dependency graph as a standalone `.svg` figure. Reuses runGovernancePoc + the graph
 * builder + graphToSvg; nothing new is computed. `--apply` writes (a caller injects the writer);
 * without it the report is returned in the envelope. NOT a panel — a document that feeds the text.
 */

/** Build the T1 record material: the SPI graph SVG + a markdown report of what the example proves. */
export function buildDevbenchReport(
	manifests: readonly SurfaceableManifest[],
	graphOptions: BuildExtensionGraphOptions,
): EvidenceFile[] {
	const governance = runGovernancePoc();
	const { graph, labels, apiEdges } = buildExtensionGraph(manifests, graphOptions);
	const graphSvg = graphToSvg(graph, {
		labelFor: (id) => labels[id] ?? pluginShortName(id),
		title: "Grafo de dependência de plugins — arestas SPI (requiresApi → providesApi)",
	});
	const executed = apiEdges.filter((e) => e.executed);

	const edgesTable = apiEdges
		.map((e) => `| ${pluginShortName(e.from)} → ${pluginShortName(e.to)} | ${e.api} | ${e.executed ? "executada (ao vivo)" : "ilustrativa"} |`)
		.join("\n");
	// The scorecard's headline: its weighted score + the gate verdict (not the whole object).
	const s = governance.scorecard as { score?: unknown; gate?: unknown };
	const scoreLine = `${s.score ?? "—"} · gate: ${s.gate ?? "—"}`;

	const md = `# T1 — Bancada de Plugins WASM: o que o exemplo prova

> Material de registro gerado pelo próprio exemplo (dgk report). Os números vêm da execução,
> não de afirmação. Figuras: \`diagrams/composition.svg\`, \`diagrams/flow.svg\`, \`.dgk/report/spi-graph.svg\`.

## Arquitetura

Uma plataforma multi-superfície neutra carrega um host WASM soberano (tractor, Rust/wasmtime);
o aplicativo declara UM manifesto de extensão e o inspetor. Ver \`diagrams/composition.svg\`.

## Recursão host-mediada (o eixo SPI)

Um plugin declara \`requiresApi: [X]\` e o host resolve quem \`providesApi: [X]\` — a aresta SPI.
${executed.length} de ${apiEdges.length} são EXECUTADAS pelo runtime (não só desenhadas):

| Aresta | API | Estado |
|---|---|---|
${edgesTable}

Figura: \`.dgk/report/spi-graph.svg\`.

## Governança executada (não afirmada)

O quartete decide → registra → recusa, provado ao vivo. A PoC roda ${governance.metrics.combinationsRun}
combinações (modos de política × comportamentos de extensão) e produz um scorecard objetivo
(total: ${scoreLine}). Ver \`diagrams/flow.svg\` e os artefatos em \`.dgk/governance/\`.

## O que os testes garantem

- **enforce**: sob strict, um efeito não-declarado é RECUSADO na fronteira (nenhuma linha fs:read no audit).
- **resiliência**: um plugin em loop infinito é trapado (epoch) e reinstanciado; o host segue servindo.
- **observabilidade**: a timeline do run correlaciona cada tool-call ao host-effect que disparou.
- **provência**: um plugin é seu SHA-256; bytes adulterados são rejeitados (hash-mismatch).

Cada afirmação acima tem um teste (unitário ou de execução no runtime Rust) que a comprova.
`;

	return [
		{ path: ".dgk/report/spi-graph.svg", content: graphSvg },
		{ path: ".dgk/report/T1-report.md", content: md },
	];
}

export interface ReportVerbOptions {
	/** Persist a report file (injected by the CLI — a node fs writer). Absent → report-only. */
	writeReport?: (relativePath: string, content: string) => void | Promise<void>;
}

/**
 * `report [--apply]` — generate the T1 record material (the SPI graph SVG + a markdown report of
 * what the example proves, with the real numbers). `--apply` writes it (with a SHA-256 execution
 * stamp); else it is returned. The verb shape is the shared evidence-bundle capability.
 */
export function createReportCapability(
	manifests: readonly SurfaceableManifest[],
	graphOptions: BuildExtensionGraphOptions = {},
	options: ReportVerbOptions = {},
): CapabilityDescriptor {
	return createEvidenceBundleCapability({
		name: "report",
		summary: "Generate the record material — the SPI graph SVG + a report of what T1 proves (real numbers)",
		command: "dgk",
		httpPath: "/report",
		renderers: { tui: { section: "extension" }, ide: { command: "dgk.report" } },
		build: () => buildDevbenchReport(manifests, graphOptions),
		...(options.writeReport ? { writeFile: options.writeReport } : {}),
		nextVerb: "extension-graph",
	});
}
