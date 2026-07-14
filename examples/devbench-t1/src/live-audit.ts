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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

import { defaultArtifacts, missingArtifacts, type LiveRecursionArtifacts } from "./live-recursion.js";

/**
 * GOVERNANCE, EXECUTED — the runtime evidence made REAL. The governance PoC's runtime
 * evidence was a synthetic TS object; this reads the tamper-evidence audit log the tractor
 * host ACTUALLY writes. On every real WASM run the host appends `host-effect:*` lines to
 * `{refarmDir}/scarecrow-audit.ndjson` (observer.rs, ADR-067) — a sovereign record of every
 * fs/shell effect a plugin performed, that no plugin can suppress (the host owns the log).
 *
 * This verb boots the agent live, points --refarm-dir at a temp dir, scripts the model to
 * call a real fs tool (read_file), and reports the audit lines the host wrote — governance
 * evidence FROM the runtime under sandbox, not a TS literal.
 */

/** One parsed audit line: the sovereign record of a host effect. */
export interface AuditLine {
	event: string;
	pluginId?: string;
	ts?: number;
	[k: string]: unknown;
}

export interface GovernanceAuditResult {
	pluginsLoaded: string[];
	/** The host-effect audit lines the runtime wrote (the tamper-evidence trail). */
	audit: AuditLine[];
	/** What the SANDBOXED scarecrow observer plugin recorded (its ScarecrowObservation
	 * nodes), when it was loaded — governance happening IN-sandbox. */
	observations: Array<Record<string, unknown>>;
	reachedModel: boolean;
}

/** Read + parse `{refarmDir}/scarecrow-audit.ndjson` — the host-effect audit trail. */
export function readAuditTrail(refarmDir: string): AuditLine[] {
	const path = join(refarmDir, "scarecrow-audit.ndjson");
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf-8")
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as AuditLine;
			} catch {
				return undefined;
			}
		})
		.filter((l): l is AuditLine => l !== undefined)
		.filter((l) => typeof l.event === "string" && l.event.startsWith("host-effect:"));
}

export interface RunGovernanceAuditOptions {
	artifacts?: LiveRecursionArtifacts;
	modelEnv?: NodeJS.ProcessEnv;
	wsPort?: number;
	httpPort?: number;
	/** A file the agent's scripted read_file tool reads (a real fs:read effect). */
	targetFile?: string;
	/** The sandboxed scarecrow observer plugin (.wasm + plugin.json dir). When provided, it
	 * is loaded beside the agent, WATCHES the host effects, and its observation nodes are
	 * read back — the governor as a sandboxed extension. */
	observerWasm?: string;
	observerManifest?: string;
	resultTimeoutMs?: number;
}

/** Read the scarecrow observer's ScarecrowObservation nodes (what the sandboxed auditor saw). */
async function readObservations(sidecarBaseUrl: string): Promise<Array<Record<string, unknown>>> {
	const res = await fetch(`${sidecarBaseUrl}/nodes?type=ScarecrowObservation`);
	if (!res.ok) return [];
	const body = (await res.json()) as { nodes?: Array<Record<string, unknown>> };
	return Array.isArray(body.nodes) ? body.nodes : [];
}

/**
 * Boot the agent live with a temp `--refarm-dir`, drive a real fs effect (a scripted
 * read_file tool call), and return the audit lines the host wrote. Always stops the daemon.
 */
export async function runGovernanceAudit(options: RunGovernanceAuditOptions): Promise<GovernanceAuditResult> {
	const artifacts = options.artifacts ?? defaultArtifacts();
	const agentInstall = installPluginForRuntime({
		wasmPath: artifacts.agentWasm,
		manifestTemplatePath: artifacts.agentManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-audit-agent-")),
	});
	// The sovereign base dir the host writes the audit log to — a temp dir so we read it back.
	const refarmDir = mkdtempSync(join(tmpdir(), "t1-audit-base-"));
	// A real file for the agent's read_file tool to touch (a genuine host-effect:fs:read).
	const targetFile = options.targetFile ?? join(refarmDir, "sample.txt");
	if (!existsSync(targetFile)) writeFileSync(targetFile, "governed extension read this file\n", "utf-8");

	// The SANDBOXED observer plugin, when provided: it watches the host effects and records
	// its verdicts as nodes. Reading those back needs a file-backed namespace (its store_node
	// must be visible to GET /nodes — the same :memory: gotcha as delegate/code-ops).
	const observer = options.observerWasm && options.observerManifest
		? installPluginForRuntime({
				wasmPath: options.observerWasm,
				manifestTemplatePath: options.observerManifest,
				installDir: mkdtempSync(join(tmpdir(), "t1-audit-observer-")),
			})
		: undefined;

	let daemon: RuntimeDaemonHandle | undefined;
	try {
		daemon = await startRuntimeDaemon({
			binaryPath: artifacts.tractorBinary,
			plugins: observer
				? [artifacts.providerWasm, observer.wasmPath, agentInstall.wasmPath]
				: [artifacts.providerWasm, agentInstall.wasmPath],
			wsPort: options.wsPort ?? 42076,
			httpPort: options.httpPort ?? 42077,
			securityMode: "none",
			readyTimeoutMs: 40_000,
			refarmDir,
			// A file-backed namespace so the observer's ScarecrowObservation nodes are readable.
			...(observer ? { namespace: mkdtempSync(join(tmpdir(), "t1-audit-store-")) } : {}),
			...(options.modelEnv ? { env: options.modelEnv } : {}),
		});

		const plugins = (await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json()) as { loaded?: string[] };
		const pluginsLoaded = Array.isArray(plugins.loaded) ? plugins.loaded : [];

		const effort = {
			id: `t1-audit-${Date.now()}`,
			submittedAt: new Date().toISOString(),
			tasks: [{ id: "t1-audit-task-0", pluginId: "agent", fn: "respond", args: { prompt: `Read ${targetFile}` } }],
		};
		const res = await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(effort),
		});

		// The audit log + the observer's nodes are written as the effect executes; give the
		// append + the observer's store_node a moment to flush.
		await new Promise((r) => setTimeout(r, 500));
		return {
			pluginsLoaded,
			reachedModel: res.ok,
			audit: readAuditTrail(refarmDir),
			observations: observer ? await readObservations(daemon.sidecarBaseUrl) : [],
		};
	} finally {
		await daemon?.stop();
	}
}

