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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultArtifacts, missingArtifacts, type LiveRecursionArtifacts } from "./live-recursion.js";

/**
 * OBSERVABILITY — the machine shows what it does, turn by turn.
 *
 * On every real WASM run the agent emits `agent:*` lifecycle events (prompt:start, route:selected,
 * iteration, tool:call, response:done, error, budget:blocked), and the host appends each with its
 * FULL payload to `{refarmDir}/scarecrow-audit.ndjson` (the same tamper-evidence trail
 * governance-audit reads, filtered to host-effects). This reads the AGENT side of that trail and
 * projects a run's timeline: which model was routed and why, each iteration, each tool call, the
 * final tokens — the execution made legible.
 *
 * Read the audit file (full payload), NOT streams/activity.ndjson (the fold drops tokens/model)
 * nor GET /efforts/:id/logs (it drops progress phases). Events correlate by `prompt_ref` (the
 * run's own key), not effortId — there is no join in the runtime, so a single-run demo groups by
 * the one prompt_ref present.
 */

/** One parsed `agent:*` audit line — the event name plus its full (merged) payload. */
export interface AgentEventLine {
	event: string;
	ts?: number;
	prompt_ref?: string;
	[k: string]: unknown;
}

/** Read + parse the `agent:*` lines from `{refarmDir}/scarecrow-audit.ndjson`. Mirrors
 * live-audit.ts's readAuditTrail, swapping the `host-effect:` filter for `agent:`. */
export function readAgentEvents(refarmDir: string): AgentEventLine[] {
	const path = join(refarmDir, "scarecrow-audit.ndjson");
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf-8")
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as AgentEventLine;
			} catch {
				return undefined;
			}
		})
		.filter((l): l is AgentEventLine => l !== undefined)
		.filter((l) => typeof l.event === "string" && l.event.startsWith("agent:"));
}

/** The projected timeline of one agent run — the reusable shape a surface renders. */
export interface AgentTimeline {
	/** The run's correlation key. */
	promptRef?: string;
	/** The route the router chose and WHY (ADR-012): provider/model/source/cost_tier. */
	route?: { provider?: string; model?: string; source?: string; cost_tier?: string };
	/** The react-loop iterations reached (from agent:iteration), and the budget max. */
	iterations: number;
	maxIterations?: number;
	/** Each tool call the model made, in order. */
	toolCalls: Array<{ tool: string; ok: boolean; argsSummary?: string }>;
	/** The terminal outcome. */
	outcome: "done" | "error" | "budget_blocked" | "unknown";
	/** Token usage from agent:response:done (0 unless the model reported usage). */
	tokensIn: number;
	tokensOut: number;
	/** Wall time of the run, ms. */
	durationMs?: number;
	/** The error message when the run failed. */
	error?: string;
	/** The raw ordered event names, for a caller that wants the full sequence. */
	sequence: string[];
}

/**
 * Project a run's `agent:*` events into a timeline. When `promptRef` is given, only that run's
 * events are used; otherwise all events are folded (a single-run demo has one prompt_ref). PURE.
 */
export function parseAgentTimeline(events: AgentEventLine[], promptRef?: string): AgentTimeline {
	const runEvents = (promptRef ? events.filter((e) => e.prompt_ref === promptRef) : events)
		.slice()
		.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

	const timeline: AgentTimeline = {
		promptRef: promptRef ?? runEvents.find((e) => e.prompt_ref)?.prompt_ref,
		iterations: 0,
		toolCalls: [],
		outcome: "unknown",
		tokensIn: 0,
		tokensOut: 0,
		sequence: runEvents.map((e) => e.event),
	};

	for (const e of runEvents) {
		switch (e.event) {
			case "agent:route:selected":
				timeline.route = {
					provider: e.provider as string | undefined,
					model: e.model as string | undefined,
					source: e.source as string | undefined,
					cost_tier: e.cost_tier as string | undefined,
				};
				break;
			case "agent:iteration":
				// iteration is 0-based → count of iterations reached is index+1.
				timeline.iterations = Math.max(timeline.iterations, ((e.iteration as number) ?? 0) + 1);
				if (typeof e.max === "number") timeline.maxIterations = e.max;
				break;
			case "agent:tool:call":
				timeline.toolCalls.push({
					tool: String(e.tool ?? "?"),
					ok: e.ok !== false,
					argsSummary: typeof e.args_summary === "string" ? e.args_summary : undefined,
				});
				break;
			case "agent:response:done":
				timeline.outcome = "done";
				timeline.tokensIn = (e.tokens_in as number) ?? 0;
				timeline.tokensOut = (e.tokens_out as number) ?? 0;
				if (typeof e.duration_ms === "number") timeline.durationMs = e.duration_ms;
				break;
			case "agent:error":
				timeline.outcome = "error";
				timeline.error = typeof e.error === "string" ? e.error : undefined;
				break;
			case "agent:budget:blocked":
				timeline.outcome = "budget_blocked";
				break;
		}
	}
	return timeline;
}

export interface RunTelemetryOptions {
	artifacts?: LiveRecursionArtifacts;
	modelEnv?: NodeJS.ProcessEnv;
	targetFile?: string;
	wsPort?: number;
	httpPort?: number;
}

export interface TelemetryResult {
	pluginsLoaded: string[];
	timeline: AgentTimeline;
	/** How many agent:* events the run produced (before projection). */
	eventCount: number;
}

