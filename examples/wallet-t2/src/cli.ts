#!/usr/bin/env node
import {
	defineCapabilityHost,
	type CapabilityHost,
} from "@refarm.dev/capabilities-v1";
import { resolveLocalRecordsStatePath } from "@refarm.dev/capabilities-v1/node";

import {
	createWalletCapability,
	walletCapabilityDeps,
	walletRecordsDeps,
	type WalletStateOptions,
} from "./persona.js";

export const DGK_WALLET_STATE_PATH_ENV = "DGK_WALLET_STATE_PATH";

export function defaultWalletStatePath(cwd = process.cwd()): string {
	return resolveLocalRecordsStatePath({
		appId: "dgk",
		cwd,
		envKey: DGK_WALLET_STATE_PATH_ENV,
		fileName: "wallet.manifest.json",
	});
}

/**
 * `dgk` - the T2 POC CLI (result mode). The sovereign citizen's digital wallet:
 * neutral blocks underneath, one persona verb (`wallet`) on top. The
 * citizen sees their held items, not the machine.
 */
export function buildWalletHost(options: WalletStateOptions = {}): CapabilityHost {
	return defineCapabilityHost({
		id: "examples/wallet-t2",
		command: "dgk",
		description: "Digital Gardening Kit - sovereign wallet",
		version: "0.0.0",
		capabilities: () => {
			const records = walletRecordsDeps(options);
			return {
				deps: walletCapabilityDeps(records),
				extensions: [createWalletCapability(records)],
			};
		},
		operatorStatus: {
			summary: "Show wallet operator status",
			httpPath: "/wallet/status",
			capabilityUnit: {
				subject: "Wallet",
				action: {
					id: "open-wallet",
					label: "dgk wallet --json",
					intent: "wallet:open",
					command: "dgk wallet --json",
					primary: true,
				},
			},
			units: ({ recordReviewQueueUnit }) => [
				recordReviewQueueUnit({
					id: "wallet",
					label: "Wallet",
					reviewedState: "verified",
					totalLabel: "held items",
					pendingLabel: "needs review",
					pendingSummary: ({ total, pending }) =>
						`Wallet has ${total} held items; ${pending} item needs review.`,
					readySummary: ({ total }) => `Wallet has ${total} held items.`,
					pendingAction: {
						id: "verify-draft-credential",
						label: "Verify the draft credential",
						intent: "wallet:verify",
						command: "dgk records correct record:cred-assinatura verified --apply",
						primary: true,
					},
				}),
			],
		},
		serve: {
			defaultPort: 4322,
			description: "Serve the wallet's verbs over HTTP (their transports.http routes)",
		},
	});
}

export function buildRegistry(options: WalletStateOptions = {}) {
	return buildWalletHost(options).registry();
}

export function buildWalletBaseModel(options: WalletStateOptions = {}) {
	return buildWalletHost(options).baseModel();
}

export function buildProgram(
	options: WalletStateOptions = {},
): ReturnType<CapabilityHost["program"]> {
	const cliOptions: WalletStateOptions = {
		...options,
		statePath: options.statePath ?? defaultWalletStatePath(),
	};
	return buildWalletHost(cliOptions).program();
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
