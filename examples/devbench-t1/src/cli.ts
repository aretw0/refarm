#!/usr/bin/env node
import {
	buildManifestPrimaryVerbs,
	createHostCommandResolver,
	createPluginDescriptorDeps,
	defineCapabilityApp,
	defineCapabilityHost,
	HostCommandOptions,
	type CapabilityHost,
	type SubmitEffort,
	type SurfaceableManifest,
} from "@refarm.dev/capability-host";
import { createSidecarSubmitEffort } from "@refarm.dev/capability-host/node";

import {
	createExtensionCapability,
	DEVBENCH_DEFAULT_MANIFESTS,
	DEVBENCH_LIVE_MANIFESTS,
	DEVBENCH_LIVE_PLUGIN_IDS,
	devCapabilityDeps,
} from "./persona.js";
import { createAgentRunCapability } from "./live-recursion.js";
import { createDelegateRunCapability } from "./live-delegation.js";
import { createCodeOpsCapability } from "./live-code-ops.js";
import { createExtensionGraphCapability } from "./extension-graph.js";
import { createGovernanceAuditCapability } from "./live-audit.js";
import { createGovernanceEnforceCapability } from "./live-enforce.js";
import { createPluginReloadCapability } from "./live-reload.js";
import { createAgentTelemetryCapability } from "./live-telemetry.js";
import { createPluginResilienceCapability } from "./live-resilience.js";
import { createPluginCatalogCapability } from "./live-catalog.js";
import { createPluginResolveCapability } from "./live-resolver.js";
import { createPluginOpsCapability } from "./plugin-ops.js";
import { createReportCapability } from "./report.js";
import { createExtensionQualityCapability } from "./extension-quality.js";
import { createExtensionLifecycleCapability } from "./extension-lifecycle.js";
import { createGovernancePocCapability } from "./governance-verb.js";
import { createExtensionDevelopCapability } from "./maturity-verb.js";
import { createExtensionVerifyCapability } from "./integrity-verb.js";
import { createXyzzyCapability } from "./easter-egg.js";
import { createIdeCapability } from "./ide-verb.js";
import { createVscodeManifestCapability } from "./vscode-verb.js";
import { DEVBENCH_THEMES, resolveDevbenchTheme } from "./theme.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DGK_DEVBENCH_SIDECAR_URL_ENV = "DGK_DEVBENCH_SIDECAR_URL";
export const DGK_DEVBENCH_DEFAULT_SIDECAR_URL = "http://127.0.0.1:42123";
export const DGK_COMMAND = "dgk";

export interface DevbenchHostOptions extends HostCommandOptions {
	submitEffort?: SubmitEffort;
	manifests?: readonly SurfaceableManifest[];
}

const resolveCommand = createHostCommandResolver({ defaultCommand: DGK_COMMAND });

/**
 * `dgk` - the T1 POC CLI (PROCESS mode). The developer's bench: neutral
 * blocks underneath, plus a coding-agent EXTENSION that surfaces its verbs via the
 * bridge (declare once → multi-surface), plus an inspector that makes the mechanism
 * visible. This shows the MACHINE being extended — the technical/general angle.
 */
