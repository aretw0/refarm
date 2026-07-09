import { createWasmEnrichmentProvider } from "@refarm.dev/capabilities-v1";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createSidecarCallRespond } from "./sidecar-respond.js";
import { startRuntimeDaemon, type RuntimeDaemonHandle } from "./runtime-daemon.js";

/**
 * The enrichment twin of the extend-not-import cord: a domain lookup as a LOADED WASM
 * plugin, called over the sidecar — no TS import of the provider. Boot the daemon with
 * enrichment_provider.wasm, bind a CallRespond, wrap it via createWasmEnrichmentProvider,
 * and enrich an input keyed by externalKey — the lookup crosses the WASM boundary over
 * HTTP. Proves the seam an example (reqbench) needs to declare its enrichment as an
 * extension instead of importing @refarm.dev/enrichment-contract-v1's reference provider.
 *
 * The manifest ships entry+integrity, so it loads via --plugin directly (no install
 * step). Gated + skips at zero cost.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, ".cache/cargo-target/release/tractor");
const ENRICH_WASM = resolve(
	REPO_ROOT,
	"packages/enrichment-provider-ref/dist/enrichment_provider.wasm",
);

const enabled =
	process.env.RUN_RUNTIME_EXECUTION === "1" && existsSync(BINARY) && existsSync(ENRICH_WASM);

describe.skipIf(!enabled)("WASM enrichment provider over the sidecar — the extend-not-import twin", () => {
	let daemon: RuntimeDaemonHandle | undefined;

	afterAll(async () => {
		await daemon?.stop();
	});

	it("enriches via a loaded plugin, called over HTTP — no provider import", async () => {
		daemon = await startRuntimeDaemon({
			binaryPath: BINARY,
			plugins: [ENRICH_WASM],
			wsPort: 42072,
			httpPort: 42073,
			securityMode: "none",
			readyTimeoutMs: 40_000,
		});

		const callRespond = createSidecarCallRespond({
			baseUrl: daemon.sidecarBaseUrl,
			pluginId: "enrichment-provider-ref",
		});
		const provider = createWasmEnrichmentProvider({
			pluginId: "enrichment-provider-ref",
			callRespond,
			keyField: "externalKey",
		});

		// select() is local; enrich() marshals over the sidecar to the plugin's WASM.
		const inputs = [
			{ id: "req-1", fields: { externalKey: "REQ-1" } },
			{ id: "req-x", fields: { externalKey: "UNKNOWN" } },
		];
		const selected = provider.select(inputs);
		expect(selected).toHaveLength(2); // both carry the key field

		const result = await provider.enrich(selected, { mode: "dry-run" });
		expect(result.mode).toBe("dry-run");
		// REQ-1 resolves to two domain fields; UNKNOWN is skipped (no-key).
		const enrichedRecord = result.records.find((r) => r.id === "req-1");
		expect(enrichedRecord?.changes.map((c) => c.field).sort()).toEqual([
			"req.modulo",
			"req.prioridade",
		]);
		expect(result.diagnostics.enriched).toBe(1);
		expect(result.diagnostics.skipped).toBe(1);
	}, 60_000);
});