/** Resolve the built scarecrow observer plugin artifacts (its .wasm + plugin.json). */
export function defaultObserverArtifacts(): { wasm: string; manifest: string } {
	const root = REPO_ROOT;
	return {
		wasm: join(root, "packages/scarecrow-plugin/dist/plugin.wasm"),
		manifest: join(root, "packages/scarecrow-plugin/dist/plugin.json"),
	};
}

/**
 * `governance-audit [--mock]` — run the agent live and report the REAL host-effect audit
 * trail the runtime wrote (the tamper-evidence record governance cites). With `--mock` the
 * model is scripted to call `read_file` (a genuine fs:read), so the audit shows a real
 * host-effect line; without it the agent reaches the configured model.
 */
export function createGovernanceAuditCapability(): CapabilityDescriptor {
	return {
		name: "governance-audit",
		summary: "Run the agent live and report the REAL host-effect audit trail (tamper-evidence, from the runtime)",
		options: [
			{ name: "mock", kind: "boolean", summary: "Script the model to call read_file (offline, a real fs effect)" },
			{ name: "observer", kind: "boolean", summary: "Also load the sandboxed scarecrow observer plugin and report what it witnessed" },
		],
		transports: { http: { path: "/governance/audit" } },
		renderers: { tui: { section: "governance" }, web: { route: "/governance-audit", icon: "shield" }, ide: { command: "dgk.governance-audit" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const artifacts = defaultArtifacts();
			const missing = missingArtifacts(artifacts);
			if (missing.length > 0) {
				return buildJsonErrorEnvelope({
					command: "governance-audit",
					operation: "governance-audit",
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
					// The file the scripted read_file tool touches (a real host-effect:fs:read).
					sampleFile = join(mkdtempSync(join(tmpdir(), "t1-audit-src-")), "sample.txt");
					writeFileSync(sampleFile, "governed extension read this file\n", "utf-8");
					mock
						.queue(toolCall("read_file", { path: sampleFile }))
						.queue(says("Read the file — the host recorded the effect in the audit trail."));
					modelEnv = mock.env;
					mockStop = () => mock.stop();
				}
				// The sandboxed observer: load the scarecrow plugin too (if built) so a caller can
				// SEE governance happening in-sandbox — the observer's own verdicts.
				const withObserver = input.options?.observer === true;
				const observerArtifacts = defaultObserverArtifacts();
				const observerReady = withObserver && existsSync(observerArtifacts.wasm) && existsSync(observerArtifacts.manifest);
				try {
					const result = await runGovernanceAudit({
						...(modelEnv ? { modelEnv } : {}),
						...(sampleFile ? { targetFile: sampleFile } : {}),
						...(observerReady
							? { observerWasm: observerArtifacts.wasm, observerManifest: observerArtifacts.manifest }
							: {}),
					});
					const hostEffects = result.audit.filter((l) => l.event.startsWith("host-effect:"));
					return buildJsonSuccessEnvelope({
						command: "governance-audit",
						operation: "governance-audit",
						nextCommand: "dgk governance-poc",
						nextCommands: ["dgk governance-poc"],
						extra: {
							mock: useMock,
							pluginsLoaded: result.pluginsLoaded,
							reachedModel: result.reachedModel,
							// The tamper-evidence trail — governance's runtime evidence, FROM the host.
							auditLineCount: result.audit.length,
							hostEffects: hostEffects.map((l) => ({ event: l.event, pluginId: l.pluginId })),
							source: "scarecrow-audit.ndjson (host-written, no plugin can suppress it)",
							// What the SANDBOXED governor witnessed (its own verdicts) — the governor
							// is itself a least-privileged extension.
							...(withObserver
								? {
										observerLoaded: observerReady && result.pluginsLoaded.includes("scarecrow"),
										observations: result.observations.map((o) => ({
											effect: o.effect,
											risk: o.risk,
											verdict: o.verdict,
										})),
									}
								: {}),
						},
					});
				} finally {
					await mockStop?.();
				}
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "governance-audit",
					operation: "governance-audit",
					error: "audit_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the tractor binary + agent built, and (without --mock) a model is configured.",
				});
			}
		},
	};
}
