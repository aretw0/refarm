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
	it("the `code-ops find-references` VERB dispatches to the sandboxed lsp-code-ops plugin", async () => {
		const { createCodeOpsCapability } = await import("./live-code-ops.js");
		const verb = createCodeOpsCapability();
		const env = (await verb.run({
			args: { verb: "find-references" },
			options: { line: "1", column: "5" },
			json: true,
		})) as unknown as {
			ok: boolean;
			pluginsLoaded: string[];
			dispatched: boolean;
			result?: unknown;
		};
		expect(env.ok).toBe(true);
		expect(env.pluginsLoaded).toContain("lsp-code-ops");
		// The dispatch reached the plugin (the fix for key ≠ id routing) and a result
		// came back from the fake LSP — find-references returns an array of locations.
		expect(env.dispatched).toBe(true);
		expect(Array.isArray(env.result)).toBe(true);
		expect((env.result as unknown[]).length).toBeGreaterThan(0);
	}, 120_000);

	it("the `code-ops rename-symbol` VERB returns a rename summary from the plugin", async () => {
		const { createCodeOpsCapability } = await import("./live-code-ops.js");
		const verb = createCodeOpsCapability();
		const env = (await verb.run({
			args: { verb: "rename-symbol" },
			options: { line: "1", column: "5", "new-name": "renamed" },
			json: true,
		})) as unknown as { ok: boolean; dispatched: boolean; result?: Record<string, unknown> };
		expect(env.ok).toBe(true);
		expect(env.dispatched).toBe(true);
		expect(env.result).toBeTruthy();
	}, 120_000);
});
