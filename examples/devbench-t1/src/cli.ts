#!/usr/bin/env node
import {
	createPluginDescriptorDeps,
	defineCapabilityApp,
	defineCapabilityHost,
	type CapabilityHost,
	type SubmitEffort,
} from "@refarm.dev/capability-host";
import { createSidecarSubmitEffort } from "@refarm.dev/capability-host/node";

import {
	CODING_AGENT_MANIFEST,
	createExtensionCapability,
	devCapabilityDeps,
} from "./persona.js";

export const DGK_DEVBENCH_SIDECAR_URL_ENV = "DGK_DEVBENCH_SIDECAR_URL";
export const DGK_DEVBENCH_DEFAULT_SIDECAR_URL = "http://127.0.0.1:42123";

export interface DevbenchHostOptions {
	submitEffort?: SubmitEffort;
}

/**
 * `dgk` - the T1 POC CLI (PROCESS mode). The developer's bench: neutral
 * blocks underneath, plus a coding-agent EXTENSION that surfaces its verbs via the
 * bridge (declare once → multi-surface), plus an inspector that makes the mechanism
 * visible. This shows the MACHINE being extended — the technical/general angle.
 */
export function buildDevbenchHost(options: DevbenchHostOptions = {}): CapabilityHost {
	const pluginDeps = createPluginDescriptorDeps({
		submitEffort: options.submitEffort ?? createSidecarSubmitEffort({
			baseUrl: DGK_DEVBENCH_DEFAULT_SIDECAR_URL,
			envKey: DGK_DEVBENCH_SIDECAR_URL_ENV,
		}),
	});
	return defineCapabilityHost({
		id: "examples/devbench-t1",
		command: "dgk",
		description: "Digital Gardening Kit - extension bench",
		version: "0.0.0",
		capabilities: {
			deps: devCapabilityDeps(),
			// The extension path: the coding-agent manifest's verbs (agent:code,
			// agent:review) surface themselves via the bridge.
			manifests: [CODING_AGENT_MANIFEST],
			pluginDeps,
			extensions: [createExtensionCapability(pluginDeps)],
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
			primaryVerbs: [
				{
					name: "agent-code",
					subject: "Coding agent",
					actionId: "run-agent-code",
					intent: "agent:code",
				},
				{
					name: "agent-review",
					subject: "Coding agent",
					actionId: "run-agent-review",
					intent: "agent:review",
				},
			],
		},
		serve: {
			defaultPort: 4323,
			description: "Serve dgk extension verbs over HTTP (their transports.http routes)",
			openApiPath: "/docs/openapi.json",
			openApiTitle: "DGK Extension Bench API",
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
