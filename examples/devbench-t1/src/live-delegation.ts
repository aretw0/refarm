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

import { awaitDispatchResult } from "./live-runtime.js";

/**
 * LIVE DELEGATION — T1's recursion, one turn deeper. `agent-run` shows the agent
 * calling ONE plugin (a source provider) as a tool. This shows a plugin
 * orchestrating the AGENT: the `delegate` plugin (a real, sandboxed WASM component)
 * receives a `delegate:single` dispatch, and runs the task through the agent under a
 * named PERSONA via host-mediated `call_plugin` — plugin → plugin, both sandboxed,
 * neither privileged.
 *
 * This is the "essential plugin lives in the framework, the example simulates using
 * it" story made literal: `delegate` ships in packages/; the bench boots it beside
 * the agent and drives it, so a viewer SEES the sub-agent pipeline, not just reads
 * that it is tested in tractor's delegate harness.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface LiveDelegationArtifacts {
	tractorBinary: string;
	agentWasm: string;
	agentManifest: string;
	delegateWasm: string;
	delegateManifest: string;
}

export function defaultDelegationArtifacts(): LiveDelegationArtifacts {
	return {
		tractorBinary: process.env.TRACTOR_BINARY ?? resolve(REPO_ROOT, ".cache/cargo-target/release/tractor"),
		agentWasm: resolve(REPO_ROOT, "packages/agent/dist/agent.wasm"),
		agentManifest: resolve(REPO_ROOT, "packages/agent/dist/plugin.json"),
		// The delegate plugin — real, tested (tractor's delegate_plugin_harness), and until
		// now with no consumer. The bench is its first showcase.
		delegateWasm: resolve(REPO_ROOT, "packages/delegate/dist/plugin.wasm"),
		delegateManifest: resolve(REPO_ROOT, "packages/delegate/dist/plugin.json"),
	};
}

export function missingDelegationArtifacts(a: LiveDelegationArtifacts): string[] {
	return Object.entries(a)
		.filter(([, p]) => !existsSync(p))
		.map(([k]) => k);
}

export interface LiveDelegationResult {
	pluginsLoaded: string[];
	/** The sub-agent's response, threaded back through the delegate (result.content). */
	content?: string;
	/** Whether the dispatch reached a subscriber (the delegate accepted the event). */
	dispatched: boolean;
}

export interface RunLiveDelegationOptions {
	persona: string;
	task: string;
	artifacts?: LiveDelegationArtifacts;
	modelEnv?: NodeJS.ProcessEnv;
	wsPort?: number;
	httpPort?: number;
	onDaemon?: (daemon: RuntimeDaemonHandle) => void;
	/** How long to poll for the DispatchResult node before giving up. */
	resultTimeoutMs?: number;
}

/** One step of a delegation CHAIN: a persona and its task. The delegate threads each step's
 * output into the next step's task (a scout→planner→worker→reviewer pipeline). */
export interface ChainStep {
	persona: string;
	task: string;
}

export interface RunLiveChainOptions {
	steps: ChainStep[];
	artifacts?: LiveDelegationArtifacts;
	modelEnv?: NodeJS.ProcessEnv;
	wsPort?: number;
	httpPort?: number;
	resultTimeoutMs?: number;
}

/**
 * Boot the runtime with [agent, delegate] and dispatch a `delegate:chain` — a PIPELINE of
 * personas, each step's output threaded into the next. Returns the final step's result. One
 * extension orchestrating a multi-level pipeline of governed sub-agents, all sandboxed. Always
 * stops the daemon.
 */
