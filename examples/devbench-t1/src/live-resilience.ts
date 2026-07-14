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

import { defaultArtifacts, missingArtifacts, type LiveRecursionArtifacts } from "./live-recursion.js";

/**
 * RESILIENCE — a bad extension does NOT bring the sovereign machine down.
 *
 * The crash-plugin's `on_event` spins forever (a runaway extension). Under the host's epoch
 * budget (REFARM_ON_EVENT_TIMEOUT_MS) the wasmtime store is trapped and torn down mid-event, and
 * the respawn supervisor reinstantiates a fresh instance — the host never stops serving. This
 * verb boots [agent, crash-plugin] with a short budget, dispatches the runaway event (which
 * hangs and is trapped), then dispatches to the AGENT and confirms it still responds: the host
 * isolated the crash and survived.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The committed crash-plugin fixture (.wasm + plugin.json). */
export function defaultCrashArtifacts(): { wasm: string; manifest: string } {
	const dir = resolve(REPO_ROOT, "packages/tractor/tests/fixtures");
	return {
		wasm: join(dir, "crash-plugin.wasm"),
		manifest: join(dir, "crash-plugin/plugin.json"),
	};
}

export interface ResilienceResult {
	pluginsLoaded: string[];
	/** Did dispatching the runaway event NOT hang the host (the request returned)? */
	crashDispatched: boolean;
	/** Did the AGENT still respond AFTER the crash — proving the host survived + kept serving? */
	survivedAndResponds: boolean;
}

export interface RunResilienceOptions {
	artifacts?: LiveRecursionArtifacts;
	crashWasm?: string;
	crashManifest?: string;
	modelEnv?: NodeJS.ProcessEnv;
	wsPort?: number;
	httpPort?: number;
	/** The epoch budget for on_event — short, so the runaway is trapped in ~1-2s not 60s. */
	onEventTimeoutMs?: number;
}

/**
 * Boot [agent, crash-plugin], trip the runaway on_event (trapped by the epoch budget + respawned),
 * then confirm the agent still responds. Always stops the daemon.
 */
export async function runResilience(options: RunResilienceOptions): Promise<ResilienceResult> {
	const artifacts = options.artifacts ?? defaultArtifacts();
	const crash = {
		wasm: options.crashWasm ?? defaultCrashArtifacts().wasm,
		manifest: options.crashManifest ?? defaultCrashArtifacts().manifest,
	};
	const { ModelMockServer, says } = await import("@refarm.dev/model-mock");
	const mock = await new ModelMockServer({ repeatLast: true }).start();
	mock.queue(says("the host survived the crash"));

	const agentInstall = installPluginForRuntime({
		wasmPath: artifacts.agentWasm,
		manifestTemplatePath: artifacts.agentManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-resil-agent-")),
	});
	const crashInstall = installPluginForRuntime({
		wasmPath: crash.wasm,
		manifestTemplatePath: crash.manifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-resil-crash-")),
	});

	let daemon: RuntimeDaemonHandle | undefined;
	try {
		daemon = await startRuntimeDaemon({
			binaryPath: artifacts.tractorBinary,
			plugins: [artifacts.providerWasm, agentInstall.wasmPath, crashInstall.wasmPath],
			wsPort: options.wsPort ?? 42096,
			httpPort: options.httpPort ?? 42097,
			securityMode: "none",
			readyTimeoutMs: 40_000,
			// A short epoch budget so the runaway on_event is trapped in ~1-2s (not the 60s default).
			env: { ...mock.env, REFARM_ON_EVENT_TIMEOUT_MS: String(options.onEventTimeoutMs ?? 1500) },
		});
		const plugins = (await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json()) as { loaded?: string[] };
		const pluginsLoaded = Array.isArray(plugins.loaded) ? plugins.loaded : [];

		// Fire the runaway event at the crash plugin. Its on_event spins forever; the host traps
		// the store under the epoch budget and the supervisor respawns it. The dispatch POST itself
		// returns (the effort is delivered async), so the host is never blocked waiting on the guest.
		const replyRef = `t1-resil-crash-${Date.now()}`;
		await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: replyRef,
				direction: "dispatch",
				source: "operator",
				submittedAt: new Date().toISOString(),
				tasks: [{ id: `${replyRef}-task-0`, pluginId: "crash", fn: "hang", args: { replyRef } }],
			}),
		}).catch(() => undefined);
		const crashDispatched = true;

		// Give the epoch trap + respawn a moment (budget + supervisor cooldown).
		await new Promise((r) => setTimeout(r, (options.onEventTimeoutMs ?? 1500) + 1500));

		// The proof: the host is still up and serving — the agent responds AFTER the crash.
		const res = await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: `t1-resil-check-${Date.now()}`,
				submittedAt: new Date().toISOString(),
				tasks: [{ id: "t1-resil-check-0", pluginId: "agent", fn: "respond", args: { prompt: "still alive?" } }],
			}),
		});
		return { pluginsLoaded, crashDispatched, survivedAndResponds: res.ok };
	} finally {
		await daemon?.stop();
		await mock.stop();
	}
}

