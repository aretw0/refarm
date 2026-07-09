#!/usr/bin/env node
import {
	defineCapabilityApp,
	defineCapabilityHost,
	type CapabilityHost,
} from "@refarm.dev/capability-host";

import {
	CODING_AGENT_MANIFEST,
	createCapturingSubmit,
	createExtensionCapability,
	devCapabilityDeps,
} from "./persona.js";

/**
 * `dgk` - the T1 POC CLI (PROCESS mode). The developer's bench: neutral
 * blocks underneath, plus a coding-agent EXTENSION that surfaces its verbs via the
 * bridge (declare once → multi-surface), plus an inspector that makes the mechanism
 * visible. This shows the MACHINE being extended — the technical/general angle.
 */
export function buildDevbenchHost(): CapabilityHost {
	const pluginDeps = {
		submitEffort: createCapturingSubmit(),
		newId: () => globalThis.crypto.randomUUID(),
		nowIso: () => new Date().toISOString(),
	};
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
			capabilityUnit: ({ hostCommand }) => {
				const extensionCommand = hostCommand(["extension", "--json"]);
				return {
					subject: "Extension bench",
					action: {
						id: "inspect-extension",
						label: extensionCommand,
						intent: "extension:inspect",
						command: extensionCommand,
						primary: true,
					},
				};
			},
		},
		serve: {
			defaultPort: 4323,
			description: "Serve dgk extension verbs over HTTP (their transports.http routes)",
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
