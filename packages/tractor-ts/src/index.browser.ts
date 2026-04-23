/**
 * @refarm.dev/tractor — browser-safe entrypoint
 *
 * This module re-exports all browser-compatible APIs from Tractor.
 * PluginHost is replaced with a stub: it satisfies TypeScript consumers
 * but throws a descriptive error at runtime when plugin loading is attempted.
 *
 * Plugin loading in the browser requires a pre-installed WASM cache (OPFS).
 * See ADR-044: specs/ADRs/ADR-044-wasm-plugin-loading-browser-strategy.md
 */

export * from "./lib/graph-normalizer";
export * from "./lib/identity-recovery-host";
// Re-export types from plugin-host's dependencies directly (no Node deps)
export type { PluginInstance, PluginState } from "./lib/instance-handle";
export * from "./lib/l8n-host";
export * from "./lib/secret-host";
export * from "./lib/telemetry";
export type { ExecutionProfile, PluginTrustGrant } from "./lib/trust-manager";
export * from "./lib/types";

import {
	assertEntryRuntimeCompatibility,
	detectEntryFormat,
	type PluginManifest,
} from "@refarm.dev/plugin-manifest";
import type { SovereignNode } from "./lib/graph-normalizer";
import type { PluginInstance, PluginState } from "./lib/instance-handle";
import { getCachedPlugin } from "./lib/opfs-plugin-cache";
import type { TelemetryEvent } from "./lib/telemetry";
import type { ExecutionProfile, PluginTrustGrant } from "./lib/trust-manager";
import type { TractorLogger } from "./lib/types";

const BROWSER_ERROR =
	"[tractor] PluginHost requires the Node.js runtime or a pre-installed WASM cache. " +
	"Use installPlugin() to cache the transpiled module to OPFS first. See ADR-044.";

/**
 * Browser stub for PluginHost.
 *
 * The constructor does not throw — Tractor can boot in the browser.
 * Methods that require Node.js or a WASM cache throw at call time.
 * Read-only queries return empty results instead of throwing.
 */
export class PluginHost {
	private readonly instances = new Map<string, PluginInstance>();

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	constructor(
		private readonly emit: (data: TelemetryEvent) => void,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		_registry: any,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		_logger?: TractorLogger,
	) {}

	private normalizeJavaScriptModule(moduleNamespace: any): any {
		if (!moduleNamespace) return moduleNamespace;

		const defaultExport = moduleNamespace.default;
		if (defaultExport && typeof defaultExport === "object") {
			return {
				...defaultExport,
				...moduleNamespace,
			};
		}

		return moduleNamespace;
	}

	private encodeBase64Utf8(source: string): string {
		const bytes = new TextEncoder().encode(source);
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	}

	private async loadJavaScriptModule(entryUrl: string): Promise<any> {
		try {
			const moduleNamespace = await import(/* @vite-ignore */ entryUrl);
			return this.normalizeJavaScriptModule(moduleNamespace);
		} catch {
			const response = await fetch(entryUrl);
			if (!response.ok) {
				throw new Error(
					`[tractor] Failed to fetch browser plugin module: ${response.statusText}`,
				);
			}
			const source = await response.text();
			const dataUrl = `data:text/javascript;base64,${this.encodeBase64Utf8(source)}`;
			const moduleNamespace = await import(/* @vite-ignore */ dataUrl);
			return this.normalizeJavaScriptModule(moduleNamespace);
		}
	}

	private async loadWasmModuleFromCache(
		manifest: PluginManifest,
	): Promise<any> {
		const pluginId = manifest.id;
		const cached = await getCachedPlugin(pluginId);

		if (!cached) {
			throw new Error(
				`[tractor] Browser WASM plugin ${pluginId} is not installed in cache. ` +
					"Run installPlugin() before load().",
			);
		}

		try {
			const instantiated = await WebAssembly.instantiate(cached, {});
			return instantiated.instance.exports;
		} catch (error: any) {
			throw new Error(
				`[tractor] Failed to instantiate cached browser WASM for ${pluginId}. ` +
					`Current browser path expects cache-backed runtime-compatible exports (${error?.message ?? "unknown error"}).`,
			);
		}
	}

	hasValidTrustGrant(_pluginId: string, _wasmHash?: string): boolean {
		return false;
	}

	grantTrust(
		_pluginId: string,
		_wasmHash: string,
		_leaseMs?: number,
	): PluginTrustGrant {
		throw new Error(BROWSER_ERROR);
	}

	trustManifestOnce(
		_manifest: PluginManifest,
		_wasmHash: string,
	): PluginTrustGrant {
		throw new Error(BROWSER_ERROR);
	}

