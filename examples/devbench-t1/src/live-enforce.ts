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
	stampEvidence,
	writeEvidenceFiles,
	type EvidenceFile,
	type RuntimeDaemonHandle,
} from "@refarm.dev/capability-host/node";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultArtifacts, missingArtifacts, type LiveRecursionArtifacts } from "./live-recursion.js";
import { awaitAuditLine, readAuditLines } from "./live-runtime.js";

/**
 * GOVERNANCE, ENFORCED — the third face of the governance quartet, and the one that was missing.
 *
 * governance-poc DECIDES (grant/deny/review, pure policy). governance-audit RECORDS (the host's
 * tamper-evidence trail of effects that ran). Neither shows the host REFUSING an effect at the
 * sandbox boundary — every T1 live verb ran `securityMode: "none"`, where grants are permissive.
 *
 * This boots the SAME agent under `securityMode: "strict"` with a manifest that does NOT declare
 * `fs:read`, then scripts it to read a file. Under strict, the host's `enforce_permission` denies
 * the effect BEFORE it runs (host_effects_bridge/core.rs) — so no `host-effect:fs:read` line is
 * ever written to the audit trail. A permissive baseline run (the grant present) DOES produce that
 * line. The contrast is the proof: governance is not a parecer — the host recuses the effect.
 */

export interface EnforceResult {
	/** Did the DENIED run (strict, fs:read undeclared) produce a fs:read effect? Must be false. */
	deniedProducedEffect: boolean;
	/** Did the baseline run (grant present) produce a fs:read effect? Must be true — proves the
	 * scripted read really does hit the host when it is allowed. */
	baselineProducedEffect: boolean;
	deniedPluginsLoaded: string[];
	baselinePluginsLoaded: string[];
}

/** One posture: boot the agent with the given permissions + security mode, script a read, and
 * report whether a `host-effect:fs:read` line landed in the audit trail. */
