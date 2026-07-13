import { TASK_ARTIFACT_MANIFEST_SCHEMA } from "@refarm.dev/artifact-contract-v1";
import type {
	ArtifactHash,
	ArtifactProcessReference,
	ArtifactProvenance,
	TaskArtifactManifest,
	TaskArtifactReference,
} from "@refarm.dev/artifact-contract-v1";

/**
 * The LAB catalog contract — declare notebooks and datasets as DATA, and turn them into an
 * artifact manifest (`artifact:v1`). This is the reusable core of a "Lab": a place where reactive
 * notebooks (Marimo → HTML+WASM the browser runs) render over published datasets.
 *
 * Assimilated from the vault-seed Lab stack (its two JSON catalogs + the marimo export command +
 * the dataset→manifest step), decoupled from that vault's Obsidian data producers: the substrate
 * ships the CATALOG shapes, the Marimo→WASM export descriptor, and the manifest builder; the
 * consumer brings its own producers (whatever writes the dataset snapshots) and the runner that
 * executes the export. Nothing here parses a vault or shells out — it is pure data + provenance,
 * and the exported artifacts slot straight into artifact:v1's TaskArtifactManifest.
 */

/** A dataset the Lab publishes for its notebooks to read. `source` is where the producer wrote
 * the snapshot; `output` is the published name notebooks fetch by. A `runtimeUrl` dataset is
 * fetched live at notebook runtime instead of published from a snapshot. */
export interface LabDataset {
	id: string;
	title: string;
	description?: string;
	/** The producer's snapshot file (relative). Present for a published dataset. */
	source?: string;
	/** A live URL fetched at notebook runtime instead of a published snapshot. */
	runtimeUrl?: string;
	/** The published output name notebooks read by (relative). */
	output: string;
	/** json | csv | parquet | jsonld … the data format. */
	format: string;
	/** Whether this dataset is published (default true). */
	publish?: boolean;
}

/** A reactive notebook the Lab exports to HTML+WASM. `source` is the `.py`; `output` the `.html`. */
export interface LabNotebook {
	id: string;
	title: string;
	description?: string;
	/** The Marimo notebook source (`.py`, relative). */
	source: string;
	/** The exported HTML+WASM output (relative). */
	output: string;
	/** "notebook" (default) or "presentation" — a slides-style notebook. */
	type?: "notebook" | "presentation";
	publish?: boolean;
}

