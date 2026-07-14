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
	devCapabilityDeps,
} from "./persona.js";
import { createAgentRunCapability } from "./live-recursion.js";
import { createGovernancePocCapability } from "./governance-verb.js";
import { createExtensionDevelopCapability } from "./maturity-verb.js";
import { createExtensionVerifyCapability } from "./integrity-verb.js";
import { createXyzzyCapability } from "./easter-egg.js";
import { createIdeCapability } from "./ide-verb.js";
import { createVscodeManifestCapability } from "./vscode-verb.js";
import { resolveDevbenchTheme } from "./theme.js";
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
	// A holder so the `ide` verb can resolve the host's OWN registry lazily (at run time) — the
	// ide verb is itself in that registry, so it can't reference the host until it's built.
	let host: CapabilityHost;
	host = defineCapabilityHost({
		id: "examples/devbench-t1",
		command,
		description: theme.description,
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
				// The HEADLINE, live: boot the real agent.wasm + a provider plugin and have the agent
				// respond while calling the provider's verb as a tool (recursion, host-mediated). Not
				// a fixture — the WASM runtime. `--mock` scripts a deterministic model for an offline demo.
				createAgentRunCapability(),
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
				// SIMULATE developing an extension through the governed maturity trail (experiment →
				// productive → sensitive → catalog) — the platform's maturity vocabulary consumed to
				// show the lifecycle the writeup's Figura 3 describes, with objective promotion gates.
				createExtensionDevelopCapability(),
				// SIMULATE the integrity gate: an intact artifact promotes, a tampered one is REJECTED
				// (the platform's verifyBufferIntegrity, sha256) — "integridade reduz risco de artefatos
				// adulterados". Completes the manifest → integrity → maturity governance triad.
				createExtensionVerifyCapability(),
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
