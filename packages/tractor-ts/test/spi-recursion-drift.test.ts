import { describe, expect, it } from "vitest";

import { WasiImports, type CrossPluginBridge } from "../src/lib/wasi-imports";
import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import type { ExecutionProfile } from "../src/lib/trust-manager";

/**
 * THE CONSUMER THAT FORCES THE DROID: the plugin-to-plugin (SPI) recursion works and is
 * proven in the Rust host (tractor vault_plugin_harness), but the TS/jco host has drifted
 * — a plugin running under tractor-ts cannot reach another plugin's API. This test is the
 * consumer that makes that drift a concrete, failing fact instead of a silent gap.
 *
 * The drift, precisely:
 *   - WasiImports.generate() exposes `get-plugin-api` as `() => ""` (a stub) and exposes
 *     NO `call-plugin` at all (see src/lib/wasi-imports.ts).
 *   - The resolver DOES exist (PluginHost.findByApi resolves by providesApi), but the
 *     guest imports can't see it — WasiImports never receives the registry.
 *
 * So a guest that declares `requiresApi: ["FooApi"]` and does `get-plugin-api("FooApi")`
 * gets an empty string and has no `call-plugin` to invoke. The recursion is unreachable.
 *
 * This test asserts the DESIRED behaviour, so it FAILS today and turns green once the
 * drift is closed (WasiImports wired to the registry, call-plugin exposed).
 */

function consumerManifest(): PluginManifest {
	return {
		id: "@drift/consumer",
		name: "SPI Consumer",
		version: "0.1.0",
		entry: "./consumer.wasm",
		capabilities: { provides: [], requires: [], requiresApi: ["NotesLookup"] },
		targets: ["server"],
		observability: { hooks: [] },
		certification: { license: "MIT", a11yLevel: 0, languages: ["en"] },
	} as unknown as PluginManifest;
}

describe("tractor-ts SPI recursion — drift vs the Rust host", () => {
	it("get-plugin-api resolves via the injected cross-plugin bridge (not a stub)", () => {
		// The cure wired a CrossPluginBridge into WasiImports; the guest's get-plugin-api
		// now delegates to it. With a bridge that resolves the API, the import returns the
		// provider's id — proving the resolve leg reaches the registry, not the "" stub.
		const bridge: CrossPluginBridge = {
			resolveApi: (api) => (api === "NotesLookup" ? "@drift/provider" : ""),
			callPlugin: async () => null,
			dispatchableVerbs: () => [],
		};
		const imports = new WasiImports(
			"@drift/consumer",
			{ debug() {}, info() {}, warn() {}, error() {} } as never,
			() => {},
			undefined,
			bridge,
		).generate(consumerManifest(), "strict" as ExecutionProfile);

		const bridgeImports = imports["plugin:host/tractor-bridge"] as
			| Record<string, unknown>
			| undefined;
		const getPluginApi = bridgeImports?.["get-plugin-api"] as
			| ((api: string) => string)
			| undefined;

		expect(getPluginApi, "get-plugin-api must be present in the bridge imports").toBeTypeOf(
			"function",
		);
		expect(
			getPluginApi?.("NotesLookup"),
			"get-plugin-api should resolve a loaded provider's id via the bridge",
		).toBe("@drift/provider");
	});

	it("exposes call-plugin so a consumer can invoke the resolved provider", () => {
		const imports = new WasiImports(
			"@drift/consumer",
			{ debug() {}, info() {}, warn() {}, error() {} } as never,
			() => {},
		).generate(consumerManifest(), "strict" as ExecutionProfile);

		const bridge = imports["plugin:host/tractor-bridge"] as
			| Record<string, unknown>
			| undefined;

		// The Rust host exposes call-plugin (wasi_bridge/core.rs). The TS host must too,
		// or the recursion is only half-wired (resolve but can't call).
		expect(
			bridge?.["call-plugin"],
			"call-plugin must be exposed so the resolved provider can actually be invoked",
		).toBeTypeOf("function");
	});
});
