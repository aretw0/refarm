import { describe, expect, it, vi } from "vitest";

import { buildLabManifest, type LabCatalog, type LabNotebook } from "./catalog.js";
import {
	availableNotebookArtifacts,
	createProcessHandoffExecutor,
	exportHashes,
	runNotebookExport,
	runNotebookExports,
	type ProcessExecutor,
} from "./runner.js";

const nb: LabNotebook = { id: "analise-grafo", title: "x", source: "lab/analise-grafo.py", output: "analise-grafo.html" };

const okExecutor: ProcessExecutor = async () => ({ code: 0, stdout: "done" });
const failExecutor: ProcessExecutor = async () => ({ code: 1, stderr: "marimo: boom" });

describe("runNotebookExport", () => {
	it("runs the export command via the injected executor and hashes the output on success", async () => {
		const executor = vi.fn(okExecutor);
		const result = await runNotebookExport(nb, {
			executor,
			hashOutput: () => ({ algorithm: "sha256", value: "hhh" }),
			notebooksPath: "lab",
		});
		expect(result.ok).toBe(true);
		expect(result.outputPath).toBe("lab/analise-grafo.html");
		expect(result.hash).toEqual({ algorithm: "sha256", value: "hhh" });
		// The executor got the real marimo export command.
		expect(executor).toHaveBeenCalledWith(
			"marimo",
			["export", "html-wasm", "lab/analise-grafo.py", "--output", "lab/analise-grafo.html"],
			undefined,
		);
	});

	it("returns ok:false with the stderr on a non-zero exit (never throws)", async () => {
		const result = await runNotebookExport(nb, { executor: failExecutor });
		expect(result.ok).toBe(false);
		expect(result.code).toBe(1);
		expect(result.error).toBe("marimo: boom");
		expect(result.hash).toBeUndefined();
	});

	it("returns ok:false when the executor itself throws", async () => {
		const result = await runNotebookExport(nb, {
			executor: async () => {
				throw new Error("ENOENT: uvx not found");
			},
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain("uvx not found");
	});

	it("passes cwd through to the executor", async () => {
		const executor = vi.fn(okExecutor);
		await runNotebookExport(nb, { executor, cwd: "/work" });
		expect(executor).toHaveBeenCalledWith(expect.any(String), expect.any(Array), { cwd: "/work" });
	});
});

describe("runNotebookExports (batch)", () => {
	const catalog: LabCatalog = {
		notebooks: [
			nb,
			{ id: "outro", title: "y", source: "lab/outro.py", output: "outro.html" },
			{ id: "skip", title: "z", source: "lab/skip.py", output: "skip.html", publish: false },
		],
		datasets: [],
	};

	it("runs each published notebook and skips unpublished ones; a failure doesn't stop the batch", async () => {
		let call = 0;
		const executor: ProcessExecutor = async () => (++call === 1 ? { code: 0 } : { code: 1, stderr: "x" });
		const results = await runNotebookExports(catalog.notebooks, {
			executor,
			hashOutput: () => ({ algorithm: "sha256", value: "h" }),
		});
		expect(results.map((r) => r.notebookId)).toEqual(["analise-grafo", "outro"]); // skip excluded
		expect(results[0]!.ok).toBe(true);
		expect(results[1]!.ok).toBe(false);
	});

	it("exportHashes collects only successful exports' hashes for the manifest", async () => {
		const results = await runNotebookExports(catalog.notebooks, {
			executor: okExecutor,
			hashOutput: (p) => ({ algorithm: "sha256", value: `hash-of-${p}` }),
		});
		const hashes = exportHashes(results);
		expect(Object.keys(hashes).sort()).toEqual(["analise-grafo", "outro"]);
		expect(hashes["analise-grafo"]!.value).toBe("hash-of-lab/analise-grafo.html");
	});

	it("availableNotebookArtifacts keeps only reports that exported OK", async () => {
		const manifest = buildLabManifest(catalog, { producer: "t", producedAt: "2026-07-13T00:00:00Z" });
		const results = await runNotebookExports(catalog.notebooks, {
			executor: async () => ({ code: 0 }),
			hashOutput: () => ({ algorithm: "sha256", value: "h" }),
		});
		// Fail the second one after the fact to test filtering.
		results[1]!.ok = false;
		const available = availableNotebookArtifacts(manifest.artifacts, results);
		expect(available.map((a) => a.id)).toEqual(["analise-grafo"]);
	});
});

describe("createProcessHandoffExecutor — the reference executor over @refarm.dev/process-handoff", () => {
	it("runs a real command and captures its exit code + stdout (no launcher)", async () => {
		// Use node itself as a harmless 'export' stand-in: prints then exits 0.
		const exec = createProcessHandoffExecutor();
		const result = await exec("node", ["-e", "process.stdout.write('ok')"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("ok");
	});

	it("surfaces a non-zero exit code", async () => {
		const exec = createProcessHandoffExecutor();
		const result = await exec("node", ["-e", "process.exit(3)"]);
		expect(result.code).toBe(3);
	});

	it("applies a launcher prefix (the uvx --from marimo pattern) — exe+prefix wrap the command", async () => {
		// Launcher "printf" prefixes; the command ("hello") + args ("world") become printf's args,
		// so the composition is: printf hello world (printf prints "hello", ignoring extra args).
		const exec = createProcessHandoffExecutor({ launcher: "printf" });
		const result = await exec("hi\\n", []);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("hi\n");
	});
});
