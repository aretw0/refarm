// Node-only deps (jco, fs, path) are loaded dynamically inside instantiate()
// so this module can be safely imported in browser bundles without pulling in Node.js APIs.
import { PluginManifest } from "@refarm.dev/plugin-manifest";
import { TelemetryEvent } from "./telemetry";
import { TractorLogger } from "./types";
import { PluginInstanceHandle } from "./instance-handle";
import type { PluginInstance } from "./instance-handle";
import type { PluginRunner } from "./plugin-runner";

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
    imports: Record<string, any>,
    emit: (data: TelemetryEvent) => void,
    onTerminate: (id: string) => void,
  ): Promise<PluginInstance> {
    const pluginId = manifest.id;
    let componentInstance: any = null;

    try {
      const [jco, fs, path] = await Promise.all([
        import("@bytecodealliance/jco"),
        import("node:fs/promises"),
        import("node:path"),
      ]);

      const opts = { name: pluginId.replace(/[^a-z0-9]/gi, "_") };
      const { files } = await jco.transpile(new Uint8Array(wasmBuffer), opts as any);

      const distDir = path.resolve(this.distBase, pluginId);
      await fs.mkdir(distDir, { recursive: true });

      const jcoName = pluginId.replace(/[^a-z0-9]/gi, "_");
      let entryPoint = "";

      for (const [filename, content] of Object.entries(files)) {
        const filePath = path.join(distDir, filename);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content as any);
        if (filename === `${jcoName}.js`) entryPoint = filePath;
      }

      if (!entryPoint) {
        const items = await fs.readdir(distDir);
        const rootJs = items.find((f) => f.endsWith(".js"));
        if (rootJs) entryPoint = path.join(distDir, rootJs);
      }

      if (!entryPoint) {
        throw new Error(`[tractor] No JS entry point found for ${pluginId}`);
      }

      const relativePath =
        "./" + path.relative(this.distBase, entryPoint).replace(/\\/g, "/");
      const module = await import(relativePath);

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
    } catch (e: any) {
      this.logger.warn(
        `[tractor] JCO instantiation failed for ${pluginId}: ${e.message}`,
      );
    }

    return new PluginInstanceHandle(
      pluginId,
      manifest.name,
      manifest,
      componentInstance,
      emit,
      onTerminate,
    );
  }
}