async function runPosture(options: {
	artifacts: LiveRecursionArtifacts;
	permissions: string[];
	securityMode: "strict" | "none";
	wsPort: number;
	httpPort: number;
}): Promise<{ pluginsLoaded: string[]; producedFsRead: boolean }> {
	const { ModelMockServer, says, toolCall } = await import("@refarm.dev/model-mock");
	const agentInstall = installPluginForRuntime({
		wasmPath: options.artifacts.agentWasm,
		manifestTemplatePath: options.artifacts.agentManifest,
		installDir: mkdtempSync(join(tmpdir(), "t1-enforce-agent-")),
		// The tightened manifest — the whole point: install the SAME wasm with fs:read dropped.
		manifestOverrides: { permissions: options.permissions },
	});
	const refarmDir = mkdtempSync(join(tmpdir(), "t1-enforce-base-"));
	const targetFile = join(refarmDir, "sample.txt");
	writeFileSync(targetFile, "an effect the host may or may not permit\n", "utf-8");

	const mock = await new ModelMockServer({ repeatLast: true }).start();
	mock
		.queue(toolCall("read_file", { path: targetFile }))
		.queue(says("Attempted the read; the host decided whether the effect was allowed."));

	let daemon: RuntimeDaemonHandle | undefined;
	try {
		daemon = await startRuntimeDaemon({
			binaryPath: options.artifacts.tractorBinary,
			plugins: [options.artifacts.providerWasm, agentInstall.wasmPath],
			wsPort: options.wsPort,
			httpPort: options.httpPort,
			securityMode: options.securityMode,
			readyTimeoutMs: 40_000,
			refarmDir,
			env: mock.env,
		});
		const plugins = (await (await fetch(`${daemon.sidecarBaseUrl}/plugins`)).json()) as { loaded?: string[] };
		const pluginsLoaded = Array.isArray(plugins.loaded) ? plugins.loaded : [];

		await fetch(`${daemon.sidecarBaseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: `t1-enforce-${options.securityMode}-${Date.now()}`,
				submittedAt: new Date().toISOString(),
				tasks: [{ id: "t1-enforce-task-0", pluginId: "agent", fn: "respond", args: { prompt: `Read ${targetFile}` } }],
			}),
		});
		// Poll the audit trail for the fs:read effect instead of a blind sleep: the BASELINE
		// (granted) produces the line quickly → the poll returns fast; the DENIED posture never
		// produces it → the poll waits out its bounded deadline, then we read false. Robust to a
		// slow runner (a fixed 500ms could miss a late flush → a false "denied").
		// Wait for the run to COMPLETE (its terminal agent event), THEN check whether the fs:read
		// effect landed — do not race a fixed short deadline against the effect. The old approach
		// (await the fs:read line for a fixed 5s) was flaky: on a cold boot the BASELINE's granted
		// read arrived after the deadline, reading a false "no effect", which collapses the A/B (both
		// postures then look denied, indistinguishable from real enforcement). Waiting for the terminal
		// event is adaptive — as long as the run takes — and deterministic: once the run is done, the
		// effect (if the grant allowed it) has already been written to the trail.
		await awaitAuditLine(
			refarmDir,
			(l) => l.event === "agent:response:done" || l.event === "agent:error",
			30_000,
		);
		const producedFsRead = readAuditLines(refarmDir).some((l) => l.event === "host-effect:fs:read");
		return { pluginsLoaded, producedFsRead };
	} finally {
		await daemon?.stop();
		await mock.stop();
	}
}

/**
 * Run both postures: DENIED (strict, no fs:read grant) and BASELINE (fs:read granted). The
 * contrast — no effect when denied, an effect when granted — is the enforcement proof.
 */
export async function runEnforce(artifacts?: LiveRecursionArtifacts): Promise<EnforceResult> {
	const a = artifacts ?? defaultArtifacts();
	// DENIED: strict mode, the agent's manifest stripped of fs:read → the host must refuse.
	const denied = await runPosture({
		artifacts: a,
		permissions: ["network:outbound"], // deliberately NOT fs:read
		securityMode: "strict",
		wsPort: 42088,
		httpPort: 42089,
	});
	// BASELINE: fs:read granted → the same scripted read DOES hit the host (proves the read is real).
	const baseline = await runPosture({
		artifacts: a,
		permissions: ["fs:read", "network:outbound"],
		securityMode: "strict",
		wsPort: 42090,
		httpPort: 42091,
	});
	return {
		deniedProducedEffect: denied.producedFsRead,
		baselineProducedEffect: baseline.producedFsRead,
		deniedPluginsLoaded: denied.pluginsLoaded,
		baselinePluginsLoaded: baseline.pluginsLoaded,
	};
}

export interface GovernanceEnforceOptions {
	/** Persist the enforcement evidence (injected by the CLI — a node fs writer). Absent → the
	 * verdict is returned in the envelope only, nothing written. */
	writeEvidence?: (relativePath: string, content: string) => void | Promise<void>;
}

/**
 * `governance-enforce [--apply]` — prove the host REFUSES an undeclared effect at the sandbox
 * boundary. Boots the agent under strict mode without `fs:read`, scripts a read, and shows no
 * fs:read effect reached the audit trail — contrasted with a granted baseline that does. The
 * missing third face of the quartet: decide (governance-poc) → record (governance-audit) → ENFORCE.
 *
 * Unlike governance-poc's SYNTHETIC runtime evidence, this drives the real Rust runtime. `--apply`
 * persists that as `enforce-evidence.json` with a SHA-256 execution stamp — a runtime-evidence
 * artifact that came from an actual boundary refusal, not a TS literal.
 */
export function createGovernanceEnforceCapability(options: GovernanceEnforceOptions = {}): CapabilityDescriptor {
	return {
		name: "governance-enforce",
		summary: "Prove the host REFUSES an undeclared effect at the sandbox boundary (strict mode)",
		options: [{ name: "apply", kind: "boolean", summary: "Persist the real runtime evidence (enforce-evidence.json + stamp)" }],
		transports: { http: { path: "/governance/enforce" } },
		renderers: { tui: { section: "governance" }, web: { route: "/governance-enforce", icon: "shield-x" }, ide: { command: "dgk.governance-enforce" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const artifacts = defaultArtifacts();
			const missing = missingArtifacts(artifacts);
			if (missing.length > 0) {
				return buildJsonErrorEnvelope({
					command: "governance-enforce",
					operation: "governance-enforce",
					error: "artifacts_missing",
					message: `Build the runtime artifacts first (missing: ${missing.join(", ")}).`,
					nextAction:
						"pnpm --filter @refarm.dev/tractor run build && pnpm --filter @refarm.dev/agent run build:wasm && pnpm --filter @refarm.dev/source-provider-ref run build:plugin",
				});
			}
			try {
				const result = await runEnforce(artifacts);
				// The enforcement holds iff the denied run produced NO effect but the baseline did.
				const enforced = !result.deniedProducedEffect && result.baselineProducedEffect;
				const denied = {
					securityMode: "strict" as const,
					grantedFsRead: false,
					producedFsReadEffect: result.deniedProducedEffect, // expected: false (host refused)
				};
				const baseline = {
					securityMode: "strict" as const,
					grantedFsRead: true,
					producedFsReadEffect: result.baselineProducedEffect, // expected: true (effect ran)
				};
				const boundary = "enforce_permission denies an undeclared capability BEFORE the effect runs (host owns the gate)";

				// The REAL runtime evidence: the A/B from an actual boundary refusal on the Rust host,
				// stamped with the SHA-256 of its bytes. `--apply` persists it (distinct from the
				// report's `.dgk/report/` so the two never clobber a shared evidence.json).
				const apply = input.options?.apply === true;
				const evidenceFiles: EvidenceFile[] = [
					{
						path: ".dgk/enforce/enforce-evidence.json",
						content: JSON.stringify(
							{ verb: "governance-enforce", runtime: "tractor (Rust/wasmtime) — agent.wasm executed live", enforced, denied, baseline, deniedPluginsLoaded: result.deniedPluginsLoaded, baselinePluginsLoaded: result.baselinePluginsLoaded, boundary },
							null,
							2,
						),
					},
				];
				const stamped = stampEvidence(evidenceFiles);
				let evidence: string | undefined;
				if (apply && options.writeEvidence) {
					const w = await writeEvidenceFiles(evidenceFiles, stamped, options.writeEvidence);
					evidence = w.stampFile;
				}

				return buildJsonSuccessEnvelope({
					command: "governance-enforce",
					operation: "governance-enforce",
					nextCommand: "dgk governance-audit",
					nextCommands: ["dgk governance-audit"],
					extra: {
						enforced,
						// The A/B: same plugin, same scripted read, two grant postures.
						denied,
						baseline,
						boundary,
						// The execution stamp of the persisted evidence (present whether or not --apply wrote it).
						stampedAt: stamped.stampedAt,
						evidenceFiles: stamped.stamps,
						...(evidence ? { evidence } : {}),
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "governance-enforce",
					operation: "governance-enforce",
					error: "enforce_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the tractor binary + agent are built.",
				});
			}
		},
	};
}
