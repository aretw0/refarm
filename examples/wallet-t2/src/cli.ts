#!/usr/bin/env node
import {
	mountCapabilities,
	mountedCliCommands,
	serveCapabilities,
} from "@refarm.dev/capabilities-v1";
import { Command } from "commander";

import { createWalletShowCapability, walletCapabilityDeps, walletRecordsDeps } from "./persona.js";

/**
 * `wallet` — the T2 POC CLI (result mode). The sovereign citizen's digital wallet:
 * refarm's neutral blocks underneath, ONE persona verb (`wallet-show`) on top. The
 * citizen sees their held items, not the machine.
 */
export function buildRegistry() {
	const records = walletRecordsDeps();
	return mountCapabilities({
		deps: walletCapabilityDeps(records),
		verbs: [createWalletShowCapability(records)],
	});
}

export function buildProgram(): Command {
	const program = new Command()
		.name("wallet")
		.description("My digital wallet — sovereign, local-first")
		.version("0.0.0");
	for (const command of mountedCliCommands(buildRegistry())) {
		program.addCommand(command);
	}
	// `serve` — the citizen's wallet on a web surface, from the shared mount seam.
	program
		.command("serve")
		.description("Serve the wallet's verbs over HTTP (their transports.http routes)")
		.option("--port <port>", "TCP port (0 = pick free)", "4322")
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
