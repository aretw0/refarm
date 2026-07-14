import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Observability executed on the Rust runtime: agent-telemetry boots the agent, drives a scripted
 * multi-turn run, and projects the timeline (route, iterations, tool calls, tokens) from the
 * agent:* events the host wrote to the audit trail. Proves the events are real and the projection
 * reads them.
 *
 * Gated on RUN_RUNTIME_EXECUTION=1 + built artifacts.
 *   RUN_RUNTIME_EXECUTION=1 pnpm --filter devbench-t1 exec vitest run telemetry.execution
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

describe.skipIf(!enabled)("T1 agent-telemetry, executed on the Rust runtime", () => {
	it("reports a real execution timeline (route + iterations + tool calls + tokens)", async () => {
		const { createAgentTelemetryCapability } = await import("./live-telemetry.js");
		const env = (await createAgentTelemetryCapability().run({
			args: {},
			options: { mock: true },
			json: true,
		})) as unknown as {
			ok: boolean;
			pluginsLoaded: string[];
			eventCount: number;
			timeline: {
				route?: { provider?: string; model?: string };
				iterations: number;
				toolCalls: Array<{ tool: string }>;
				outcome: string;
				tokensIn: number;
				tokensOut: number;
			};
		};
		expect(env.ok).toBe(true);
		expect(env.pluginsLoaded).toContain("agent");
		// The run emitted agent:* lifecycle events the host recorded.
		expect(env.eventCount).toBeGreaterThan(0);
		// The scripted multi-turn run iterated and called the read_file tool.
		expect(env.timeline.iterations).toBeGreaterThanOrEqual(1);
		expect(env.timeline.toolCalls.some((c) => c.tool === "read_file")).toBe(true);
		// A route was selected (ADR-012 audit) and the run finished with the scripted tokens.
		expect(env.timeline.route?.provider).toBeTruthy();
		expect(env.timeline.outcome).toBe("done");
		expect(env.timeline.tokensIn).toBeGreaterThan(0);
	}, 180_000);
});
