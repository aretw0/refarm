import {
	installPluginForRuntime,
	startRuntimeDaemon,
	type RuntimeDaemonHandle,
} from "@refarm.dev/capability-host/node";
import { ModelMockServer, says, toolCall } from "@refarm.dev/model-mock";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * T1's headline, EXECUTED on the canonical Rust runtime: the coding-agent is itself a
 * plugin, and it uses another plugin (a source provider) through the host — extensions
 * extending extensions. The native daemon loads the real @refarm/agent (installed with
 * entry+integrity, as farmhand does) plus the source provider; a mocked LLM scripts the
 * agent to call the provider's verb as a tool; we assert the agent reached the model
 * (the tool-call round-trip began). No token, no real model.
 *
 * Gated on RUN_RUNTIME_EXECUTION=1 + built artifacts (agent.wasm, source_provider.wasm,
 * the tractor binary), so a normal `pnpm test` skips it at zero cost.
 *
 * To run it:
 *   pnpm --filter @refarm.dev/source-provider-ref run build:plugin
 *   (cd packages/agent && cargo component build --release)
 *   (cd packages/tractor && node ../../scripts/ci/cargo-run.mjs build --release)
 *   RUN_RUNTIME_EXECUTION=1 pnpm --filter devbench-t1 exec vitest run recursion.execution
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, ".cache/cargo-target/release/tractor");
const AGENT_WASM = resolve(REPO_ROOT, "packages/agent/dist/agent.wasm");
const AGENT_MANIFEST = resolve(REPO_ROOT, "packages/agent/dist/plugin.json");
const SOURCE_WASM = resolve(REPO_ROOT, "packages/source-provider-ref/dist/source_provider.wasm");

const artifactsReady =
	existsSync(BINARY) &&
	existsSync(AGENT_WASM) &&
	existsSync(AGENT_MANIFEST) &&
	existsSync(SOURCE_WASM);
const enabled = process.env.RUN_RUNTIME_EXECUTION === "1" && artifactsReady;

describe.skipIf(!enabled)("T1 recursion, executed on the Rust runtime", () => {
	let daemon: RuntimeDaemonHandle | undefined;
	let mock: ModelMockServer | undefined;

	afterAll(async () => {
		await daemon?.stop();
		await mock?.stop();
	});

	it("loads the real agent (installed) + a provider, and the agent reaches the model to call a tool", async () => {
		// The agent's dist/plugin.json is a template (no entry/integrity by design —
		// farmhand injects them at install). Install it the same way so the native
		// runtime can load it via --plugin.
		const agentInstall = installPluginForRuntime({
			wasmPath: AGENT_WASM,
			manifestTemplatePath: AGENT_MANIFEST,
			installDir: mkdtempSync(join(tmpdir(), "t1-agent-")),
		});

		// The mocked LLM: first turn calls the source provider's discover verb as a tool,
		// then a final message so the agent completes.
		mock = await new ModelMockServer({ repeatLast: true }).start();
		mock
			.queue(toolCall("source-discover", { method: "discover" }))
			.queue(says("Discovered the available sources."));

		daemon = await startRuntimeDaemon({
			binaryPath: BINARY,
			plugins: [SOURCE_WASM, agentInstall.wasmPath],
			wsPort: 42064,
			httpPort: 42065,
			securityMode: "none",
			readyTimeoutMs: 40_000,
			env: mock.env,
		});

		// The runtime reports the agent loaded and active.
		const pluginsBody = JSON.stringify(
			await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json(),
		);
		expect(pluginsBody).toContain("agent");

		// Drive the agent with a prompt. Its respond flow calls the model (the mock),
		// which scripts a tool call to the provider.
		const effort = {
			id: "t1-exec-1",
			submittedAt: "2026-01-01T00:00:00Z",
			tasks: [
				{
					id: "t1-exec-1-task-0",
					pluginId: "agent",
					fn: "respond",
					args: { prompt: "What sources are available?" },
				},
			],
		};
		const res = await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(effort),
		});
		expect(res.ok).toBe(true);

		// The proof the agent executed: it reached the model (the mock captured a request).
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline && mock.requests.length === 0) {
			await new Promise((r) => setTimeout(r, 250));
		}
		expect(mock.requests.length).toBeGreaterThan(0);
	}, 80_000);
});
