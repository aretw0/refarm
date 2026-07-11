import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The host-side loader for the quality:v1 integration plugin — the second real
// consumer of dispatch-result:v1. Symmetric to vault-surface-ref's plugin loader:
// the component IMPORTS tractor-bridge (the caller supplies a host implementation
// or a test double) and EXPORTS the canonical integration interface, driven by
// on-event('quality:dispatch'). Findings are emitted through the bridge's
// store-node as a shared dispatch-result:v1 node the caller correlates by replyRef.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const bundledPluginPkgDir = fileURLToPath(new URL("../pkg-plugin/", import.meta.url));

/** The host capability the plugin imports (mirrors plugin-wit host.wit). */
export interface TractorBridge {
	storeNode(node: string): unknown;
	getNode(id: string): unknown;
	queryNodes(nodeType: string, limit: number): string[];
	requestPermission(capability: string, reason: string): boolean;
	getIdentity(): unknown;
	getPluginApi(apiName: string): unknown;
	emitTelemetry(event: string, payload?: string): void;
}

/** The canonical `integration` interface the tractor host calls. */
export interface IntegrationPlugin {
	setup(): unknown;
	ingest(): unknown;
	push(payload: string): unknown;
	teardown(): void;
	getHelpNodes(): unknown;
	metadata(): {
		name: string;
		version: string;
		description: string;
		supportedTypes: string[];
		requiredCapabilities: string[];
	};
	onEvent(event: string, payload: string | undefined): void;
	respond(payload: string): unknown;
}

/**
 * Load the quality:v1 component as an `integration` plugin. The caller supplies a
 * `tractor-bridge` implementation; the plugin is driven by
 * `onEvent("quality:dispatch", payload)` and emits findings through the bridge's
 * `storeNode` as a dispatch-result:v1 node.
 */
export async function loadQualityPluginComponent(options: {
	pkgDir: string;
	entry: string;
	bridge: TractorBridge;
}): Promise<IntegrationPlugin> {
	const { pkgDir, entry, bridge } = options;
	const getCoreModule = (path: string): WebAssembly.Module =>
		new WebAssembly.Module(readFileSync(join(pkgDir, path)));
	const mod = (await import(pathToFileURL(join(pkgDir, entry)).href)) as Any;
	const root = await mod.instantiate(getCoreModule, {
		"host:plugin/tractor-bridge": bridge,
	});
	return root.integration as IntegrationPlugin;
}

/** Instantiate the BUNDLED quality integration plugin with a host bridge. */
export function createQualityPluginComponent(bridge: TractorBridge): Promise<IntegrationPlugin> {
	return loadQualityPluginComponent({
		pkgDir: bundledPluginPkgDir,
		entry: "quality_plugin.js",
		bridge,
	});
}
