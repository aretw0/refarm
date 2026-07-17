import type { CapabilityDescriptor } from "@refarm.dev/capabilities";
import {
	defineRecordsViewCapability,
	type RecordsAnalyzeEnvelope,
	type RecordsCommandDeps,
} from "@refarm.dev/capabilities-v1/records-view";
import { graphFromRecords, graphToSvg, type GraphRecord } from "@refarm.dev/surveyor";

/**
 * The `requirements-graph` verb + its graph builders, in their OWN browser-safe module so the WEB
 * face can mount the interactive network without dragging persona.ts (node:crypto + the WASM vault
 * component) into the bundle — the same seam as ./search.ts. `defineRecordsViewCapability` comes
 * from the browser-safe `@refarm.dev/capabilities-v1/records-view` subpath (its node-bound siblings
 * — host-cli, local-deps, wasm providers — stay out of the browser). persona.ts re-exports these,
 * and imports buildRequirementsGraph back for its lab dataset, so the CLI is unchanged.
 */

/** Project a records-analyze envelope into a Surveyor graph input (nodes + edges) plus a
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
