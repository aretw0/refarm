import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/capability-host";
import {
	installPluginForRuntime,
	startRuntimeDaemon,
	type RuntimeDaemonHandle,
} from "@refarm.dev/capability-host/node";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * LIVE CODE-OPS — the editor plugin as a real, sandboxed component. `lsp-code-ops`
 * (a WASM plugin, tested in tractor's agent_harness, until now with no consumer)
 * imports the host `code-ops` interface (LSP-backed rename / find-references) and
 * surfaces those as dispatchable verbs. This bench verb boots it and dispatches a
 * `code-ops:find-references` / `code-ops:rename-symbol` directly — editor operations
 * arriving as a loaded extension, not built into the host.
 *
 * The code-ops import is backed by an LSP process (rust-analyzer in production). For a
 * self-contained demo, `REFACTOR_LSP_CMD` points at a vendored fake LSP (the same
 * shape the harness uses), so the demo proves the sandboxed plugin without a real
 * language server. This is exactly what the T1 IDE surface consumes: rename /
 * find-references, contributed by an extension.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const FAKE_LSP = resolve(HERE, "..", "fixtures", "fake-lsp.py");

export interface LiveCodeOpsArtifacts {
	tractorBinary: string;
	lspCodeOpsWasm: string;
	lspCodeOpsManifest: string;
}

export function defaultCodeOpsArtifacts(): LiveCodeOpsArtifacts {
	return {
		tractorBinary: process.env.TRACTOR_BINARY ?? resolve(REPO_ROOT, ".cache/cargo-target/release/tractor"),
		lspCodeOpsWasm: resolve(REPO_ROOT, "packages/lsp-code-ops/dist/plugin.wasm"),
		lspCodeOpsManifest: resolve(REPO_ROOT, "packages/lsp-code-ops/dist/plugin.json"),
	};
}

export function missingCodeOpsArtifacts(a: LiveCodeOpsArtifacts): string[] {
	const missing = Object.entries(a)
		.filter(([, p]) => !existsSync(p))
		.map(([k]) => k);
	if (!existsSync(FAKE_LSP)) missing.push("fakeLsp");
	return missing;
}

export interface LiveCodeOpsResult {
	pluginsLoaded: string[];
	dispatched: boolean;
	/** The verb's result payload — an array of locations (find-references) or a rename
	 * summary object (rename-symbol), verbatim from the plugin. */
	result?: unknown;
}

export interface RunLiveCodeOpsOptions {
	verb: "find-references" | "rename-symbol" | "move-symbol";
	file: string;
	line: number;
	column: number;
	newName?: string;
	/** move-symbol: the destination file (must already exist — the workspace edit machinery
	 * edits existing files; a real server that creates the file uses documentChanges/CreateFile). */
	targetFile?: string;
	artifacts?: LiveCodeOpsArtifacts;
	wsPort?: number;
	httpPort?: number;
	onDaemon?: (daemon: RuntimeDaemonHandle) => void;
	resultTimeoutMs?: number;
	/** Override the LSP command (defaults to the vendored fake LSP). */
	lspCmd?: string;
}

async function awaitDispatchResult(
	sidecarBaseUrl: string,
	replyRef: string,
	timeoutMs: number,
): Promise<Record<string, unknown> | undefined> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const res = await fetch(`${sidecarBaseUrl}/nodes?type=DispatchResult`);
		if (res.ok) {
			const body = (await res.json()) as { nodes?: Array<Record<string, unknown>> };
			const nodes = Array.isArray(body.nodes) ? body.nodes : [];
			const match = nodes.find((n) => n.replyRef === replyRef);
			if (match) return match;
		}
		await new Promise((r) => setTimeout(r, 150));
	}
	return undefined;
}

/**
 * Boot [lsp-code-ops] with the code-ops LSP backing, dispatch the verb, and return
 * its result. Always stops the daemon.
 */
