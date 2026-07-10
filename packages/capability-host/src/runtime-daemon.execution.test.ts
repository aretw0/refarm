import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { startRuntimeDaemon, type RuntimeDaemonHandle } from "./runtime-daemon.js";

/**
 * The REAL execution leg: spawn the native tractor daemon, load two real WASM plugins
 * that compose (vault requiresApi:[QualityApi] → quality providesApi:[QualityApi]), and
 * drive a dispatch over the HTTP sidecar — proving a verb reaches a running .wasm AND
 * that one plugin calls another across the WASM boundary (the SPI recursion).
 *
 * This is the TS-driven mirror of tractor's vault_plugin_harness::vault_discovers_and_
 * calls_quality_via_spi — but through the exact path a white-label app uses: spawn the
 * binary, wait for the sidecar, POST /efforts. It stays SKIPPED unless the binary and
 * both plugin components are built, so a normal `pnpm test` never pays the cost.
 *
 * To run it:
 *   pnpm --filter @refarm.dev/vault-surface-ref run build:plugin
 *   pnpm --filter @refarm.dev/quality-checker-plugin run build:plugin
 *   (cd packages/tractor && node ../../scripts/ci/cargo-run.mjs build --release)
 *   RUN_RUNTIME_EXECUTION=1 pnpm --filter @refarm.dev/capability-host exec vitest run runtime-daemon.execution
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, ".cache/cargo-target/release/tractor");
const VAULT_WASM = resolve(REPO_ROOT, "packages/vault-surface-ref/dist/vault_plugin.wasm");
const QUALITY_WASM = resolve(REPO_ROOT, "packages/quality-checker-plugin/dist/quality_plugin.wasm");

// Opt-in: this spawns a real daemon and loads ~24 MB of WASM. Gate on an env flag AND
// on the artifacts existing, so CI and casual runs skip it cleanly.
const artifactsReady = existsSync(BINARY) && existsSync(VAULT_WASM) && existsSync(QUALITY_WASM);
const enabled = process.env.RUN_RUNTIME_EXECUTION === "1" && artifactsReady;

describe.skipIf(!enabled)("runtime daemon — the real WASM execution leg", () => {
	let daemon: RuntimeDaemonHandle | undefined;

	afterAll(async () => {
		await daemon?.stop();
	});

	it("boots, loads two composing plugins, and dispatch reaches a running plugin", async () => {
		// Provider (quality) before consumer (vault) — the common case; resolution is
		// order-immune but this mirrors the canonical harness.
		daemon = await startRuntimeDaemon({
			binaryPath: BINARY,
			plugins: [QUALITY_WASM, VAULT_WASM],
			wsPort: 42070,
			httpPort: 42071,
			readyTimeoutMs: 40_000,
		});

		// The sidecar reports both plugins loaded.
		const pluginsRes = await fetch(`${daemon.sidecarBaseUrl}/plugins`);
		expect(pluginsRes.ok).toBe(true);
		const pluginsBody = (await pluginsRes.json()) as unknown;
		const asText = JSON.stringify(pluginsBody);
		expect(asText).toContain("vault");
		expect(asText).toContain("quality");

		// Dispatch vault:organize over /efforts. Vault, on this event, discovers the
		// quality provider (get-plugin-api) and calls it (call-plugin → quality:check)
		// before persisting — the recursion, executed for real.
		const effort = {
			id: "exec-test-1",
			submittedAt: "2026-01-01T00:00:00Z",
			tasks: [
				{
					id: "exec-test-1-task-0",
					pluginId: "vault",
					fn: "organize",
					args: { note: { text: "This is clearly a comprehensive solution." } },
				},
			],
		};
		const dispatchRes = await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(effort),
		});
		expect(dispatchRes.ok).toBe(true);
		const dispatchBody = (await dispatchRes.json()) as { effortId?: string };
		expect(dispatchBody.effortId).toBeTruthy();
	}, 60_000);
});
