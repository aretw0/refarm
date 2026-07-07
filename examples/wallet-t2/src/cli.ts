#!/usr/bin/env node
import {
	createBaseStatusCapability,
	mountCapabilities,
	mountedCliCommands,
	serveCapabilities,
} from "@refarm.dev/capabilities-v1";
import { localRecordsStatePath } from "@refarm.dev/capabilities-v1/node";
import {
	buildBaseSurfaceModel,
	buildCapabilitySurfaceUnit,
	buildReviewQueueSurfaceUnit,
	type BaseSurfaceModel,
} from "@refarm.dev/operator-state";
import { Command } from "commander";

import {
	createWalletShowCapability,
	walletCapabilityDeps,
	walletRecordsDeps,
	type WalletStateOptions,
} from "./persona.js";

export const WALLET_T2_STATE_PATH_ENV = "WALLET_T2_STATE_PATH";

export function defaultWalletStatePath(cwd = process.cwd()): string {
	return process.env[WALLET_T2_STATE_PATH_ENV] || localRecordsStatePath({
		appId: "wallet-t2",
		cwd,
	});
}

/**
 * `wallet` — the T2 POC CLI (result mode). The sovereign citizen's digital wallet:
 * refarm's neutral blocks underneath, ONE persona verb (`wallet-show`) on top. The
 * citizen sees their held items, not the machine.
 */
export function buildRegistry(options: WalletStateOptions = {}) {
	const records = walletRecordsDeps(options);
	return mountCapabilities({
		deps: walletCapabilityDeps(records),
		verbs: [
			createWalletShowCapability(records),
			createBaseStatusCapability({
				summary: "Show wallet operator status",
				httpPath: "/wallet/status",
				model: () => buildWalletBaseModel(options),
			}),
		],
	});
}

export function buildWalletBaseModel(options: WalletStateOptions = {}): BaseSurfaceModel {
	const registry = buildRegistry(options);
	const manifest = walletRecordsDeps(options).loadManifest();
	const draftRecords = manifest.records.filter((record) => record.review?.state !== "verified");
	return buildBaseSurfaceModel(
		{
			units: [
				buildCapabilitySurfaceUnit(registry, {
					owner: "examples/wallet-t2",
					subject: "Wallet",
					action: {
						label: "wallet wallet-show --json",
						command: "wallet wallet-show --json",
						primary: true,
					},
				}),
				buildReviewQueueSurfaceUnit({
					id: "wallet",
					label: "Wallet",
					owner: "examples/wallet-t2",
					total: manifest.records.length,
					pending: draftRecords.length,
					totalLabel: "held items",
					pendingLabel: "needs review",
					pendingSummary: ({ total, pending }) =>
						`Wallet has ${total} held items; ${pending} item needs review.`,
					readySummary: ({ total }) => `Wallet has ${total} held items.`,
					pendingAction: {
						label: "Verify the draft credential",
						command: "wallet records correct record:cred-assinatura verified --apply",
						primary: true,
					},
					details: {
						recordIds: manifest.records.map((record) => record.id),
						draftRecordIds: draftRecords.map((record) => record.id),
					},
				}),
			],
		},
		{ command: "wallet", operation: "base" },
	);
}

export function buildProgram(options: WalletStateOptions = {}): Command {
	const cliOptions: WalletStateOptions = {
		...options,
		statePath: options.statePath ?? defaultWalletStatePath(),
	};
	const program = new Command()
		.name("wallet")
		.description("My digital wallet — sovereign, local-first")
		.version("0.0.0");
	for (const command of mountedCliCommands(buildRegistry(cliOptions))) {
		program.addCommand(command);
	}
	// `serve` — the citizen's wallet on a web surface, from the shared mount seam.
	program
		.command("serve")
		.description("Serve the wallet's verbs over HTTP (their transports.http routes)")
		.option("--port <port>", "TCP port (0 = pick free)", "4322")
		.action(async (opts: { port: string }) => {
			const { listening } = serveCapabilities(buildRegistry(cliOptions), {
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
