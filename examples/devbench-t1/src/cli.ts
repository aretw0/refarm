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
	return defineCapabilityHost({
		id: "examples/devbench-t1",
		command,
		description: "Digital Gardening Kit - extension bench",
		version: "0.0.0",
		capabilities: {
			deps: devCapabilityDeps(),
			// The extension path: the active manifest's verbs surface themselves
			// via the bridge (e.g. agent:code/agent:review by default).
			manifests,
			pluginDeps,
			// Peers are passed so the inspector resolves the coding-agent's requiresApi
			// against the notes-indexer's providesApi — the recursion, made visible.
			extensions: [createExtensionCapability(extensionManifest, pluginDeps, peerManifests)],
		},
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
}

const devbenchApp = defineCapabilityApp({
	host: buildDevbenchHost,
});

export const buildRegistry = devbenchApp.registry;
export const buildProgram = devbenchApp.program;

void devbenchApp.runCli(import.meta.url, {
	compiledFileName: "cli.js",
});