	revokeTrust(_pluginId: string, _wasmHash?: string): void {
		// no-op in browser
	}

	async load(
		_manifest: PluginManifest,
		_wasmHash?: string,
	): Promise<PluginInstance> {
		const manifest = _manifest;
		const entryFormat = detectEntryFormat(manifest.entry);

		const moduleNamespace =
			entryFormat === "wasm"
				? (assertEntryRuntimeCompatibility(manifest.entry, "browser", {
						allowBrowserWasmFromCache: true,
					}),
					await this.loadWasmModuleFromCache(manifest))
				: (assertEntryRuntimeCompatibility(manifest.entry, "browser"),
					await this.loadJavaScriptModule(manifest.entry));

		const pluginId = manifest.id;

		const instance: PluginInstance = {
			id: pluginId,
			name: manifest.name,
			manifest,
			state: "running",
			call: async (fn: string, args?: unknown): Promise<unknown> => {
				let result = null;
				if (
					moduleNamespace.integration &&
					typeof moduleNamespace.integration[fn] === "function"
				) {
					result = await moduleNamespace.integration[fn](args);
				} else if (typeof moduleNamespace[fn] === "function") {
					result = await moduleNamespace[fn](args);
				}

				this.emit({
					event: "api:call",
					pluginId,
					payload: { fn, args, result },
				});

				return result;
			},
			terminate: () => {
				this.instances.delete(pluginId);
				this.emit({ event: "plugin:terminate", pluginId });
			},
			emitTelemetry: (event: string, payload?: any) => {
				this.emit({ event, pluginId, payload });
			},
		};

		this.instances.set(pluginId, instance);

		try {
			await instance.call("setup");
		} catch {
			// setup hook remains optional at runtime for JS onboarding path
		}

		this.emit({
			event: "plugin:load",
			pluginId,
			payload: {
				entryType: entryFormat === "wasm" ? "wasm" : "js",
				source: entryFormat === "wasm" ? "browser-cache" : "browser-module",
			},
		});

		return instance;
	}

	getWasiImports(
		_manifest: PluginManifest,
		_profile: ExecutionProfile,
	): Record<string, unknown> {
		return {};
	}

	registerInternal(_instance: PluginInstance): void {
		this.instances.set(_instance.id, _instance);
	}

	setState(_pluginId: string, _state: PluginState): void {
		const instance = this.instances.get(_pluginId);
		if (instance && instance.state !== _state) {
			instance.state = _state;
			this.emit({
				event: "system:plugin_state_changed",
				pluginId: _pluginId,
				payload: { state: _state },
			});
		}
	}

	dispatch(_event: TelemetryEvent): void {
		for (const instance of this.instances.values()) {
			if (_event.event.startsWith("system:")) {
				instance.call("on-event", [
					_event.event,
					JSON.stringify(_event.payload),
				]);
			}
		}
	}

	async getHelpNodes(): Promise<SovereignNode[]> {
		const nodes: SovereignNode[] = [];
		for (const plugin of this.instances.values()) {
			try {
				const pluginNodes = (await plugin.call("get-help-nodes")) as any[];
				if (pluginNodes) nodes.push(...pluginNodes.map((n) => JSON.parse(n)));
			} catch {
				// ignore invalid help providers in browser path
			}
		}
		return nodes;
	}

	findByApi(_apiName: string): PluginInstance | undefined {
		for (const instance of this.instances.values()) {
			if (instance.manifest.capabilities.providesApi?.includes(_apiName)) {
				return instance;
			}
		}
		return undefined;
	}

	get(_pluginId: string): PluginInstance | undefined {
		return this.instances.get(_pluginId);
	}

	getAllPlugins(): PluginInstance[] {
		return Array.from(this.instances.values());
	}

	terminateAll(): void {
		for (const plugin of this.instances.values()) {
			plugin.terminate();
		}
	}
}

export type { InstallPluginResult } from "./lib/install-plugin";
export { installPlugin } from "./lib/install-plugin";
export {
	cachePlugin,
	evictPlugin,
	getCachedPlugin,
} from "./lib/opfs-plugin-cache";

/** Sovereign engine version — mirrors Tractor.VERSION for browser consumers. */
export const TRACTOR_VERSION: string =
	(import.meta as any).env?.VITE_REFARM_VERSION || "0.1.0-solo-fertil";

// Re-export Tractor for browser consumers.
// node:fs/promises and @bytecodealliance/jco are now dynamic imports inside
// MainThreadRunner.instantiate() and plugin-host.ts, so this import no longer
// pulls Node-only modules into the browser bundle.
export { Tractor } from "./index";
