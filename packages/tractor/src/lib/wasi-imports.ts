import { PluginManifest } from "@refarm.dev/plugin-manifest";
import { TelemetryEvent } from "./telemetry";
import { TractorLogger } from "./types";
import { ExecutionProfile } from "./trust-manager";

/**
 * Generates WASI and bridge imports for a plugin based on its manifest and execution profile.
 */
export class WasiImports {
  constructor(
    private pluginId: string,
    private logger: TractorLogger,
    private emit: (data: TelemetryEvent) => void,
    private storeNode?: (nodeJson: string) => Promise<void>,
  ) {}

  generate(manifest: PluginManifest, profile: ExecutionProfile): any {
    const allowedOrigins = manifest.capabilities.allowedOrigins ?? [];
    const isTrustedFast = profile === "trusted-fast";

    const isAllowedRequest = (request: unknown): boolean => {
      if (isTrustedFast) return true;
      if (allowedOrigins.length === 0) return false;

      const url = typeof request === "string" ? request : (request as { url?: string })?.url;
      if (!url) return false;

      return allowedOrigins.some((origin: string) => url.startsWith(origin));
    };

    const wasiLogging = {
      log: (level: string, context: string, message: string) => {
        if (!isTrustedFast) {
          this.logger.debug(`[plugin:${this.pluginId}] [${level}] ${message}`);
        }
        this.emit({
          event: "plugin:log",
          pluginId: this.pluginId,
          payload: { level, message },
        });
      },
    };

    const wasiEnvironment = {
      getEnvironment: () => [],
      getArguments: () => [],
      initialDirectory: () => undefined,
    };

    const wasiStreams = {
      read: async () => [new Uint8Array(), true],
      write: async () => 0n,
      blockingRead: async () => [new Uint8Array(), true],
      blockingWrite: async () => 0n,
      subscribe: () => 0n,
      drop: () => {},
      InputStream: class InputStream {},
      OutputStream: class OutputStream {},
    };

    const wasiStubs = {
      "wasi:cli/exit": { exit: () => {} },
      "wasi:cli/stdin": { getStdin: () => 0 },
      "wasi:cli/stdout": { getStdout: () => 1 },
      "wasi:cli/stderr": { getStderr: () => 2 },
      "wasi:clocks/wall-clock": {
        now: () => ({ seconds: BigInt(Math.floor(Date.now() / 1000)), nanoseconds: 0 }),
        resolution: () => ({ seconds: 1n, nanoseconds: 0 }),
      },
      "wasi:filesystem/types": {
        filesystemErrorCode: () => {},
        descriptor: class Descriptor {},
        Descriptor: class Descriptor {},
      },
      "wasi:filesystem/preopens": { getDirectories: () => [] },
      "wasi:random/random": {
        getRandomBytes: (len: bigint) => new Uint8Array(Number(len)),
        getRandomU64: () => 0n,
      },
      "wasi:io/error": { 
        error: class Error {},
        Error: class Error {},
      },
      "wasi:io/streams": wasiStreams,
    };

    const imports: any = {
      "wasi:logging/logging": wasiLogging,
      "wasi:logging/logging@0.1.0-draft": wasiLogging,
      "wasi:cli/environment": wasiEnvironment,
      "wasi:cli/environment@0.2.0": wasiEnvironment,
      "wasi:cli/environment@0.2.3": wasiEnvironment,
      "wasi:http/outgoing-handler": {
        handle: async (request: any) => {
          if (!isAllowedRequest(request)) {
            const url = typeof request === "string" ? request : request?.url;
            console.warn(`[tractor] Blocked unauthorized fetch to ${url || "<unknown>"} by ${this.pluginId}`);
            throw new Error("HTTP request not permitted by capabilities");
          }
          return fetch(request);
        },
      },
      "refarm:plugin/tractor-bridge": {
        "store-node": async (nodeJson: string) => {
          if (this.storeNode) await this.storeNode(nodeJson);
          return "ok";
        },
        "request-permission": async (_cap: string, _reason: string) => true,
      },
    };

    const versions = ["", "@0.2.0", "@0.2.3"];
    for (const [key, val] of Object.entries(wasiStubs)) {
      for (const v of versions) {
        imports[`${key}${v}`] = val;
      }
    }

    return imports;
  }
}
