import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/capability-host";
import {
	installPluginForRuntime,
	startRuntimeDaemon,
	type RuntimeDaemonHandle,
} from "@refarm.dev/capability-host/node";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * LIVE RECURSION — T1's headline as a real command. The coding-agent is itself a WASM plugin, and
 * it uses ANOTHER plugin (a source provider) through the host as a tool — no import, no privilege
 * of its own; the host mediates under the TARGET plugin's grant. This is proven in tractor's
 * harness AND the example's gated test; this exposes it as a runnable verb so a viewer SEES the
 * recursion, not just reads that it's tested.
 *
 * It boots the native tractor daemon with [provider, agent], drives the agent with a prompt (its
 * `respond` flow calls the model, which — scripted by a mock, or a real model — calls the
 * provider's verb as a tool), and reports what happened. The substrate (startRuntimeDaemon +
 * installPluginForRuntime) is the platform's; this only wires the demo.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface LiveRecursionArtifacts {
	tractorBinary: string;
	agentWasm: string;
	agentManifest: string;
	providerWasm: string;
}

/** Resolve the built artifacts the live demo needs (the tractor binary + the two plugins). */
export function defaultArtifacts(): LiveRecursionArtifacts {
	return {
		tractorBinary: process.env.TRACTOR_BINARY ?? resolve(REPO_ROOT, ".cache/cargo-target/release/tractor"),
		agentWasm: resolve(REPO_ROOT, "packages/agent/dist/agent.wasm"),
		agentManifest: resolve(REPO_ROOT, "packages/agent/dist/plugin.json"),
		// The EASTER EGG: this is the very same source_provider.wasm the T3 example later loads and
		// consumes (reqbench's source-wasm test). T1 boots the provider; T3 uses it as if it already
		// existed. Nobody says so — a viewer of all three notices T1 created what T3 consumes.
		providerWasm: resolve(REPO_ROOT, "packages/source-provider-ref/dist/source_provider.wasm"),
	};
}

/** Which artifacts are missing (so the verb can report a clear, actionable error). */
export function missingArtifacts(a: LiveRecursionArtifacts): string[] {
	return Object.entries(a)
		.filter(([, p]) => !existsSync(p))
		.map(([k]) => k);
}

export interface LiveRecursionResult {
	pluginsLoaded: string[];
	/** The agent's response text (or a summary), when the run completed. */
	response?: string;
	/** Whether the agent reached the model at all (the round-trip began). */
	reachedModel: boolean;
	/** The tool the agent called on the provider, if observed. */
	toolCalled?: string;
}

export interface RunLiveRecursionOptions {
	prompt: string;
	artifacts?: LiveRecursionArtifacts;
	/** Provide the model env (a mock's env, or real MODEL_* vars). When absent, the caller must
	 * have MODEL_* configured in the environment for the agent to reach a real model. */
	modelEnv?: NodeJS.ProcessEnv;
	wsPort?: number;
	httpPort?: number;
	/** Called with the daemon handle once up, so a caller (a --mock demo) can inspect requests. */
	onDaemon?: (daemon: RuntimeDaemonHandle) => void;
}

/**
 * Boot the runtime with [provider, agent], drive the agent with `prompt`, and return what the
 * recursion did. Always stops the daemon. This is the reusable core the CLI verb wraps.
 */
export async function runLiveRecursion(options: RunLiveRecursionOptions): Promise<LiveRecursionResult> {
	const artifacts = options.artifacts ?? defaultArtifacts();
	const agentInstall = installPluginForRuntime({
		wasmPath: artifacts.agentWasm,
		manifestTemplatePath: artifacts.agentManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-agent-")),
	});

	let daemon: RuntimeDaemonHandle | undefined;
	try {
		daemon = await startRuntimeDaemon({
			binaryPath: artifacts.tractorBinary,
			plugins: [artifacts.providerWasm, agentInstall.wasmPath],
			wsPort: options.wsPort ?? 42064,
			httpPort: options.httpPort ?? 42065,
			securityMode: "none",
			readyTimeoutMs: 40_000,
			// No namespace override → the default `:memory:` store, and that is CORRECT here:
			// agent-run reads the agent's response from the `POST /efforts` RESPONSE BODY
			// directly, never from `GET /nodes`. (delegate-run/code-ops DO read a DispatchResult
			// node back, so they MUST use a file-backed namespace — see their comments.)
			...(options.modelEnv ? { env: options.modelEnv } : {}),
		});
		options.onDaemon?.(daemon);

		const plugins = (await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json()) as { loaded?: string[] };
		const pluginsLoaded = Array.isArray(plugins.loaded) ? plugins.loaded : [];

		const effort = {
			id: `t1-live-${Date.now()}`,
			submittedAt: new Date().toISOString(),
			tasks: [{ id: "t1-live-task-0", pluginId: "agent", fn: "respond", args: { prompt: options.prompt } }],
		};
		const res = await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(effort),
		});
		const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};

		return {
			pluginsLoaded,
			reachedModel: res.ok,
			response: typeof body.response === "string" ? body.response : undefined,
		};
	} finally {
		await daemon?.stop();
	}
}

