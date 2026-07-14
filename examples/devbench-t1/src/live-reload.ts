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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultArtifacts, missingArtifacts, type LiveRecursionArtifacts } from "./live-recursion.js";

/**
 * RUNTIME TINKERING — hot-reload a plugin WITHOUT restarting the host.
 *
 * The developer's-bench promise of the PROCESS mode: edit an extension and reload it live, the
 * machine never coming down. The tractor daemon is booted with a reload host (`with_reload`), so
 * `POST /plugins/reload` swaps a plugin's code for real (unregister → re-read its bytes, the
 * content-addressed cache recompiling only if they changed → re-register). This verb boots the
 * agent, hot-reloads it, and proves the host STAYED UP and the plugin still dispatches after —
 * the "runtime tinkering, no restart" the theme asks for, executed.
 */

export interface ReloadResult {
	pluginsLoaded: string[];
	/** The plugin ids the host actually swapped (from POST /plugins/reload). */
	reloaded: string[];
	skipped: string[];
	/** Did the agent still respond AFTER the hot-reload? Proves the host stayed up + the plugin
	 * is live again (not just that the endpoint returned). */
	respondedAfterReload: boolean;
}

/** POST /plugins/reload for the given ids (or all loaded when omitted). Surfaces the sidecar's
 * `errors[]` and an HTTP failure as a thrown error — a failed reload must NOT read as success. */
async function reloadPlugins(
	sidecarBaseUrl: string,
	pluginIds?: string[],
): Promise<{ reloaded: string[]; skipped: string[] }> {
	const res = await fetch(`${sidecarBaseUrl}/plugins/reload`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(pluginIds ? { plugin_ids: pluginIds } : {}),
	});
	if (!res.ok) {
		throw new Error(`reload endpoint failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as {
		reloaded?: string[];
		skipped?: string[];
		errors?: Array<{ pluginId?: string; error?: string }>;
	};
	if (Array.isArray(body.errors) && body.errors.length > 0) {
		const detail = body.errors.map((e) => `${e.pluginId ?? "?"}: ${e.error ?? "unknown"}`).join("; ");
		throw new Error(`reload reported errors: ${detail}`);
	}
	return {
		reloaded: Array.isArray(body.reloaded) ? body.reloaded : [],
		skipped: Array.isArray(body.skipped) ? body.skipped : [],
	};
}

/** Dispatch a trivial respond to the agent — used to prove it's live AFTER the reload. */
async function agentResponds(sidecarBaseUrl: string, modelEnvNote: string): Promise<boolean> {
	const res = await fetch(`${sidecarBaseUrl}/efforts`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			id: `t1-reload-check-${Date.now()}`,
			submittedAt: new Date().toISOString(),
			tasks: [{ id: "t1-reload-task-0", pluginId: "agent", fn: "respond", args: { prompt: modelEnvNote } }],
		}),
	});
	return res.ok;
}

/**
 * Boot [provider, agent], hot-reload the agent via POST /plugins/reload, and confirm the agent
 * still dispatches afterward — the host never restarted. Always stops the daemon.
 */
export async function runReload(artifacts?: LiveRecursionArtifacts): Promise<ReloadResult> {
	const a = artifacts ?? defaultArtifacts();
	const { ModelMockServer, says } = await import("@refarm.dev/model-mock");
	const mock = await new ModelMockServer({ repeatLast: true }).start();
	mock.queue(says("alive after reload"));

	const agentInstall = installPluginForRuntime({
		wasmPath: a.agentWasm,
		manifestTemplatePath: a.agentManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-reload-agent-")),
	});

	let daemon: RuntimeDaemonHandle | undefined;
	try {
		daemon = await startRuntimeDaemon({
			binaryPath: a.tractorBinary,
			plugins: [a.providerWasm, agentInstall.wasmPath],
			wsPort: 42092,
			httpPort: 42093,
			securityMode: "none",
			readyTimeoutMs: 40_000,
			env: mock.env,
		});
		const plugins = (await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json()) as { loaded?: string[] };
		const pluginsLoaded = Array.isArray(plugins.loaded) ? plugins.loaded : [];

		// HOT-RELOAD the agent — swap its code without restarting the daemon.
		const { reloaded, skipped } = await reloadPlugins(daemon.sidecarBaseUrl, ["agent"]);

		// The host is still up: the agent dispatches again after the reload.
		const respondedAfterReload = await agentResponds(daemon.sidecarBaseUrl, "still there?");

		return { pluginsLoaded, reloaded, skipped, respondedAfterReload };
	} finally {
		await daemon?.stop();
		await mock.stop();
	}
}

/**
 * `plugin-reload` — hot-reload a loaded plugin (default: the agent) without restarting the host,
 * then confirm it still dispatches. Runtime tinkering: edit/reload the extension live.
 */
export function createPluginReloadCapability(): CapabilityDescriptor {
	return {
		name: "plugin-reload",
		summary: "Hot-reload a plugin without restarting the host, then prove it still dispatches",
		transports: { http: { path: "/plugin/reload" } },
		renderers: { tui: { section: "governance" }, web: { route: "/plugin-reload", icon: "refresh-cw" }, ide: { command: "dgk.plugin-reload" } },
		async run(_input: CapabilityInput): Promise<CapabilityEnvelope> {
			const artifacts = defaultArtifacts();
			const missing = missingArtifacts(artifacts);
			if (missing.length > 0) {
				return buildJsonErrorEnvelope({
					command: "plugin-reload",
					operation: "plugin-reload",
					error: "artifacts_missing",
					message: `Build the runtime artifacts first (missing: ${missing.join(", ")}).`,
					nextAction:
						"pnpm --filter @refarm.dev/tractor run build && pnpm --filter @refarm.dev/agent run build:wasm && pnpm --filter @refarm.dev/source-provider-ref run build:plugin",
				});
			}
			try {
				const result = await runReload(artifacts);
				return buildJsonSuccessEnvelope({
					command: "plugin-reload",
					operation: "plugin-reload",
					nextCommand: "dgk agent-run",
					nextCommands: ["dgk agent-run"],
					extra: {
						pluginsLoaded: result.pluginsLoaded,
						// The host swapped the plugin's code in place …
						reloaded: result.reloaded,
						skipped: result.skipped,
						// … and stayed up: the agent dispatches again after the reload.
						respondedAfterReload: result.respondedAfterReload,
						hotReloaded: result.reloaded.includes("agent") && result.respondedAfterReload,
						mechanism: "POST /plugins/reload → TractorNative::reload_plugin (unregister → re-read bytes → re-register); the host never restarts",
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "plugin-reload",
					operation: "plugin-reload",
					error: "reload_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the tractor binary + agent are built.",
				});
			}
		},
	};
}