export function buildDevbenchHost(options: DevbenchHostOptions = {}): CapabilityHost {
	const command = resolveCommand(options);
	const pluginDeps = createPluginDescriptorDeps({
		submitEffort:
			options.submitEffort ??
			createSidecarSubmitEffort({
				baseUrl: DGK_DEVBENCH_DEFAULT_SIDECAR_URL,
				envKey: DGK_DEVBENCH_SIDECAR_URL_ENV,
			}),
	});
	const manifests = [...(options.manifests ?? DEVBENCH_DEFAULT_MANIFESTS)] as SurfaceableManifest[];
	const extensionManifest = manifests[0] ?? DEVBENCH_DEFAULT_MANIFESTS[0]!;
	const peerManifests = manifests.slice(1);
	// An OPTIONAL brand/context skin (DGK_THEME) — the substrate stays neutral; the app themes.
	const theme = resolveDevbenchTheme();
	// The description carries a discovery hint of the available themes so `dgk --help` shows them.
	const description = `${theme.description} (DGK_THEME: ${DEVBENCH_THEMES.join(" | ")})`;
	// A holder so the `ide` verb can resolve the host's OWN registry lazily (at run time) — the
	// ide verb is itself in that registry, so it can't reference the host until it's built.
	let host: CapabilityHost;
	host = defineCapabilityHost({
		id: "examples/devbench-t1",
		command,
		description,
		version: "0.0.0",
		capabilities: () => ({
			deps: devCapabilityDeps(),
			// The extension path: the active manifest's verbs surface themselves
			// via the bridge (e.g. agent:code/agent:review by default).
			manifests,
			pluginDeps,
			// Peers are passed so the inspector resolves the coding-agent's requiresApi
			// against the notes-indexer's providesApi — the recursion, made visible.
			extensions: [
				createExtensionCapability(extensionManifest, pluginDeps, peerManifests),
				// DRAW the recursion: the plugin dependency graph the writeup describes in prose.
				// Includes the REAL, executed SPI edge (delegate → agent via AgentRespond, proven
				// live by delegate-run --chain), marked `executed`, alongside the illustrative
				// coding-agent → notes-indexer edge; Surveyor renders it to an SVG.
				createExtensionGraphCapability([...manifests, ...DEVBENCH_LIVE_MANIFESTS], {
					livePluginIds: DEVBENCH_LIVE_PLUGIN_IDS,
				}),
				// UNIFY the daemon-free plugin blocks into one dashboard: provenance (content-address
				// + tamper rejection) → inventory (verified catalog) → lifecycle (integrity→maturity→
				// install) → recursion (SPI edges). One narrative panel the web content seam mounts.
				createPluginOpsCapability([...manifests, ...DEVBENCH_LIVE_MANIFESTS], {
					livePluginIds: DEVBENCH_LIVE_PLUGIN_IDS,
				}),
				// RECORD MATERIAL: materialize the writeup's evidence to disk — the SPI graph as a
				// standalone .svg figure + a report.md narrating what the example proves with the
				// real numbers (governance scorecard, executed edges). `--apply` writes it.
				createReportCapability(
					[...manifests, ...DEVBENCH_LIVE_MANIFESTS],
					{ livePluginIds: DEVBENCH_LIVE_PLUGIN_IDS },
					{
						writeReport: (rel, content) => {
							const file = path.join(process.cwd(), rel);
							mkdirSync(path.dirname(file), { recursive: true });
							writeFileSync(file, content, "utf8");
						},
					},
				),
				// The HEADLINE, live: boot the real agent.wasm + a provider plugin and have the agent
				// respond while calling the provider's verb as a tool (recursion, host-mediated). Not
				// a fixture — the WASM runtime. `--mock` scripts a deterministic model for an offline demo.
				createAgentRunCapability(),
				// One turn DEEPER: a plugin orchestrating the agent. The `delegate` plugin (real,
				// sandboxed WASM) runs a task through the agent under a PERSONA via host-mediated
				// call_plugin — plugin → plugin, neither privileged. The framework ships delegate;
				// the bench simulates using it. `--mock` for an offline demo.
				createDelegateRunCapability(),
				// The EDITOR plugin, live: rename / find-references arrive as a loaded, sandboxed
				// WASM extension (lsp-code-ops), not built into the host. This is what the IDE
				// surface contributes — proven end to end against a self-contained fake LSP.
				createCodeOpsCapability(),
				// The GOVERNANCE PoC: extensibility as a risk decision — 2 policy modes × 3 extensions
				// → policy decisions, sandbox reports, runtime evidence, metrics, and a scorecard. The
				// forcing function that produces the verifiable artifacts the writeup cites.
				createGovernancePocCapability({
					writeArtifact: (rel, json) => {
						const file = path.join(process.cwd(), rel);
						mkdirSync(path.dirname(file), { recursive: true });
						writeFileSync(file, json, "utf8");
					},
				}),
				// GOVERNANCE, EXECUTED: the governance-poc's runtime evidence is synthetic; this boots
				// the agent LIVE, drives a real fs effect, and reports the tamper-evidence audit log
				// the HOST wrote (scarecrow-audit.ndjson) — evidence from the runtime, not a TS literal.
				createGovernanceAuditCapability(),
				// GOVERNANCE, ENFORCED: the third face of the quartet. governance-poc decides,
				// governance-audit records; this boots the agent under STRICT mode without fs:read
				// and shows the host REFUSING the effect at the sandbox boundary (no fs:read line in
				// the audit trail), contrasted with a granted baseline that does produce one.
				createGovernanceEnforceCapability({
					writeEvidence: (rel, content) => {
						const file = path.join(process.cwd(), rel);
						mkdirSync(path.dirname(file), { recursive: true });
						writeFileSync(file, content, "utf8");
					},
				}),
				// RUNTIME TINKERING: hot-reload a loaded plugin without restarting the host
				// (POST /plugins/reload → real code swap), then prove it still dispatches — the
				// developer editing an extension live, the machine never coming down.
				createPluginReloadCapability(),
				// OBSERVABILITY: run the agent live and project its execution TIMELINE from the
				// runtime's own agent:* events — the model route (and why), each iteration, each
				// tool call, the final tokens. The machine shows what it does, turn by turn.
				createAgentTelemetryCapability(),
				// RESILIENCE: a runaway plugin (on_event spins forever) is trapped under the epoch
				// budget + respawned; the host keeps serving (the agent responds after). A bad
				// extension does not bring the sovereign machine down.
				createPluginResilienceCapability(),
				// CATALOG: install the built plugins through the Barn and list the sovereign inventory
				// (id, integrity, wasmHash, cacheStatus) — integrity-verify on install + cache dedup.
				createPluginCatalogCapability(),
				// CONTENT-ADDRESSED PROVENANCE: a plugin is its SHA-256, not its path. Store it by
				// hash, resolve it back verified, and prove a TAMPERED copy is rejected — adulterated
				// bytes never reach the runtime.
				createPluginResolveCapability(),
				// SIMULATE developing an extension through the governed maturity trail (experiment →
				// productive → sensitive → catalog) — the platform's maturity vocabulary consumed to
				// show the lifecycle the writeup's Figura 3 describes, with objective promotion gates.
				createExtensionDevelopCapability(),
				// SIMULATE the integrity gate: an intact artifact promotes, a tampered one is REJECTED
				// (the platform's verifyBufferIntegrity, sha256) — "integridade reduz risco de artefatos
				// adulterados". Completes the manifest → integrity → maturity governance triad.
				createExtensionVerifyCapability(),
				// The QUALITY gate: run the sovereign quality:v1 WASM checker over the extension
				// manifests with a hygiene profile — the fourth governance axis (integrity + maturity
				// + policy + quality), a real sandboxed analysis of how the extension is declared.
				createExtensionQualityCapability(manifests),
				// The full plugin LIFECYCLE as one flow (author → integrity → maturity → Barn install)
				// over a real built plugin — the 'scenario to record' the README asks for, unifying the
				// scattered integrity/maturity/load verbs through the real lifecycle manager.
				createExtensionLifecycleCapability(),
				// The easter egg: `xyzzy` (a playful capability like any other) reveals the hidden
				// T1→T3 continuity — a wink that even a whimsical extension goes through the governed surface.
				createXyzzyCapability(),
				// The IDE surface: project the bench as an editor command set + tree (the same registry
				// the CLI/TUI/web derive from). A VS Code extension consumes this. CLI + TUI + IDE.
				createIdeCapability(() => host.registry(), command),
				// Generate the VS Code extension's package.json from the bench — "develop the editor
				// extension" without hand-writing its manifest (declare once → the editor contributes).
				createVscodeManifestCapability(() => host.registry(), command, {
					writeManifest: (json) => {
						const pkgPath = path.join(process.cwd(), "vscode", "package.json");
						mkdirSync(path.dirname(pkgPath), { recursive: true });
						writeFileSync(pkgPath, json, "utf8");
					},
				}),
			],
		}),
		operatorStatus: {
			summary: "Show extension bench operator status",
			httpPath: "/extension/status",
			primaryVerb: {
				name: "extension",
				subject: "Extension bench",
				actionId: "inspect-extension",
				intent: "extension:inspect",
			},
			primaryVerbs: [...buildManifestPrimaryVerbs({ manifests })],
		},
		serve: {
			defaultPort: 4323,
			description: `Serve ${command} extension verbs over HTTP (their transports.http routes)`,
			openApiPath: "/docs/openapi.json",
			openApiTitle: `${command} Extension Bench API`,
		},
	});
	return host;
}

export const devbenchApp = defineCapabilityApp({
	host: buildDevbenchHost,
});

export const buildRegistry = devbenchApp.registry;
export const buildProgram = devbenchApp.program;

void devbenchApp.runCli(import.meta.url, {
	compiledFileName: "cli.js",
});