export async function runLiveChain(options: RunLiveChainOptions): Promise<LiveDelegationResult> {
	const artifacts = options.artifacts ?? defaultDelegationArtifacts();
	const agentInstall = installPluginForRuntime({
		wasmPath: artifacts.agentWasm,
		manifestTemplatePath: artifacts.agentManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-chain-agent-")),
	});
	const delegateInstall = installPluginForRuntime({
		wasmPath: artifacts.delegateWasm,
		manifestTemplatePath: artifacts.delegateManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-chain-plugin-")),
	});

	let daemon: RuntimeDaemonHandle | undefined;
	try {
		daemon = await startRuntimeDaemon({
			binaryPath: artifacts.tractorBinary,
			plugins: [agentInstall.wasmPath, delegateInstall.wasmPath],
			wsPort: options.wsPort ?? 42068,
			httpPort: options.httpPort ?? 42069,
			securityMode: "none",
			readyTimeoutMs: 40_000,
			// File-backed namespace so the delegate's stored DispatchResult is readable (same as single).
			namespace: mkdtempSync(join(tmpdir(), "t1-chain-store-")),
			...(options.modelEnv ? { env: options.modelEnv } : {}),
		});
		const plugins = (await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json()) as { loaded?: string[] };
		const pluginsLoaded = Array.isArray(plugins.loaded) ? plugins.loaded : [];

		const replyRef = `t1-chain-${Date.now()}`;
		const res = await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: replyRef,
				direction: "dispatch",
				source: "operator",
				submittedAt: new Date().toISOString(),
				tasks: [
					{
						id: `${replyRef}-task-0`,
						pluginId: "delegate",
						fn: "chain",
						args: { steps: options.steps, replyRef },
					},
				],
			}),
		});
		if (!res.ok) return { pluginsLoaded, dispatched: false };

		const node = await awaitDispatchResult(daemon.sidecarBaseUrl, replyRef, options.resultTimeoutMs ?? 30_000);
		const result = node?.result as Record<string, unknown> | undefined;
		return {
			pluginsLoaded,
			dispatched: true,
			content: typeof result?.content === "string" ? result.content : undefined,
		};
	} finally {
		await daemon?.stop();
	}
}


/**
 * Boot the runtime with [agent, delegate], dispatch a `delegate:single` for the given
 * persona + task, and return what the sub-agent produced. Always stops the daemon.
 */
export async function runLiveDelegation(options: RunLiveDelegationOptions): Promise<LiveDelegationResult> {
	const artifacts = options.artifacts ?? defaultDelegationArtifacts();
	// Both the agent and the delegate need their manifests installed so their dispatch
	// verbs (agent:respond, delegate:single/chain) enter the runtime registry.
	const agentInstall = installPluginForRuntime({
		wasmPath: artifacts.agentWasm,
		manifestTemplatePath: artifacts.agentManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-del-agent-")),
	});
	const delegateInstall = installPluginForRuntime({
		wasmPath: artifacts.delegateWasm,
		manifestTemplatePath: artifacts.delegateManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-del-plugin-")),
	});

	let daemon: RuntimeDaemonHandle | undefined;
	try {
		daemon = await startRuntimeDaemon({
			binaryPath: artifacts.tractorBinary,
			plugins: [agentInstall.wasmPath, delegateInstall.wasmPath],
			wsPort: options.wsPort ?? 42066,
			httpPort: options.httpPort ?? 42067,
			securityMode: "none",
			readyTimeoutMs: 40_000,
			// A file-backed namespace, NOT :memory: — the delegate's store_node and the
			// sidecar's GET /nodes must share one store to read the DispatchResult back.
			// (:memory: opens a fresh empty store per NativeStorage::open, so the result
			// the plugin wrote would be invisible to the read.)
			namespace: mkdtempSync(join(tmpdir(), "t1-del-store-")),
			...(options.modelEnv ? { env: options.modelEnv } : {}),
		});
		options.onDaemon?.(daemon);

		const plugins = (await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json()) as { loaded?: string[] };
		const pluginsLoaded = Array.isArray(plugins.loaded) ? plugins.loaded : [];

		const replyRef = `t1-delegate-${Date.now()}`;
		const effort = {
			id: replyRef,
			direction: "dispatch",
			source: "operator",
			submittedAt: new Date().toISOString(),
			tasks: [
				{
					id: `${replyRef}-task-0`,
					pluginId: "delegate",
					fn: "single",
					args: { persona: options.persona, task: options.task, replyRef },
				},
			],
		};
		const res = await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(effort),
		});

		if (!res.ok) return { pluginsLoaded, dispatched: false };

		const node = await awaitDispatchResult(
			daemon.sidecarBaseUrl,
			replyRef,
			options.resultTimeoutMs ?? 30_000,
		);
		const result = node?.result as Record<string, unknown> | undefined;
		return {
			pluginsLoaded,
			dispatched: true,
			content: typeof result?.content === "string" ? result.content : undefined,
		};
	} finally {
		await daemon?.stop();
	}
}

/**
 * `delegate-run <task> [--persona <name>] [--mock]` — run the plugin→agent delegation
 * live: the delegate plugin runs the task through the agent under a persona, both as
 * sandboxed WASM. With `--mock` a deterministic model answers (offline); without it
 * the agent reaches the configured model. Reports the plugins loaded + what the
 * sub-agent produced.
 */
