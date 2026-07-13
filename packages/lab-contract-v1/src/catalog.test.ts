import { isTaskArtifactManifest, validateTaskArtifactManifest } from "@refarm.dev/artifact-contract-v1";
import { describe, expect, it } from "vitest";

import {
	buildLabManifest,
	datasetArtifact,
	notebookArtifact,
	notebookExportProcess,
	validateLabCatalog,
	type LabCatalog,
} from "./catalog.js";

const catalog: LabCatalog = {
	notebooks: [
		{ id: "analise-grafo", title: "Análise do Grafo", source: "notebooks/analise-grafo.py", output: "analise-grafo.html" },
		{ id: "visao-geral", title: "Visão Geral", source: "notebooks/visao-geral.py", output: "visao-geral.html", type: "presentation" },
		{ id: "rascunho", title: "Rascunho", source: "notebooks/rascunho.py", output: "rascunho.html", publish: false },
	],
	datasets: [
		{ id: "grafo-do-vault", title: "Grafo", source: ".dgk/grafo.json", output: "grafo.json", format: "json" },
		{ id: "feed-remoto", title: "Feed", runtimeUrl: "https://example.invalid/feed", output: "feed.json", format: "json" },
	],
};

const now = "2026-07-13T00:00:00Z";
const producer = "reqbench";

describe("validateLabCatalog", () => {
	it("accepts a well-formed catalog", () => {
		expect(validateLabCatalog(catalog)).toEqual([]);
	});

	it("flags bad ids, duplicates, and missing source/output", () => {
		const issues = validateLabCatalog({
			notebooks: [{ id: "Bad Id", title: "x", source: "", output: "o.html" }],
			datasets: [
				{ id: "dup", title: "a", source: "s", output: "a.json", format: "json" },
				{ id: "dup", title: "b", output: "b.json", format: "json" },
			],
		});
		expect(issues.some((i) => i.includes('id "Bad Id"'))).toBe(true);
		expect(issues.some((i) => i.includes("missing source"))).toBe(true);
		expect(issues.some((i) => i.includes('duplicate id "dup"'))).toBe(true);
		expect(issues.some((i) => i.includes("needs a source or a runtimeUrl"))).toBe(true);
	});
});

describe("notebookExportProcess", () => {
	it("describes the marimo export html-wasm command (tokenized + display)", () => {
		const proc = notebookExportProcess(catalog.notebooks[0]!, { notebooksPath: "lab", extraArgs: ["--force"] });
		expect(proc.command).toBe("marimo");
		expect(proc.args).toEqual([
			"export",
			"html-wasm",
			"notebooks/analise-grafo.py",
			"--output",
			"lab/analise-grafo.html",
			"--force",
		]);
		expect(proc.display).toBe("marimo export html-wasm notebooks/analise-grafo.py --output lab/analise-grafo.html --force");
	});

	it("honors a wrapped command (uv run …)", () => {
		const proc = notebookExportProcess(catalog.notebooks[0]!, { command: "uvx-marimo" });
		expect(proc.command).toBe("uvx-marimo");
	});
});

describe("notebookArtifact / datasetArtifact", () => {
	it("builds a report artifact for a notebook, carrying the export process as provenance", () => {
		const art = notebookArtifact(catalog.notebooks[0]!, { producedAt: now, producer });
		expect(art.id).toBe("analise-grafo");
		expect(art.uri).toBe("lab/analise-grafo.html");
		expect(art.mediaType).toBe("text/html");
		expect(art.role).toBe("report");
		expect(art.provenance.process?.display).toContain("marimo export html-wasm");
		expect(art.labels).toContain("notebook");
	});

	it("labels a presentation notebook", () => {
		const art = notebookArtifact(catalog.notebooks[1]!, { producedAt: now, producer });
		expect(art.labels).toContain("presentation");
	});

	it("builds a dataset artifact; a runtimeUrl dataset points at the url", () => {
		const snap = datasetArtifact(catalog.datasets[0]!, { producedAt: now, producer });
		expect(snap.role).toBe("dataset");
		expect(snap.uri).toBe("lab/datasets/grafo.json");
		expect(snap.mediaType).toBe("application/json");
		expect(snap.labels).toContain("snapshot");

		const runtime = datasetArtifact(catalog.datasets[1]!, { producedAt: now, producer });
		expect(runtime.uri).toBe("https://example.invalid/feed");
		expect(runtime.labels).toContain("runtime");
	});

	it("attaches a content hash when the runner supplies one", () => {
		const art = notebookArtifact(catalog.notebooks[0]!, {
			producedAt: now,
			producer,
			hash: { algorithm: "sha256", value: "abc123" },
		});
		expect(art.hash).toEqual({ algorithm: "sha256", value: "abc123" });
	});
});

describe("buildLabManifest — a catalog becomes an artifact:v1 manifest", () => {
	it("emits a VALID TaskArtifactManifest with published datasets + notebooks", () => {
		const manifest = buildLabManifest(catalog, { producer, producedAt: now });
		// It is a real artifact:v1 manifest the existing validators accept.
		expect(isTaskArtifactManifest(manifest)).toBe(true);
		expect(validateTaskArtifactManifest(manifest).ok).toBe(true);
		// 2 datasets + 2 published notebooks (the unpublished one is excluded).
		expect(manifest.artifacts).toHaveLength(4);
		expect(manifest.artifacts.map((a) => a.id).sort()).toEqual([
			"analise-grafo",
			"feed-remoto",
			"grafo-do-vault",
			"visao-geral",
		]);
	});

	it("includes unpublished entries when asked", () => {
		const manifest = buildLabManifest(catalog, { producer, producedAt: now, includeUnpublished: true });
		expect(manifest.artifacts.map((a) => a.id)).toContain("rascunho");
	});

	it("threads per-id content hashes onto the right artifacts", () => {
		const manifest = buildLabManifest(catalog, {
			producer,
			producedAt: now,
			hashes: { "grafo-do-vault": { algorithm: "sha256", value: "deadbeef" } },
		});
		const graph = manifest.artifacts.find((a) => a.id === "grafo-do-vault");
		expect(graph?.hash?.value).toBe("deadbeef");
	});
});

describe("buildLabManifest ⊢ artifact:v1 conformance (the producer is contract-conformant)", () => {
	it("a built Lab manifest passes the artifact:v1 conformance suite", async () => {
		const { runArtifactV1Conformance } = await import("@refarm.dev/artifact-contract-v1");
		const result = runArtifactV1Conformance(() => buildLabManifest(catalog, { producer, producedAt: now }));
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});