export async function runLiveCodeOps(options: RunLiveCodeOpsOptions): Promise<LiveCodeOpsResult> {
	const artifacts = options.artifacts ?? defaultCodeOpsArtifacts();
	const install = installPluginForRuntime({
		wasmPath: artifacts.lspCodeOpsWasm,
		manifestTemplatePath: artifacts.lspCodeOpsManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-codeops-")),
	});

	// A source file the fake LSP "operates on" — its content is irrelevant to the fake
	// (it returns fixed ranges), but the plugin passes a real path through.
	const workDir = mkdtempSync(join(tmpdir(), "t1-codeops-src-"));
	const sourceFile = options.file || join(workDir, "lib.rs");
	if (!existsSync(sourceFile)) writeFileSync(sourceFile, "let old = old;\n", "utf-8");

	let daemon: RuntimeDaemonHandle | undefined;
	try {
		daemon = await startRuntimeDaemon({
			binaryPath: artifacts.tractorBinary,
			plugins: [install.wasmPath],
			wsPort: options.wsPort ?? 42068,
			httpPort: options.httpPort ?? 42069,
			securityMode: "none",
			readyTimeoutMs: 40_000,
			// File-backed store so the plugin's DispatchResult is visible to GET /nodes.
			namespace: mkdtempSync(join(tmpdir(), "t1-codeops-store-")),
			// The code-ops import is backed by this LSP command — the vendored fake by
			// default, so the demo is self-contained (no rust-analyzer needed).
			env: { REFACTOR_LSP_CMD: options.lspCmd ?? `python3 ${FAKE_LSP}` },
		});
		options.onDaemon?.(daemon);

		const plugins = (await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json()) as { loaded?: string[] };
		const pluginsLoaded = Array.isArray(plugins.loaded) ? plugins.loaded : [];

		const replyRef = `t1-codeops-${Date.now()}`;
		const args: Record<string, unknown> = {
			file: sourceFile,
			line: options.line,
			column: options.column,
			replyRef,
		};
		if (options.verb === "rename-symbol") args.new_name = options.newName ?? "renamed";
		if (options.verb === "move-symbol") args.target_file = options.targetFile ?? "";

		const effort = {
			id: replyRef,
			direction: "dispatch",
			source: "operator",
			submittedAt: new Date().toISOString(),
			// The dispatch event is <pluginKey>:dispatch. lsp-code-ops declares an explicit
			// verbs.key "code-ops" (≠ its plugin id), so route by the KEY "code-ops"; the
			// runtime resolves it back to the plugin's channel (a tractor fix landed for the
			// key ≠ id case).
			tasks: [{ id: `${replyRef}-task-0`, pluginId: "code-ops", fn: options.verb, args }],
		};
		const res = await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(effort),
		});
		if (!res.ok) return { pluginsLoaded, dispatched: false };

		const node = await awaitDispatchResult(daemon.sidecarBaseUrl, replyRef, options.resultTimeoutMs ?? 30_000);
		return {
			pluginsLoaded,
			// The dispatch reached the plugin iff its result node came back.
			dispatched: node !== undefined,
			result: node?.result,
		};
	} finally {
		await daemon?.stop();
	}
}

/**
 * `code-ops <find-references|rename-symbol> --file <f> --line <n> --column <n> [--new-name <s>]`
 * — run a rename / find-references through the sandboxed lsp-code-ops plugin. The
 * editor operation the T1 IDE surface contributes, proven as a loaded extension.
 */
export function createCodeOpsCapability(): CapabilityDescriptor {
	return {
		name: "code-ops",
		summary: "Run rename / find-references / move-symbol through the sandboxed lsp-code-ops plugin (an editor extension)",
		args: [{ name: "verb", required: true }],
		options: [
			{ name: "file", kind: "string", summary: "The source file the symbol is in" },
			{ name: "line", kind: "string", summary: "1-based line of the symbol" },
			{ name: "column", kind: "string", summary: "1-based column of the symbol" },
			{ name: "new-name", kind: "string", summary: "The new name (rename-symbol only)" },
			{ name: "target-file", kind: "string", summary: "The destination file (move-symbol only)" },
		],
		transports: { http: { path: "/code-ops" } },
		renderers: { tui: { section: "agent" }, web: { route: "/code-ops", icon: "edit" }, ide: { command: "dgk.code-ops" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const verb = String(input.args.verb ?? "");
			if (verb !== "find-references" && verb !== "rename-symbol" && verb !== "move-symbol") {
				return buildJsonErrorEnvelope({
					command: "code-ops",
					operation: "code-ops",
					error: "bad_verb",
					message: "Pass a verb: find-references, rename-symbol, or move-symbol.",
					nextAction: 'dgk code-ops find-references --line 1 --column 5',
				});
			}
			const artifacts = defaultCodeOpsArtifacts();
			const missing = missingCodeOpsArtifacts(artifacts);
			if (missing.length > 0) {
				return buildJsonErrorEnvelope({
					command: "code-ops",
					operation: "code-ops",
					error: "artifacts_missing",
					message: `Build the runtime artifacts first (missing: ${missing.join(", ")}).`,
					nextAction:
						"pnpm --filter @refarm.dev/tractor run build && pnpm --filter @refarm.dev/lsp-code-ops run build:wasm",
				});
			}
			const line = Number(input.options?.line ?? 1);
			const column = Number(input.options?.column ?? 5);
			try {
				const result = await runLiveCodeOps({
					verb,
					file: typeof input.options?.file === "string" ? input.options.file : "",
					line,
					column,
					...(typeof input.options?.["new-name"] === "string"
						? { newName: input.options["new-name"] as string }
						: {}),
					...(typeof input.options?.["target-file"] === "string"
						? { targetFile: input.options["target-file"] as string }
						: {}),
				});
				return buildJsonSuccessEnvelope({
					command: "code-ops",
					operation: "code-ops",
					nextCommand: "dgk ide",
					nextCommands: ["dgk ide"],
					extra: {
						verb,
						pluginsLoaded: result.pluginsLoaded,
						surfaced: "code-ops:{find-references,rename-symbol} — contributed by a loaded WASM extension",
						dispatched: result.dispatched,
						...(result.result ? { result: result.result } : {}),
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "code-ops",
					operation: "code-ops",
					error: "code_ops_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the tractor binary + lsp-code-ops built, and python3 is runnable for the fake LSP.",
				});
			}
		},
	};
}