export function createDelegateRunCapability(): CapabilityDescriptor {
	return {
		name: "delegate-run",
		summary: "Run a task through the agent under a PERSONA — a plugin (delegate) orchestrating the agent",
		args: [{ name: "task", required: true }],
		options: [
			{ name: "persona", kind: "string", summary: "The persona to run under (scout/planner/worker/reviewer)" },
			{ name: "chain", kind: "boolean", summary: "Run a scout→planner→worker pipeline (each step's output feeds the next)" },
			{ name: "mock", kind: "boolean", summary: "Script a deterministic model (offline demo, no real LLM)" },
		],
		transports: { http: { path: "/delegate/run" } },
		renderers: { tui: { section: "agent" }, web: { route: "/delegate", icon: "organization" }, ide: { command: "dgk.delegate-run" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const task = String(input.args.task ?? "");
			if (!task) {
				return buildJsonErrorEnvelope({
					command: "delegate-run",
					operation: "delegate-run",
					error: "no_task",
					message: "Pass a task for the sub-agent to run.",
					nextAction: 'dgk delegate-run "find where the config lives" --persona scout',
				});
			}
			const persona = typeof input.options?.persona === "string" ? input.options.persona : "scout";
			const isChain = input.options?.chain === true;
			// The pipeline: each persona refines the previous step's output (the delegate threads it).
			const chainSteps: ChainStep[] = [
				{ persona: "scout", task },
				{ persona: "planner", task: "Turn the scout's findings into a plan." },
				{ persona: "worker", task: "Execute the plan and summarize the result." },
			];
			const artifacts = defaultDelegationArtifacts();
			const missing = missingDelegationArtifacts(artifacts);
			if (missing.length > 0) {
				return buildJsonErrorEnvelope({
					command: "delegate-run",
					operation: "delegate-run",
					error: "artifacts_missing",
					message: `Build the runtime artifacts first (missing: ${missing.join(", ")}).`,
					nextAction:
						"pnpm --filter @refarm.dev/tractor run build && pnpm --filter @refarm.dev/agent run build:wasm && pnpm --filter @refarm.dev/delegate run build:wasm",
				});
			}
			const useMock = input.options?.mock === true;
			try {
				let modelEnv: NodeJS.ProcessEnv | undefined;
				let mockStop: (() => Promise<void>) | undefined;
				if (useMock) {
					const { ModelMockServer, says } = await import("@refarm.dev/model-mock");
					const mock = await new ModelMockServer({ repeatLast: true }).start();
					// Each chain step gets its own scripted line so the threading is visible; single reuses one.
					if (isChain) {
						for (const step of chainSteps) mock.queue(says(`[${step.persona}] refined the input`));
					} else {
						mock.queue(says(`[${persona}] handled: ${task}`));
					}
					modelEnv = mock.env;
					mockStop = () => mock.stop();
				}
				try {
					if (isChain) {
						const result = await runLiveChain({ steps: chainSteps, ...(modelEnv ? { modelEnv } : {}) });
						return buildJsonSuccessEnvelope({
							command: "delegate-run",
							operation: "delegate-run",
							nextCommand: "dgk agent-run",
							nextCommands: ["dgk agent-run"],
							extra: {
								mode: "chain",
								mock: useMock,
								pluginsLoaded: result.pluginsLoaded,
								// A multi-level pipeline: one extension orchestrating N governed sub-agents.
								pipeline: chainSteps.map((s) => s.persona),
								recursion: "delegate:chain → N× agent:respond, each step's output threaded into the next",
								dispatched: result.dispatched,
								...(result.content ? { content: result.content } : {}),
							},
						});
					}
					const result = await runLiveDelegation({ persona, task, ...(modelEnv ? { modelEnv } : {}) });
					return buildJsonSuccessEnvelope({
						command: "delegate-run",
						operation: "delegate-run",
						nextCommand: "dgk agent-run",
						nextCommands: ["dgk agent-run"],
						extra: {
							mode: "single",
							task,
							persona,
							mock: useMock,
							pluginsLoaded: result.pluginsLoaded,
							recursion: "delegate → agent:respond (host-mediated call_plugin, under a persona)",
							dispatched: result.dispatched,
							...(result.content ? { content: result.content } : {}),
						},
					});
				} finally {
					await mockStop?.();
				}
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "delegate-run",
					operation: "delegate-run",
					error: "delegation_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the tractor binary + agent/delegate built, and (without --mock) a model is configured.",
				});
			}
		},
	};
}
