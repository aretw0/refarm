import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Governance evidence, EXECUTED on the Rust runtime: governance-audit --mock boots the
 * agent, scripts a real read_file tool call, and reports the host-effect:fs:read line the
 * HOST wrote to scarecrow-audit.ndjson — the tamper-evidence trail, not a TS literal.
 *
 * Gated on RUN_RUNTIME_EXECUTION=1 + built artifacts (agent.wasm, source_provider.wasm,
 * the tractor binary).
 *
 * To run it:
 *   pnpm --filter @refarm.dev/source-provider-ref run build:plugin
 *   pnpm --filter @refarm.dev/agent run build:wasm
 *   (cd packages/tractor && node ../../scripts/ci/cargo-run.mjs build --release)
 *   RUN_RUNTIME_EXECUTION=1 pnpm --filter devbench-t1 exec vitest run audit.execution
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

describe.skipIf(!enabled)("T1 governance-audit, executed on the Rust runtime", () => {
	it("reports the REAL host-effect:fs:read the host wrote to the audit trail", async () => {
		const { createGovernanceAuditCapability } = await import("./live-audit.js");
		const env = (await createGovernanceAuditCapability().run({
			args: {},
			options: { mock: true },
			json: true,
		})) as unknown as {
			ok: boolean;
			pluginsLoaded: string[];
			auditLineCount: number;
			hostEffects: Array<{ event: string }>;
		};
		expect(env.ok).toBe(true);
		expect(env.pluginsLoaded).toContain("agent");
		// The host wrote a tamper-evidence line for the agent's real fs read.
		expect(env.auditLineCount).toBeGreaterThan(0);
		expect(env.hostEffects.some((e) => e.event === "host-effect:fs:read")).toBe(true);
	}, 120_000);

	it("the SANDBOXED scarecrow observer witnesses the effect and records a verdict", async () => {
		const { createGovernanceAuditCapability } = await import("./live-audit.js");
		const env = (await createGovernanceAuditCapability().run({
			args: {},
			options: { mock: true, observer: true },
			json: true,
		})) as unknown as {
			ok: boolean;
			pluginsLoaded: string[];
			observerLoaded: boolean;
			observations: Array<{ effect: string; risk: string; verdict: string }>;
		};
		expect(env.ok).toBe(true);
		// The governor is itself a loaded, least-privileged extension.
		expect(env.pluginsLoaded).toContain("scarecrow");
		expect(env.observerLoaded).toBe(true);
		// It witnessed the agent's fs read and recorded a verdict — governance IN sandbox.
		const read = env.observations.find((o) => o.effect === "host-effect:fs:read");
		expect(read).toBeTruthy();
		expect(read?.risk).toBe("low");
		expect(read?.verdict).toBe("noted");
	}, 120_000);
});
