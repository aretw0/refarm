import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Resilience executed on the Rust runtime: plugin-resilience boots [agent, crash-plugin], fires
 * the crash plugin's runaway on_event (spins forever), and confirms the host trapped it under the
 * epoch budget, respawned, and STILL serves (the agent responds after). A bad extension does not
 * bring the sovereign machine down.
 *
 * Gated on RUN_RUNTIME_EXECUTION=1 + built artifacts (including the committed crash-plugin.wasm).
 *   RUN_RUNTIME_EXECUTION=1 pnpm --filter devbench-t1 exec vitest run resilience.execution
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, ".cache/cargo-target/release/tractor");
const AGENT_WASM = resolve(REPO_ROOT, "packages/agent/dist/agent.wasm");
const SOURCE_WASM = resolve(REPO_ROOT, "packages/source-provider-ref/dist/source_provider.wasm");
const CRASH_WASM = resolve(REPO_ROOT, "packages/tractor/tests/fixtures/crash-plugin.wasm");

const enabled =
	process.env.RUN_RUNTIME_EXECUTION === "1" &&
	existsSync(BINARY) &&
	existsSync(AGENT_WASM) &&
	existsSync(SOURCE_WASM) &&
	existsSync(CRASH_WASM);

describe.skipIf(!enabled)("T1 plugin-resilience, executed on the Rust runtime", () => {
	it("traps a runaway plugin and keeps serving — the host survives a crash", async () => {
		const { createPluginResilienceCapability } = await import("./live-resilience.js");
		const env = (await createPluginResilienceCapability().run({
			args: {},
			options: {},
			json: true,
		})) as unknown as {
			ok: boolean;
			pluginsLoaded: string[];
			crashDispatched: boolean;
			survivedAndResponds: boolean;
			resilient: boolean;
		};
		expect(env.ok).toBe(true);
		// Both the agent and the crash plugin loaded.
		expect(env.pluginsLoaded).toContain("agent");
		expect(env.pluginsLoaded).toContain("crash-plugin");
		// The runaway was dispatched (POST accepted), and — the real proof — the agent COMPLETED a
		// respond cycle AFTER the crash (agent:response:done observed in the audit trail), not just a
		// 200 on an async dispatch. The host trapped+respawned the runaway and kept serving.
		expect(env.crashDispatched).toBe(true);
		expect(env.survivedAndResponds).toBe(true);
		expect(env.resilient).toBe(true);
	}, 180_000);
});
