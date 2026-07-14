import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T1's recursion one turn deeper, EXECUTED on the canonical Rust runtime: a PLUGIN
 * (the delegate) orchestrates the agent. The bench's `delegate-run --mock` boots
 * [agent, delegate], dispatches a `delegate:single`, and the delegate runs the task
 * through the agent under a persona via host-mediated call_plugin — the sub-agent's
 * answer threads back as a DispatchResult node. No token, no real model (the mock
 * scripts the sub-agent's reply).
 *
 * Gated on RUN_RUNTIME_EXECUTION=1 + built artifacts (agent.wasm, delegate plugin.wasm,
 * the tractor binary), so a normal `pnpm test` skips it at zero cost.
 *
 * To run it:
 *   (cd packages/agent && cargo component build --release)
 *   pnpm --filter delegate run build:wasm
 *   (cd packages/tractor && node ../../scripts/ci/cargo-run.mjs build --release)
 *   RUN_RUNTIME_EXECUTION=1 pnpm --filter devbench-t1 exec vitest run delegation.execution
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, ".cache/cargo-target/release/tractor");
const AGENT_WASM = resolve(REPO_ROOT, "packages/agent/dist/agent.wasm");
const DELEGATE_WASM = resolve(REPO_ROOT, "packages/delegate/dist/plugin.wasm");

const artifactsReady = existsSync(BINARY) && existsSync(AGENT_WASM) && existsSync(DELEGATE_WASM);
const enabled = process.env.RUN_RUNTIME_EXECUTION === "1" && artifactsReady;

describe.skipIf(!enabled)("T1 delegation, executed on the Rust runtime", () => {
	it("the `delegate-run --mock` VERB drives plugin → agent delegation end to end", async () => {
		const { createDelegateRunCapability } = await import("./live-delegation.js");
		const verb = createDelegateRunCapability();
		const env = (await verb.run({
			args: { task: "find where the config lives" },
			options: { persona: "scout", mock: true },
			json: true,
		})) as unknown as {
			ok: boolean;
			pluginsLoaded: string[];
			dispatched: boolean;
			recursion: string;
			content?: string;
		};
		expect(env.ok).toBe(true);
		expect(env.pluginsLoaded).toContain("delegate");
		expect(env.dispatched).toBe(true);
		expect(env.recursion).toContain("delegate → agent:respond");
		// The sub-agent's scripted reply threaded back through the delegate.
		expect(env.content).toContain("scout");
	}, 120_000);
});