/** The Lab's declaration: its notebooks and datasets. This is the whole catalog, as data. */
export interface LabCatalog {
	notebooks: readonly LabNotebook[];
	datasets: readonly LabDataset[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Validate a catalog: ids well-formed + unique across notebooks and datasets, sources present
 * where required. Returns the list of problems (empty = valid). PURE. */
export function validateLabCatalog(catalog: LabCatalog): string[] {
	const issues: string[] = [];
	const seen = new Set<string>();
	const checkId = (id: string, where: string): void => {
		if (!ID_RE.test(id)) issues.push(`${where}: id "${id}" must match ${ID_RE}`);
		if (seen.has(id)) issues.push(`${where}: duplicate id "${id}"`);
		seen.add(id);
	};
	for (const n of catalog.notebooks) {
		checkId(n.id, "notebook");
		if (!n.source) issues.push(`notebook "${n.id}": missing source`);
		if (!n.output) issues.push(`notebook "${n.id}": missing output`);
	}
	for (const d of catalog.datasets) {
		checkId(d.id, "dataset");
		if (!d.source && !d.runtimeUrl) issues.push(`dataset "${d.id}": needs a source or a runtimeUrl`);
		if (!d.output) issues.push(`dataset "${d.id}": missing output`);
	}
	return issues;
}

/** The default Marimo export executable + subcommand. Overridable (a pinned uv-run wrapper). */
export const MARIMO_EXPORT_COMMAND = "marimo";

export interface NotebookExportOptions {
	/** The directory published outputs go under (default "lab"). */
	notebooksPath?: string;
	/** The executable to run (default "marimo"). A consumer may wrap it (uv run …). */
	command?: string;
	/** Extra args appended after the standard export args (e.g. "--force"). */
	extraArgs?: readonly string[];
}

/**
 * Describe the Marimo→WASM export of one notebook as a tokenized `ArtifactProcessReference` — the
 * exact command a runner executes to produce the HTML+WASM, recorded as provenance. Does NOT run
 * anything (the substrate never shells out); a consumer's runner executes `process` and the result
 * is the exported artifact. Mirrors the vault-seed command:
 *   marimo export html-wasm <source> --output <notebooksPath>/<output> [--force]
 */
export function notebookExportProcess(
	notebook: LabNotebook,
	options: NotebookExportOptions = {},
): ArtifactProcessReference {
	const command = options.command ?? MARIMO_EXPORT_COMMAND;
	const notebooksPath = options.notebooksPath ?? "lab";
	const outputPath = `${notebooksPath}/${notebook.output}`;
	const args = [
		"export",
		"html-wasm",
		notebook.source,
		"--output",
		outputPath,
		...(options.extraArgs ?? []),
	];
	return {
		command,
		args,
		display: `${command} ${args.join(" ")}`,
	};
}

/** The media type of an exported notebook (HTML that boots a WASM/Pyodide runtime). */
export const NOTEBOOK_ARTIFACT_MEDIA_TYPE = "text/html";

/** Build the artifact reference for an EXPORTED notebook — its published HTML, the export process
 * as provenance, and an optional content hash (from the runner, once the bytes exist). Role is
 * `report` (a rendered, human-facing output). PURE. */
export function notebookArtifact(
	notebook: LabNotebook,
	options: NotebookExportOptions & {
		producedAt: string;
		producer: string;
		hash?: ArtifactHash;
		notebooksPath?: string;
	},
): TaskArtifactReference {
	const notebooksPath = options.notebooksPath ?? "lab";
	const process = notebookExportProcess(notebook, options);
	const provenance: ArtifactProvenance = {
		runId: `lab-notebook:${notebook.id}`,
		producer: options.producer,
		command: process.display,
		process,
		producedAt: options.producedAt,
	};
	return {
		id: notebook.id,
		uri: `${notebooksPath}/${notebook.output}`,
		mediaType: NOTEBOOK_ARTIFACT_MEDIA_TYPE,
		role: "report",
		...(options.hash ? { hash: options.hash } : {}),
		provenance,
		labels: ["lab", "notebook", ...(notebook.type === "presentation" ? ["presentation"] : [])],
	};
}

/** Build the artifact reference for a published DATASET — its output path, a producer provenance,
 * and an optional content hash. Role is `data`. A runtimeUrl dataset carries the url as `source`. */
export function datasetArtifact(
	dataset: LabDataset,
	options: { producedAt: string; producer: string; hash?: ArtifactHash; notebooksPath?: string },
): TaskArtifactReference {
	const notebooksPath = options.notebooksPath ?? "lab";
	const provenance: ArtifactProvenance = {
		runId: `lab-dataset:${dataset.id}`,
		producer: options.producer,
		...(dataset.source ? { source: dataset.source } : {}),
		producedAt: options.producedAt,
	};
	return {
		id: dataset.id,
		uri: dataset.runtimeUrl ?? `${notebooksPath}/datasets/${dataset.output}`,
		mediaType: mediaTypeForFormat(dataset.format),
		role: "dataset",
		...(options.hash ? { hash: options.hash } : {}),
		provenance,
		labels: ["lab", "dataset", ...(dataset.runtimeUrl ? ["runtime"] : ["snapshot"])],
	};
}

function mediaTypeForFormat(format: string): string {
	switch (format.toLowerCase()) {
		case "json":
			return "application/json";
		case "jsonld":
			return "application/ld+json";
		case "csv":
			return "text/csv";
		case "parquet":
			return "application/vnd.apache.parquet";
		default:
			return "application/octet-stream";
	}
}

export interface BuildLabManifestOptions {
	producer: string;
	producedAt: string;
	notebooksPath?: string;
	/** Per-artifact content hashes, keyed by catalog id (from the runner, once bytes exist). */
	hashes?: Readonly<Record<string, ArtifactHash>>;
	/** Include unpublished entries too (default false — only `publish !== false`). */
	includeUnpublished?: boolean;
	taskId?: string;
}

/**
 * Turn a Lab catalog into an `artifact:v1` TaskArtifactManifest — every published dataset and
 * notebook as a TaskArtifactReference, with the export command recorded as provenance. This is the
 * bridge: a Lab's declaration becomes the same manifest any artifact consumer already understands
 * (selectTaskArtifacts, review states, etc.). PURE — the caller supplies the clock, producer, and
 * (once bytes exist) the content hashes; it never runs the export or reads a file.
 */
export function buildLabManifest(catalog: LabCatalog, options: BuildLabManifestOptions): TaskArtifactManifest {
	const wanted = (publish?: boolean): boolean => options.includeUnpublished === true || publish !== false;
	const hashFor = (id: string): ArtifactHash | undefined => options.hashes?.[id];
	const artifacts: TaskArtifactReference[] = [];
	for (const dataset of catalog.datasets) {
		if (!wanted(dataset.publish)) continue;
		artifacts.push(
			datasetArtifact(dataset, {
				producedAt: options.producedAt,
				producer: options.producer,
				...(hashFor(dataset.id) ? { hash: hashFor(dataset.id)! } : {}),
				...(options.notebooksPath ? { notebooksPath: options.notebooksPath } : {}),
			}),
		);
	}
	for (const notebook of catalog.notebooks) {
		if (!wanted(notebook.publish)) continue;
		artifacts.push(
			notebookArtifact(notebook, {
				producedAt: options.producedAt,
				producer: options.producer,
				...(hashFor(notebook.id) ? { hash: hashFor(notebook.id)! } : {}),
				...(options.notebooksPath ? { notebooksPath: options.notebooksPath } : {}),
			}),
		);
	}
	return {
		schema: TASK_ARTIFACT_MANIFEST_SCHEMA,
		...(options.taskId ? { taskId: options.taskId } : {}),
		createdAt: options.producedAt,
		artifacts,
	};
}
