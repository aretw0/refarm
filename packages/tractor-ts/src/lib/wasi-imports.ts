import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import type { TelemetryEvent } from "./telemetry";
import type { ExecutionProfile } from "./trust-manager";
import type { TractorLogger } from "./types";

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

			const url =
				typeof request === "string"
					? request
					: (request as { url?: string })?.url;
			if (!url) return false;

			return allowedOrigins.some((origin: string) => url.startsWith(origin));
		};

		const wasiLogging = {
			log: (level: string, _context: string, message: string) => {
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
				now: () => ({
					seconds: BigInt(Math.floor(Date.now() / 1000)),
					nanoseconds: 0,
				}),
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

		const tractorBridge = {
			"store-node": (nodeJson: string) => {
				if (this.storeNode) {
					try {
						Promise.resolve(this.storeNode(nodeJson)).catch(() => {});
					} catch {
						// best-effort bridge write; never fail host import path
					}
				}
				return "ok";
			},
			"get-node": (_id: string) => "{}",
			"query-nodes": (_nodeType: string, _limit: number) => [],
			"request-permission": (_cap: string, _reason: string) => true,
			"get-identity": () => ({
				identityType: "guest",
				storageTier: "memory",
				identifier: this.pluginId,
			}),
			"get-plugin-api": (_apiName: string) => "",
			"emit-telemetry": (event: string, payload?: string) => {
				this.emit({ event, pluginId: this.pluginId, payload });
			},
		};

		const mockLlmBody =
			process.env.REFARM_MOCK_LLM_BODY ??
			JSON.stringify({
				id: "tractor-mock-llm",
				object: "chat.completion",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "mock llm response" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 21,
					completion_tokens: 13,
					total_tokens: 34,
				},
			});
		const mockLlmBytes = new TextEncoder().encode(mockLlmBody);
		const mockLlmContent = (() => {
			try {
				const parsed = JSON.parse(mockLlmBody) as {
					choices?: Array<{ message?: { content?: string } }>;
				};
				const content = parsed.choices?.[0]?.message?.content;
				if (typeof content === "string" && content.trim().length > 0) {
					return content;
				}
			} catch {
				// fall through to deterministic default
			}
			return "mock llm response";
		})();

		const persistMockStreamFinalChunk = (
			provider: string,
			streamMetadata: unknown,
		): { storedChunks: number; lastSequence?: number } => {
			if (!this.storeNode) {
				return { storedChunks: 0, lastSequence: undefined };
			}

			const metadata =
				streamMetadata && typeof streamMetadata === "object"
					? (streamMetadata as {
							promptRef?: unknown;
							model?: unknown;
							providerFamily?: unknown;
							lastSequence?: unknown;
						})
					: null;

			const promptRef =
				typeof metadata?.promptRef === "string"
					? metadata.promptRef.trim()
					: "";
			if (!promptRef) {
				return { storedChunks: 0, lastSequence: undefined };
			}

			const sequence =
				typeof metadata?.lastSequence === "number" &&
				Number.isFinite(metadata.lastSequence)
					? metadata.lastSequence + 1
					: 0;
			const model =
				typeof metadata?.model === "string" && metadata.model.trim().length > 0
					? metadata.model
					: "mock-model";
			const providerFamily =
				typeof metadata?.providerFamily === "string" &&
				metadata.providerFamily.trim().length > 0
					? metadata.providerFamily
					: provider;

			const streamRef = `urn:tractor:stream:agent-response:${promptRef}`;
			const payload = JSON.stringify({
				"@type": "StreamChunk",
				"@id": `urn:tractor:stream-chunk:${crypto.randomUUID()}`,
				stream_ref: streamRef,
				sequence,
				payload_kind: "final_text",
				content: mockLlmContent,
				is_final: true,
				timestamp_ns: Date.now(),
				metadata: {
					projection: "AgentResponse",
					prompt_ref: promptRef,
					provider_family: providerFamily,
					model,
				},
			});

			try {
				Promise.resolve(this.storeNode(payload)).catch(() => {});
			} catch {
				return { storedChunks: 0, lastSequence: undefined };
			}

			return { storedChunks: 1, lastSequence: sequence };
		};

		const completeHttp = (
			_provider: string,
			_baseUrl: string,
			_reqPath: string,
			_headers: Array<[string, string]>,
			_body: Uint8Array,
		) => {
			return mockLlmBytes;
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
						console.warn(
							`[tractor] Blocked unauthorized fetch to ${url || "<unknown>"} by ${this.pluginId}`,
						);
						throw new Error("HTTP request not permitted by capabilities");
					}
					return fetch(request);
				},
			},
			"refarm:plugin/tractor-bridge": tractorBridge,
			"refarm:plugin/llm-bridge": {
				"complete-http": completeHttp,
				"complete-http-stream": (
					provider: string,
					baseUrl: string,
					reqPath: string,
					headers: Array<[string, string]>,
					body: Uint8Array,
					_streamMetadata: unknown,
				) => {
					const finalBody = completeHttp(
						provider,
						baseUrl,
						reqPath,
						headers,
						body,
					);
					const streamResult = persistMockStreamFinalChunk(
						provider,
						_streamMetadata,
					);
					return {
						finalBody,
						storedChunks: streamResult.storedChunks,
						lastSequence: streamResult.lastSequence,
					};
				},
			},
			"refarm:plugin/agent-fs": {
				read: (_path: string) => new Uint8Array(),
				write: (_path: string, _content: Uint8Array) => undefined,
				edit: (_path: string, _diff: string) => undefined,
			},
			"refarm:plugin/agent-shell": {
				spawn: (_req: unknown) => ({
					exitCode: 0,
					stdout: new Uint8Array(),
					stderr: new Uint8Array(),
					durationMs: 0,
				}),
			},
			"refarm:plugin/structured-io": {
				"read-structured": (
					_path: string,
					_format: unknown,
					_pageSize: number,
					_pageOffset: number,
				) => JSON.stringify({ value: null }),
				"write-structured": (
					_path: string,
					_content: string,
					_format: unknown,
				) => undefined,
			},
			"refarm:plugin/code-ops": {
				"rename-symbol": (_loc: unknown, _newName: string) => ({
					filesChanged: 0,
					editsApplied: 0,
				}),
				"find-references": (_loc: unknown) => [],
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
