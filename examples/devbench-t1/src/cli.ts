#!/usr/bin/env node
import {
	mountCapabilities,
	mountedCliCommands,
} from "@refarm.dev/capabilities-v1";
import { Command } from "commander";

import {
	CODING_AGENT_MANIFEST,
	createCapturingSubmit,
	createExtInspectCapability,
	devCapabilityDeps,
} from "./persona.js";

/**
 * `devbench` — the T1 POC CLI (PROCESS mode). The developer's bench: refarm's neutral
 * blocks underneath, plus a coding-agent EXTENSION that surfaces its verbs via the
 * bridge (declare once → multi-surface), plus an inspector that makes the mechanism
 * visible. This shows the MACHINE being extended — the technical/general angle.
 */
export function buildRegistry() {
	const pluginDeps = {
		submitEffort: createCapturingSubmit(),
		newId: () => globalThis.crypto.randomUUID(),
		nowIso: () => new Date().toISOString(),
	};
	return mountCapabilities({
		deps: devCapabilityDeps(),
		// The extension path: the coding-agent manifest's verbs (agent:code, agent:review)
		// surface themselves via the bridge — the developer writes no run() for them.
		manifests: [CODING_AGENT_MANIFEST],
		pluginDeps,
		// The inspector verb makes the "declare once → multi-surface" mechanism visible.
		verbs: [createExtInspectCapability(pluginDeps)],
	});
}

export function buildProgram(): Command {
	const program = new Command()
		.name("devbench")
		.description("Developer bench — declare an extension and watch it multi-surface")
		.version("0.0.0");
	for (const command of mountedCliCommands(buildRegistry())) {
		program.addCommand(command);
	}
	return program;
}

const isMain =
	process.argv[1] !== undefined &&
	(import.meta.url === `file://${process.argv[1]}` ||
		import.meta.url.endsWith("/cli.js"));

if (isMain) {
	buildProgram()
		.parseAsync(process.argv)
		.catch((error: unknown) => {
			console.error(error);
			process.exitCode = 1;
		});
}
