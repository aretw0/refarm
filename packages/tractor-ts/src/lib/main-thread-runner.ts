// Node-only deps (jco, fs, path) are loaded dynamically inside instantiate()
// so this module can be safely imported in browser bundles without pulling in Node.js APIs.
import type { PluginManifest } from "@refarm.dev/plugin-manifest";
type RefarmPluginGlobals = typeof globalThis & { __REFARM_PLUGIN_IMPORTS__?: Record<string, unknown> };
import type { PluginInstance } from "./instance-handle.js";
import { PluginInstanceHandle } from "./instance-handle.js";
import type { PluginRunner } from "./plugin-runner.js";
import type { TelemetryEvent } from "./telemetry.js";
import type { TractorLogger } from "./types.js";

/**
 * Plugin runner for the main thread using JCO transpilation.
 *
 * This is the default runner for server-side (Node.js) environments.
 * It JCO-transpiles the WASM component to JavaScript at load time, writes the
 * output to `.jco-dist/`, and dynamically imports the entry point.
 *
 * Not suitable for browser main threads (uses node:fs, node:path, jco).
 * For browser use, see WorkerRunner.
 */
export class MainThreadRunner implements PluginRunner {
	constructor(
		private distBase: string,
		private logger: TractorLogger = console,
	) {}

	supports(_manifest: PluginManifest): boolean {
		// Available when running in Node.js
		return typeof process !== "undefined" && !!process.versions?.node;
	}

	async instantiate(
		manifest: PluginManifest,
		wasmBuffer: ArrayBuffer,
		imports: Record<string, unknown>,
		emit: (data: TelemetryEvent) => void,
		onTerminate: (id: string) => void,
	): Promise<PluginInstance> {
		const pluginId = manifest.id;
		let componentInstance: unknown = null;

		try {
			const [fs, path] = await Promise.all([
				import("node:fs/promises"),
				import("node:path"),
			]);

			const jcoName = pluginId.replace(/[^a-z0-9]/gi, "_");
			const distDir = path.resolve(this.distBase, pluginId);

			let entryPoint = "";
			// files is only populated on cache-miss (transpile path). On cache-hit it stays empty
			// because JCO default output self-fetches its WASM via fetchCompile(new URL(..., import.meta.url))
			// and never calls the instantiate() callback. If a plugin is ever transpiled with
			// { instantiation: true }, the cache-hit path must read .wasm files from distDir here.
			let files: Record<string, string | Uint8Array> = {};

			// Use cached transpile output when available — avoids loading JCO on every boot.
			// Check both the JS entry and its WASM sidecar to guard against partial cache.
			const cachedEntry = path.join(distDir, `${jcoName}.js`);
			const cachedWasm = path.join(distDir, `${jcoName}.core.wasm`);
			try {
				await Promise.all([fs.access(cachedEntry), fs.access(cachedWasm)]);
				entryPoint = cachedEntry;
			} catch {
				// Cache miss — transpile now
				const jco = await import("@bytecodealliance/jco");
				const result = await jco.transpile(new Uint8Array(wasmBuffer), { name: jcoName });
				files = result.files;

				await fs.mkdir(distDir, { recursive: true });

				for (const [filename, content] of Object.entries(files)) {
					const filePath = path.join(distDir, filename);
					await fs.mkdir(path.dirname(filePath), { recursive: true });
					await fs.writeFile(filePath, content as string | Uint8Array);
					if (filename === `${jcoName}.js`) entryPoint = filePath;
				}

				if (!entryPoint) {
					const items = await fs.readdir(distDir);
					const rootJs = items.find((f) => f.endsWith(".js"));
					if (rootJs) entryPoint = path.join(distDir, rootJs);
				}
			}

			if (!entryPoint) {
				throw new Error(`[tractor] No JS entry point found for ${pluginId}`);
			}

			const { pathToFileURL } = await import("node:url");
			(globalThis as RefarmPluginGlobals).__REFARM_PLUGIN_IMPORTS__ = imports as Record<string, unknown>;
			const module = await import(pathToFileURL(entryPoint).href);

			if (module.instantiate) {
				componentInstance = await module.instantiate(
					imports,
					(name: string) => {
						const wasmFile = Object.entries(files).find(
							([f]) => f.includes(name) && f.endsWith(".wasm"),
						);
						return wasmFile ? wasmFile[1] : null;
					},
				);
			} else {
				componentInstance = module;
			}
		} catch (e) {
			this.logger.warn(
				`[tractor] JCO instantiation failed for ${pluginId}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}

		return new PluginInstanceHandle(
			pluginId,
			manifest.name,
			manifest,
			componentInstance as Record<string, unknown> | null,
			emit,
			onTerminate,
		);
	}
}
