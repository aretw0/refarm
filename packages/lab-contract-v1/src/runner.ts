import type { ArtifactHash, TaskArtifactReference } from "@refarm.dev/artifact-contract-v1";

import { notebookExportProcess, type LabNotebook, type NotebookExportOptions } from "./catalog.js";

/**
 * The LAB EXPORT runner — actually produce the HTML+WASM from a notebook, via an INJECTED process
 * executor. The substrate describes the export command (notebookExportProcess) and orchestrates
 * the run + result shaping; it never spawns a process itself (no child_process import), so it
 * stays environment-agnostic and testable. The consumer injects how a command runs (a `uvx`
 * spawn, a container exec, a CI step) and how the produced bytes are hashed.
 *
 * This closes the loop the catalog opened: catalog → export command → RUN it → an exported
 * artifact with a real content hash, ready for the artifact:v1 manifest.
 */

/** How a tokenized command is executed. Returns the exit code + captured output. Injected. */
export type ProcessExecutor = (
	command: string,
	args: readonly string[],
	options?: { cwd?: string },
) => Promise<{ code: number; stdout?: string; stderr?: string }>;

/** How the produced output is fingerprinted (e.g. sha256 of the .html). Injected (fs-agnostic). */
export type HashOutput = (outputPath: string) => Promise<ArtifactHash> | ArtifactHash;

export interface RunNotebookExportOptions extends NotebookExportOptions {
	/** Execute the export command (injected — a uvx/marimo spawn, a container exec). */
	executor: ProcessExecutor;
	/** Fingerprint the produced HTML (injected). Absent → no hash on the result. */
	hashOutput?: HashOutput;
	/** Working directory for the export process. */
	cwd?: string;
}

export interface NotebookExportResult {
	notebookId: string;
	/** Whether the export process exited 0. */
	ok: boolean;
	/** The published output path (relative), whether or not it succeeded. */
	outputPath: string;
	/** The exit code from the executor. */
	code: number;
	/** The content hash of the produced output (only when ok + hashOutput given). */
	hash?: ArtifactHash;
	/** Captured stderr on failure, for the operator. */
	error?: string;
}

/**
 * Run one notebook's Marimo→WASM export via the injected executor. Builds the export command
 * (the same one recorded as provenance), runs it, and on success fingerprints the output. Never
 * throws on a non-zero exit — returns `{ok:false, error}` so a batch keeps going. The substrate
 * does no I/O of its own; the executor and hasher are the consumer's.
 */
export async function runNotebookExport(
	notebook: LabNotebook,
	options: RunNotebookExportOptions,
): Promise<NotebookExportResult> {
	const process = notebookExportProcess(notebook, options);
	const notebooksPath = options.notebooksPath ?? "lab";
	const outputPath = `${notebooksPath}/${notebook.output}`;
	let result: { code: number; stdout?: string; stderr?: string };
	try {
		result = await options.executor(process.command, process.args, options.cwd ? { cwd: options.cwd } : undefined);
	} catch (error) {
		return {
			notebookId: notebook.id,
			ok: false,
			outputPath,
			code: -1,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	if (result.code !== 0) {
		return {
			notebookId: notebook.id,
			ok: false,
			outputPath,
			code: result.code,
			...(result.stderr ? { error: result.stderr } : {}),
		};
	}
	const hash = options.hashOutput ? await options.hashOutput(outputPath) : undefined;
	return { notebookId: notebook.id, ok: true, outputPath, code: 0, ...(hash ? { hash } : {}) };
}

/** Run every notebook's export (sequentially — Marimo exports are heavy). Returns each result; a
 * failure does not stop the batch. Use the results' hashes to fingerprint the manifest artifacts. */
export async function runNotebookExports(
	notebooks: readonly LabNotebook[],
	options: RunNotebookExportOptions,
): Promise<NotebookExportResult[]> {
	const results: NotebookExportResult[] = [];
	for (const notebook of notebooks) {
		if (notebook.publish === false) continue;
		results.push(await runNotebookExport(notebook, options));
	}
	return results;
}

/** Collect the successful exports' hashes keyed by notebook id — ready to pass as `hashes` to
 * buildLabManifest so the manifest fingerprints the produced HTML. */
export function exportHashes(results: readonly NotebookExportResult[]): Record<string, ArtifactHash> {
	const hashes: Record<string, ArtifactHash> = {};
	for (const r of results) if (r.ok && r.hash) hashes[r.notebookId] = r.hash;
	return hashes;
}

/** Narrow a manifest artifact list to the notebook reports that actually exported OK — for a
 * gallery that only links available notebooks. */
export function availableNotebookArtifacts(
	artifacts: readonly TaskArtifactReference[],
	results: readonly NotebookExportResult[],
): TaskArtifactReference[] {
	const ok = new Set(results.filter((r) => r.ok).map((r) => r.notebookId));
	return artifacts.filter((a) => a.role === "report" && ok.has(a.id));
}