/**
 * `agent-run <prompt> [--mock]` — run the live plugin→plugin recursion: the coding-agent responds
 * to the prompt, calling the source provider's verb as a tool through the host. With `--mock` a
 * deterministic model is scripted (no real LLM needed — the demo runs offline); without it the
 * agent reaches the configured model. Reports the plugins loaded + whether the recursion ran.
 */
export function createAgentRunCapability(): CapabilityDescriptor {
	return {
		name: "agent-run",
		summary: "Run the coding-agent LIVE: it responds while calling another plugin as a tool (recursion)",
		args: [{ name: "prompt", required: true }],
		options: [{ name: "mock", kind: "boolean", summary: "Script a deterministic model (offline demo, no real LLM)" }],
		transports: { http: { path: "/agent/run" } },
		renderers: { tui: { section: "agent" }, web: { route: "/agent", icon: "play" }, ide: { command: "dgk.agent-run" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const prompt = String(input.args.prompt ?? "");
			if (!prompt) {
				return buildJsonErrorEnvelope({
					command: "agent-run",
					operation: "agent-run",
					error: "no_prompt",
					message: "Pass a prompt for the agent to respond to.",
					nextAction: "dgk agent-run \"What sources are available?\"",
				});
			}
			const artifacts = defaultArtifacts();
			const missing = missingArtifacts(artifacts);
			if (missing.length > 0) {
				return buildJsonErrorEnvelope({
					command: "agent-run",
					operation: "agent-run",
					error: "artifacts_missing",
					message: `Build the runtime artifacts first (missing: ${missing.join(", ")}).`,
					nextAction:
						"pnpm --filter @refarm.dev/tractor run build && pnpm --filter @refarm.dev/agent run build:wasm && pnpm --filter @refarm.dev/source-provider-ref run build:plugin",
				});
			}
			const useMock = input.options?.mock === true;
			try {
				let modelEnv: NodeJS.ProcessEnv | undefined;
				let mockStop: (() => Promise<void>) | undefined;
				if (useMock) {
					// A deterministic model: first turn calls the provider's discover verb as a tool,
					// then a final message — the recursion runs with no real LLM.
					const { ModelMockServer, says, toolCall } = await import("@refarm.dev/model-mock");
					const mock = await new ModelMockServer({ repeatLast: true }).start();
					mock
						.queue(toolCall("source-discover", { method: "discover" }))
						.queue(says("Discovered the available sources via the provider plugin."));
					modelEnv = mock.env;
					mockStop = () => mock.stop();
				}
				try {
					const result = await runLiveRecursion({ prompt, ...(modelEnv ? { modelEnv } : {}) });
					return buildJsonSuccessEnvelope({
						command: "agent-run",
						operation: "agent-run",
						nextCommand: "dgk extension",
						nextCommands: ["dgk extension"],
						extra: {
							prompt,
							mock: useMock,
							pluginsLoaded: result.pluginsLoaded,
							recursion: "agent → source-provider (host-mediated, under the provider's grant)",
							reachedModel: result.reachedModel,
							...(result.response ? { response: result.response } : {}),
						},
					});
				} finally {
					await mockStop?.();
				}
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "agent-run",
					operation: "agent-run",
					error: "recursion_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the tractor binary + plugins built, and (without --mock) a model is configured.",
				});
			}
		},
	};
}
