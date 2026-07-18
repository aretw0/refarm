import type { CapabilityDescriptor } from "@refarm.dev/capabilities";
import {
	defineRecordsViewCapability,
	type RecordsCommandDeps,
} from "@refarm.dev/capabilities-v1/records-view";
import {
	buildLabManifest,
	exportHashes,
	runNotebookExports,
	type LabCatalog,
	type NotebookExportResult,
	type ProcessExecutor,
} from "@refarm.dev/lab-contract-v1";

import { buildRequirementsGraph } from "./graph.js";

/**
 * The `requirements-lab` verb + its Lab catalog, in their OWN browser-safe module so the WEB face
 * can render the Lab gallery without dragging persona.ts (node:crypto + the WASM vault component)
 * into the bundle — the same seam as ./graph.ts and ./search.ts. `defineRecordsViewCapability` comes
 * from the browser-safe `@refarm.dev/capabilities-v1/records-view` subpath, and lab-contract-v1 is
 * node-free. persona.ts re-exports these, so the CLI is unchanged; lab-app.ts builds a browser-safe
 * registry from them for the /lab/ face.
 *
 * The dataset fingerprint is INJECTED (`hashData`), defaulting to a Web Crypto sha256 that runs in
 * the browser and in modern node — so this module carries no node:crypto import. The CLI passes its
 * own node hasher for byte-identical behavior; the web face uses the default (the hash is provenance
 * the gallery never renders, so it stays correct without pulling node in).
 */

/** The Lab's catalog — pure DATA: which datasets/notebooks the corpus publishes. Each notebook is
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

/** Web Crypto sha256 (hex) — the browser-safe default fingerprint. Available in browsers and node
 * 20+ via the global `crypto.subtle`, so this module needs no node:crypto import. */
async function webCryptoSha256Hex(json: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface RequirementsLabOptions {
	/** Persist the dataset snapshot to disk (the file a notebook reads). Given the relative path +
	 * JSON, writes it. Optional — absent → the manifest is still built (the dataset is fingerprinted
	 * in-process either way). Injected by the CLI (a node fs writer). */
	writeDataset?: (relativePath: string, json: string) => void | Promise<void>;
	now?: () => string;
	/** Fingerprint the dataset payload (default Web Crypto sha256, injected so pure in tests / node in
	 * the CLI). May be sync or async. */
	hashData?: (json: string) => string | Promise<string>;
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
	const hashData = options.hashData ?? webCryptoSha256Hex;
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
			const datasetHash = await hashData(datasetJson);
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
