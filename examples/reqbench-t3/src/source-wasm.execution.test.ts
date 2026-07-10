import {
	createSidecarCallRespond,
	createLocalRecordsCapabilityDeps,
	installPluginForRuntime,
	startRuntimeDaemon,
	type RuntimeDaemonHandle,
} from "@refarm.dev/capability-host/node";
import { createWasmSourceProvider, defineCapabilityHost } from "@refarm.dev/capability-host";
import { createCapabilityTestHarness } from "@refarm.dev/capability-host/testing";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createRequirementsCapability } from "./persona.js";
import { reqManifest } from "./fixture.js";

/**
 * The "import less, extend more" cord, felt in T3: reqbench today IMPORTS its source
 * provider (@refarm.dev/source-web) and runs it in-process. This test feels the other
 * way — the source arrives as a LOADED WASM plugin, called over the sidecar, with the
 * requirements persona mounted on top exactly as production is. It proves T3 CAN run its
 * source as an extension (no provider import), so we can decide the persona's final shape
 * with the assembly cost measured, not guessed. The production persona.ts stays untouched.
 *
 * Gated + skips at zero cost without RUN_RUNTIME_EXECUTION=1 and the built artifacts.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, ".cache/cargo-target/release/tractor");
const SOURCE_WASM = resolve(REPO_ROOT, "packages/source-provider-ref/dist/source_provider.wasm");
const SOURCE_MANIFEST = resolve(REPO_ROOT, "packages/source-provider-ref/dist/plugin.json");

const artifactsReady = existsSync(BINARY) && existsSync(SOURCE_WASM) && existsSync(SOURCE_MANIFEST);
const enabled = process.env.RUN_RUNTIME_EXECUTION === "1" && artifactsReady;

const harness = createCapabilityTestHarness({ tempPrefix: "dgk-req-wasm-" });

describe.skipIf(!enabled)(
	"reqbench T3 — source as a loaded WASM plugin (extend, not import)",
	() => {
		let daemon: RuntimeDaemonHandle | undefined;

		afterAll(async () => {
			await daemon?.stop();
			harness.cleanup();
		});

		it("mounts the requirements persona on a WASM-backed source and discovers via the plugin", async () => {
			// THE ASSEMBLY COST, made visible: boot runtime → load the source plugin →
			// bind a callRespond → wrap as a SourceProvider → hand it to the records deps.
			// This is what the persona would take on if it stopped importing source-web.
			const install = installPluginForRuntime({
				wasmPath: SOURCE_WASM,
				manifestTemplatePath: SOURCE_MANIFEST,
				installDir: mkdtempSync(join(tmpdir(), "req-source-")),
			});
			daemon = await startRuntimeDaemon({
				binaryPath: BINARY,
				plugins: [install.wasmPath],
				wsPort: 42068,
				httpPort: 42069,
				securityMode: "none",
				readyTimeoutMs: 40_000,
			});

			const callRespond = createSidecarCallRespond({
				baseUrl: daemon.sidecarBaseUrl,
				pluginId: "source-provider-ref",
			});
			const sourceProvider = createWasmSourceProvider({
				pluginId: "source-provider-ref",
				callRespond,
			});

			const { deps, records } = createLocalRecordsCapabilityDeps({
				seed: reqManifest,
				statePath: harness.tempStatePath(),
				source: { sourceProvider },
			});

			const host = defineCapabilityHost({
				id: "examples/reqbench-t3#wasm",
				command: "dgk",
				description: "reqbench with a WASM-backed source",
				version: "0.0.0",
				capabilities: () => ({ deps, extensions: [createRequirementsCapability(records)] }),
			});

			// The analyst's `source discover` now routes through the loaded plugin.
			const found = await harness.runGroup(host.registry(), "source", ["discover"]);
			const refs = (found.sources as Array<{ ref: string }>).map((s) => s.ref);
			expect(refs).toContain("wasm:sample-system-a");
		}, 60_000);
	},
);
