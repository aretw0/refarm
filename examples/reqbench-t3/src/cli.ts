#!/usr/bin/env node
import {
	mountCapabilities,
	mountedCliCommands,
	serveCapabilities,
} from "@refarm.dev/capabilities-v1";
import { Command } from "commander";

import { createRequirementsMocCapability, reqCapabilityDeps, reqRecordsDeps } from "./persona.js";

/**
 * `reqbench` — the T3 POC CLI (result mode). refarm's neutral blocks
 * (discover/pull/enrich/correct/analyze/vault) underneath; ONE persona verb
 * (`requirements-moc`) on top. Mounting is a single call — the boilerplate lives in
 * `mountCapabilities`, so this example is just its persona.
 */
export function buildRegistry() {
	const records = reqRecordsDeps();
	return mountCapabilities({
		deps: reqCapabilityDeps(undefined, records),
		verbs: [createRequirementsMocCapability(records)],
	});
}

export function buildProgram(): Command {
	const program = new Command()
		.name("reqbench")
		.description("Requirements bench — discover, pull, correct, and read a requirements MOC")
		.version("0.0.0");
	for (const command of mountedCliCommands(buildRegistry())) {
		program.addCommand(command);
	}
	// `serve` — the SAME verbs on a web surface, from the shared mount seam (one line).
	program
		.command("serve")
		.description("Serve reqbench's verbs over HTTP (their transports.http routes)")
		.option("--port <port>", "TCP port (0 = pick free)", "4321")
		.action(async (opts: { port: string }) => {
			const { listening } = serveCapabilities(buildRegistry(), {
				port: Number(opts.port),
			});
			const { port } = await listening;
			console.log(JSON.stringify({ ok: true, url: `http://127.0.0.1:${port}` }));
		});
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
