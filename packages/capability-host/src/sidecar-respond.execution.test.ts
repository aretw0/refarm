import { createWasmSourceProvider } from "@refarm.dev/capabilities-v1";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createSidecarCallRespond } from "./sidecar-respond.js";
import { startRuntimeDaemon, type RuntimeDaemonHandle } from "./runtime-daemon.js";

/**
 * The "import less, extend more" cord, EXECUTED: use a WASM source provider against a
 * running runtime — no TS import of the provider's code. Boot the daemon with the real
 * source_provider.wasm, build a CallRespond bound to it via the sidecar, wrap it as a
 * SourceProvider, and call discover — the reply crosses the WASM boundary over HTTP.
 *
 * This proves the seam an example needs to declare its source as a loaded plugin instead
 * of importing @refarm.dev/source-web in-process. Gated + skips at zero cost.
 *
 * To run it:
 *   pnpm --filter @refarm.dev/source-provider-ref run build:plugin
 *   (cd packages/tractor && node ../../scripts/ci/cargo-run.mjs build --release)
 *   RUN_RUNTIME_EXECUTION=1 pnpm --filter @refarm.dev/capability-host exec vitest run sidecar-respond.execution
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, ".cache/cargo-target/release/tractor");
const SOURCE_WASM = resolve(REPO_ROOT, "packages/source-provider-ref/dist/source_provider.wasm");

const enabled =
	process.env.RUN_RUNTIME_EXECUTION === "1" && existsSync(BINARY) && existsSync(SOURCE_WASM);

describe.skipIf(!enabled)("WASM source provider over the sidecar — the extend-not-import cord", () => {
	let daemon: RuntimeDaemonHandle | undefined;

	afterAll(async () => {
		await daemon?.stop();
	});

	it("discovers via a loaded plugin, called over HTTP — no provider import", async () => {
		daemon = await startRuntimeDaemon({
			binaryPath: BINARY,
			plugins: [SOURCE_WASM],
			wsPort: 42066,
			httpPort: 42067,
			securityMode: "none",
			readyTimeoutMs: 40_000,
		});

		// The seam under test: a real callRespond bound to the loaded plugin.
		const callRespond = createSidecarCallRespond({
			baseUrl: daemon.sidecarBaseUrl,
			pluginId: "source-provider-ref",
		});
		const provider = createWasmSourceProvider({ pluginId: "source-provider-ref", callRespond });

		// discover() marshals `source:discover` over the sidecar to the plugin's WASM.
		const catalog = await provider.discover();
		expect(Array.isArray(catalog.entries)).toBe(true);
		expect(catalog.entries.length).toBeGreaterThan(0);
	}, 60_000);
});
