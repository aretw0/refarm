import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The editor plugin, EXECUTED on the canonical Rust runtime: `code-ops --mock`-free
 * (it uses a vendored fake LSP, not a real model). The bench boots [lsp-code-ops],
 * points its code-ops import at the fake LSP via REFACTOR_LSP_CMD, dispatches
 * find-references / rename-symbol, and reads the result back — editor operations
 * arriving as a loaded, sandboxed extension.
 *
 * Gated on RUN_RUNTIME_EXECUTION=1 + built artifacts (lsp-code-ops plugin.wasm, the
 * tractor binary) + python3, so a normal `pnpm test` skips it at zero cost.
 *
 * To run it:
 *   pnpm --filter @refarm.dev/lsp-code-ops run build:wasm
 *   (cd packages/tractor && node ../../scripts/ci/cargo-run.mjs build --release)
 *   RUN_RUNTIME_EXECUTION=1 pnpm --filter devbench-t1 exec vitest run code-ops.execution
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, ".cache/cargo-target/release/tractor");
const LSP_WASM = resolve(REPO_ROOT, "packages/lsp-code-ops/dist/plugin.wasm");

function python3Available(): boolean {
	try {
		execSync("python3 --version", { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

const artifactsReady = existsSync(BINARY) && existsSync(LSP_WASM) && python3Available();
const enabled = process.env.RUN_RUNTIME_EXECUTION === "1" && artifactsReady;

describe.skipIf(!enabled)("T1 code-ops, executed on the Rust runtime", () => {
	// Each test boots its own daemon; give them distinct ports so a slow shutdown of one
	// never collides with the next test's boot (they run sequentially in this file).
	it("find-references dispatches to the sandboxed lsp-code-ops plugin", async () => {
		const { runLiveCodeOps } = await import("./live-code-ops.js");
		const r = await runLiveCodeOps({ verb: "find-references", file: "", line: 1, column: 5, wsPort: 42070, httpPort: 42071 });
		expect(r.pluginsLoaded).toContain("lsp-code-ops");
		// The dispatch reached the plugin (the key ≠ id routing fix) and a result came back.
		expect(r.dispatched).toBe(true);
		expect(Array.isArray(r.result)).toBe(true);
		expect((r.result as unknown[]).length).toBeGreaterThan(0);
	}, 120_000);

	it("rename-symbol returns a rename summary from the plugin", async () => {
		const { runLiveCodeOps } = await import("./live-code-ops.js");
		const r = await runLiveCodeOps({ verb: "rename-symbol", file: "", line: 1, column: 5, newName: "renamed", wsPort: 42072, httpPort: 42073 });
		expect(r.dispatched).toBe(true);
		expect((r.result as { filesChanged?: number }).filesChanged).toBeGreaterThan(0);
	}, 120_000);

	it("move-symbol moves a symbol to another file (server-dependent workspace edit)", async () => {
		const { mkdtempSync, writeFileSync } = await import("node:fs");
		const os = await import("node:os");
		const path = await import("node:path");
		const { runLiveCodeOps } = await import("./live-code-ops.js");

		// The workspace-edit machinery edits EXISTING files, so both source + target exist.
		const dir = mkdtempSync(path.join(os.tmpdir(), "codeops-move-"));
		const src = path.join(dir, "src.rs");
		const target = path.join(dir, "target.rs");
		writeFileSync(src, "let old = old;\n");
		writeFileSync(target, "// destination\n");

		const r = await runLiveCodeOps({ verb: "move-symbol", file: src, line: 1, column: 5, targetFile: target, wsPort: 42074, httpPort: 42075 });
		expect(r.dispatched).toBe(true);
		// The move edited both files (delete at source, insert at target).
		expect((r.result as { filesChanged?: number }).filesChanged).toBe(2);
	}, 120_000);
});
