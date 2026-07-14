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
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultArtifacts, missingArtifacts, type LiveRecursionArtifacts } from "./live-recursion.js";
import { readAuditTrail } from "./live-audit.js";

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
		// Let the effect (or its denial) + the audit append flush.
		await new Promise((r) => setTimeout(r, 500));
		const producedFsRead = readAuditTrail(refarmDir).some((l) => l.event === "host-effect:fs:read");
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

/**
 * `governance-enforce` — prove the host REFUSES an undeclared effect at the sandbox boundary.
 * Boots the agent under strict mode without `fs:read`, scripts a read, and shows no fs:read
 * effect reached the audit trail — contrasted with a granted baseline that does. The missing
 * third face of the quartet: decide (governance-poc) → record (governance-audit) → ENFORCE.
 */
export function createGovernanceEnforceCapability(): CapabilityDescriptor {
	return {
		name: "governance-enforce",
		summary: "Prove the host REFUSES an undeclared effect at the sandbox boundary (strict mode)",
		transports: { http: { path: "/governance/enforce" } },
		renderers: { tui: { section: "governance" }, web: { route: "/governance-enforce", icon: "shield-x" }, ide: { command: "dgk.governance-enforce" } },
		async run(_input: CapabilityInput): Promise<CapabilityEnvelope> {
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
				return buildJsonSuccessEnvelope({
					command: "governance-enforce",
					operation: "governance-enforce",
					nextCommand: "dgk governance-audit",
					nextCommands: ["dgk governance-audit"],
					extra: {
						enforced,
						// The A/B: same plugin, same scripted read, two grant postures.
						denied: {
							securityMode: "strict",
							grantedFsRead: false,
							producedFsReadEffect: result.deniedProducedEffect, // expected: false (host refused)
						},
						baseline: {
							securityMode: "strict",
							grantedFsRead: true,
							producedFsReadEffect: result.baselineProducedEffect, // expected: true (effect ran)
						},
						boundary: "enforce_permission denies an undeclared capability BEFORE the effect runs (host owns the gate)",
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
