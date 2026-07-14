import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Hot-reload executed on the Rust runtime: plugin-reload boots the agent, hot-reloads it via
 * POST /plugins/reload (a real code swap through TractorNative::reload_plugin), and confirms the
 * host STAYED UP — the agent dispatches again afterward. Runtime tinkering, no restart.
 *
 * Gated on RUN_RUNTIME_EXECUTION=1 + built artifacts.
 *
 * To run it:
 *   RUN_RUNTIME_EXECUTION=1 pnpm --filter devbench-t1 exec vitest run reload.execution
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, ".cache/cargo-target/release/tractor");
const AGENT_WASM = resolve(REPO_ROOT, "packages/agent/dist/agent.wasm");
const SOURCE_WASM = resolve(REPO_ROOT, "packages/source-provider-ref/dist/source_provider.wasm");

const enabled =
	process.env.RUN_RUNTIME_EXECUTION === "1" &&
	existsSync(BINARY) &&
	existsSync(AGENT_WASM) &&
	existsSync(SOURCE_WASM);

describe.skipIf(!enabled)("T1 plugin-reload, executed on the Rust runtime", () => {
	it("hot-reloads the agent without restarting the host, and it still dispatches", async () => {
		const { createPluginReloadCapability } = await import("./live-reload.js");
		const env = (await createPluginReloadCapability().run({
			args: {},
			options: {},
			json: true,
		})) as unknown as {
			ok: boolean;
			reloaded: string[];
			respondedAfterReload: boolean;
			hotReloaded: boolean;
		};
		expect(env.ok).toBe(true);
		// The host swapped the agent's code in place …
		expect(env.reloaded).toContain("agent");
		// … and stayed up: the agent dispatches again after the reload.
		expect(env.respondedAfterReload).toBe(true);
		expect(env.hotReloaded).toBe(true);
	}, 180_000);
});
