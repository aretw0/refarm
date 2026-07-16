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
import { awaitAuditLine } from "./live-runtime.js";

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
	/** Was the runaway effort ACCEPTED for dispatch (the POST returned ok, the host was not blocked)? */
	crashDispatched: boolean;
	/** Did the AGENT complete a full respond cycle AFTER the crash — an `agent:response:done` in the
	 * audit trail, proving the host trapped+respawned the runaway and kept serving (not just a 200)? */
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

	// A refarmDir for the audit trail: the post-crash agent run writes `agent:response:done` here,
	// which is how survival is OBSERVED (the POST body carries only an effortId — the response is
	// delivered async, so a bare 200 proves nothing about the agent actually completing).
	const refarmDir = mkdtempSync(join(tmpdir(), "t1-resil-audit-"));

	let daemon: RuntimeDaemonHandle | undefined;
	try {
		daemon = await startRuntimeDaemon({
			binaryPath: artifacts.tractorBinary,
			plugins: [artifacts.providerWasm, agentInstall.wasmPath, crashInstall.wasmPath],
			wsPort: options.wsPort ?? 42096,
			httpPort: options.httpPort ?? 42097,
			securityMode: "none",
			readyTimeoutMs: 40_000,
			refarmDir,
			// A short epoch budget so the runaway on_event is trapped in ~1-2s (not the 60s default).
			env: { ...mock.env, REFARM_ON_EVENT_TIMEOUT_MS: String(options.onEventTimeoutMs ?? 1500) },
		});
		const plugins = (await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json()) as { loaded?: string[] };
		const pluginsLoaded = Array.isArray(plugins.loaded) ? plugins.loaded : [];

		// Fire the runaway event at the crash plugin. Its on_event spins forever; the host traps
		// the store under the epoch budget and the supervisor respawns it. The dispatch POST itself
		// returns (the effort is delivered async), so the host is never blocked waiting on the guest.
		const replyRef = `t1-resil-crash-${Date.now()}`;
		// Dispatch the runaway. The POST returns (the effort is delivered async), so the host is never
		// blocked on the guest; CAPTURE that the effort was accepted — observed, not assumed true.
		const crashRes = await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
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
		const crashDispatched = crashRes?.ok === true;

		// Give the epoch trap + respawn a moment (budget + supervisor cooldown).
		await new Promise((r) => setTimeout(r, (options.onEventTimeoutMs ?? 1500) + 1500));

		// The proof: the host is still up and serving — dispatch to the AGENT after the crash and
		// wait for its `agent:response:done` in the audit trail. A completed respond cycle (not a
		// bare 200 on an async dispatch) is the observed evidence the host trapped+respawned the
		// runaway and kept serving.
		await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: `t1-resil-check-${Date.now()}`,
				submittedAt: new Date().toISOString(),
				tasks: [{ id: "t1-resil-check-0", pluginId: "agent", fn: "respond", args: { prompt: "still alive?" } }],
			}),
		}).catch(() => undefined);
		const done = await awaitAuditLine(refarmDir, (l) => l.event === "agent:response:done", 15_000);
		return { pluginsLoaded, crashDispatched, survivedAndResponds: done !== undefined };
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
						// … the host trapped it, respawned, and STILL serves — the agent COMPLETED a respond
						// cycle after the crash (agent:response:done in the audit trail), not just a 200.
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