/**
 * Boot the agent live, drive a multi-iteration run (the mock scripts tool calls so the react loop
 * iterates), and project the timeline from the audit trail. Always stops the daemon.
 */
export async function runTelemetry(options: RunTelemetryOptions): Promise<TelemetryResult> {
	const artifacts = options.artifacts ?? defaultArtifacts();
	const agentInstall = installPluginForRuntime({
		wasmPath: artifacts.agentWasm,
		manifestTemplatePath: artifacts.agentManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-telemetry-agent-")),
	});
	const refarmDir = mkdtempSync(join(tmpdir(), "t1-telemetry-base-"));
	const targetFile = options.targetFile ?? join(refarmDir, "sample.txt");
	if (!existsSync(targetFile)) writeFileSync(targetFile, "an observable run read this\n", "utf-8");

	let daemon: RuntimeDaemonHandle | undefined;
	try {
		daemon = await startRuntimeDaemon({
			binaryPath: artifacts.tractorBinary,
			plugins: [artifacts.providerWasm, agentInstall.wasmPath],
			wsPort: options.wsPort ?? 42094,
			httpPort: options.httpPort ?? 42095,
			securityMode: "none",
			readyTimeoutMs: 40_000,
			refarmDir,
			...(options.modelEnv ? { env: options.modelEnv } : {}),
		});
		const plugins = (await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json()) as { loaded?: string[] };
		const pluginsLoaded = Array.isArray(plugins.loaded) ? plugins.loaded : [];

		await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: `t1-telemetry-${Date.now()}`,
				submittedAt: new Date().toISOString(),
				tasks: [{ id: "t1-telemetry-task-0", pluginId: "agent", fn: "respond", args: { prompt: `Read ${targetFile}` } }],
			}),
		});
		// Let the run's events + the audit appends flush.
		await new Promise((r) => setTimeout(r, 600));
		const events = readAgentEvents(refarmDir);
		return { pluginsLoaded, timeline: parseAgentTimeline(events), eventCount: events.length };
	} finally {
		await daemon?.stop();
	}
}

/**
 * `agent-telemetry [--mock]` — run the agent live and report the run's TIMELINE from the audit
 * trail: the model route (and why), each iteration, each tool call, and the final tokens. With
 * `--mock` a scripted multi-turn model drives real iterations + tool calls offline.
 */
export function createAgentTelemetryCapability(): CapabilityDescriptor {
	return {
		name: "agent-telemetry",
		summary: "Run the agent live and report the execution timeline (route, iterations, tool calls, tokens)",
		options: [
			{ name: "mock", kind: "boolean", summary: "Script a deterministic multi-turn model (offline, real iterations)" },
		],
		transports: { http: { path: "/agent/telemetry" } },
		renderers: { tui: { section: "agent" }, web: { route: "/agent-telemetry", icon: "activity" }, ide: { command: "dgk.agent-telemetry" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const artifacts = defaultArtifacts();
			const missing = missingArtifacts(artifacts);
			if (missing.length > 0) {
				return buildJsonErrorEnvelope({
					command: "agent-telemetry",
					operation: "agent-telemetry",
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
				let sampleFile: string | undefined;
				if (useMock) {
					const { ModelMockServer, says, toolCall } = await import("@refarm.dev/model-mock");
					const mock = await new ModelMockServer({ repeatLast: true }).start();
					sampleFile = join(mkdtempSync(join(tmpdir(), "t1-telemetry-src-")), "sample.txt");
					writeFileSync(sampleFile, "an observable run read this\n", "utf-8");
					// A multi-turn script → the react loop iterates, producing real agent:iteration +
					// agent:tool:call events. usage is scripted so tokens are non-zero (else the mock
					// reports 0/0 and the timeline's tokens would be empty).
					mock
						.queue(toolCall("read_file", { path: sampleFile }, { usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } }))
						.queue(toolCall("read_file", { path: sampleFile }, { usage: { prompt_tokens: 90, completion_tokens: 20, total_tokens: 110 } }))
						.queue(says("Observed the run — route, iterations, tool calls, tokens are in the timeline."));
					modelEnv = mock.env;
					mockStop = () => mock.stop();
				}
				try {
					const result = await runTelemetry({
						...(modelEnv ? { modelEnv } : {}),
						...(sampleFile ? { targetFile: sampleFile } : {}),
					});
					const t = result.timeline;
					return buildJsonSuccessEnvelope({
						command: "agent-telemetry",
						operation: "agent-telemetry",
						nextCommand: "dgk governance-audit",
						nextCommands: ["dgk governance-audit"],
						extra: {
							mock: useMock,
							pluginsLoaded: result.pluginsLoaded,
							eventCount: result.eventCount,
							// The run's timeline — the execution made legible, from the runtime's own events.
							timeline: {
								route: t.route,
								iterations: t.iterations,
								maxIterations: t.maxIterations,
								toolCalls: t.toolCalls,
								outcome: t.outcome,
								tokensIn: t.tokensIn,
								tokensOut: t.tokensOut,
								durationMs: t.durationMs,
								...(t.error ? { error: t.error } : {}),
							},
							source: "scarecrow-audit.ndjson (agent:* lifecycle, full payload — host-written)",
							note: "USD cost is not an event; tokens are real only when the model reports usage.",
						},
					});
				} finally {
					await mockStop?.();
				}
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "agent-telemetry",
					operation: "agent-telemetry",
					error: "telemetry_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the tractor binary + agent are built, and (without --mock) a model is configured.",
				});
			}
		},
	};
}