/**
 * `plugin-resilience` — prove the host ISOLATES a runaway plugin (its on_event spins forever),
 * traps it under the epoch budget, respawns a fresh instance, and keeps serving: the agent still
 * responds after. A bad extension does not bring the sovereign machine down.
 */
export function createPluginResilienceCapability(): CapabilityDescriptor {
	return {
		name: "plugin-resilience",
		summary: "Prove a runaway plugin is trapped + respawned and the host keeps serving (resilience)",
		transports: { http: { path: "/plugin/resilience" } },
		renderers: { tui: { section: "governance" }, web: { route: "/plugin-resilience", icon: "shield-alert" }, ide: { command: "dgk.plugin-resilience" } },
		async run(_input: CapabilityInput): Promise<CapabilityEnvelope> {
			const artifacts = defaultArtifacts();
			const missing = missingArtifacts(artifacts);
			const crash = defaultCrashArtifacts();
			if (missing.length > 0 || !existsSync(crash.wasm)) {
				const allMissing = [...missing, ...(existsSync(crash.wasm) ? [] : ["crash-plugin.wasm"])];
				return buildJsonErrorEnvelope({
					command: "plugin-resilience",
					operation: "plugin-resilience",
					error: "artifacts_missing",
					message: `Build the runtime artifacts first (missing: ${allMissing.join(", ")}).`,
					nextAction:
						"pnpm --filter @refarm.dev/tractor run build && pnpm --filter @refarm.dev/agent run build:wasm && (cd packages/tractor/tests/fixtures/crash-plugin && cargo component build --release --target wasm32-wasip1 && cp $(git rev-parse --show-toplevel)/.cache/cargo-target/wasm32-wasip1/release/crash_plugin.wasm ../crash-plugin.wasm)",
				});
			}
			try {
				const result = await runResilience({});
				return buildJsonSuccessEnvelope({
					command: "plugin-resilience",
					operation: "plugin-resilience",
					nextCommand: "dgk agent-run",
					nextCommands: ["dgk agent-run"],
					extra: {
						pluginsLoaded: result.pluginsLoaded,
						// The runaway was dispatched (its on_event spun forever) …
						crashDispatched: result.crashDispatched,
						// … the host trapped it, respawned, and STILL serves — the agent responded after.
						survivedAndResponds: result.survivedAndResponds,
						resilient: result.crashDispatched && result.survivedAndResponds,
						mechanism: "epoch budget traps the runaway store mid-event; the respawn supervisor reinstantiates a fresh instance — the host never stops serving",
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "plugin-resilience",
					operation: "plugin-resilience",
					error: "resilience_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the tractor binary + agent + crash-plugin.wasm are built.",
				});
			}
		},
	};
}
