#!/usr/bin/env node
import {
	defineCapabilityHost,
	runCapabilityHostCli,
	type CapabilityHost,
} from "@refarm.dev/capability-host";

import {
	CODING_AGENT_MANIFEST,
	createCapturingSubmit,
	createExtensionCapability,
	devCapabilityDeps,
} from "./persona.js";

/**
 * `dgk` - the T1 POC CLI (PROCESS mode). The developer's bench: refarm's neutral
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
			capabilityUnit: {
				subject: "Extension bench",
				action: {
					id: "inspect-extension",
					label: "dgk extension --json",
					intent: "extension:inspect",
					command: "dgk extension --json",
					primary: true,
				},
			},
		},
		serve: {
			defaultPort: 4323,
			description: "Serve dgk extension verbs over HTTP (their transports.http routes)",
		},
	});
}

export function buildRegistry() {
	return buildDevbenchHost().registry();
}

export function buildProgram(): ReturnType<CapabilityHost["program"]> {
	return buildDevbenchHost().program();
}

void runCapabilityHostCli(import.meta.url, () => buildProgram(), {
	compiledFileName: "cli.js",
});
