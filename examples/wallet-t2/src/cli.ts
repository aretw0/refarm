#!/usr/bin/env node
import {
	defineCapabilityApp,
	defineCapabilityHost,
	type CapabilityHost,
} from "@refarm.dev/capability-host";
import { createLocalRecordsStatePathResolver } from "@refarm.dev/capability-host/node";

import {
	createWalletCapability,
	walletCapabilityDeps,
	walletRecordsDeps,
	type WalletStateOptions,
} from "./persona.js";

export const DGK_WALLET_STATE_PATH_ENV = "DGK_WALLET_STATE_PATH";

export const defaultWalletStatePath = createLocalRecordsStatePathResolver({
	appId: "dgk",
	envKey: DGK_WALLET_STATE_PATH_ENV,
	fileName: "wallet.manifest.json",
});

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
			capabilityUnit: ({ hostCommand }) => {
				const walletCommand = hostCommand(["wallet", "--json"]);
				return {
					subject: "Wallet",
					action: {
						id: "open-wallet",
						label: walletCommand,
						intent: "wallet:open",
						command: walletCommand,
						primary: true,
					},
				};
			},
			units: ({ recordReviewQueueUnit, hostCommand }) => [
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
						command: hostCommand([
							"records",
							"correct",
							"record:cred-assinatura",
							"verified",
							"--apply",
						]),
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

const walletApp = defineCapabilityApp<WalletStateOptions>({
	host: buildWalletHost,
	defaultOptions: () => ({ statePath: defaultWalletStatePath() }),
});

export const buildRegistry = walletApp.registry;
export const buildWalletBaseModel = walletApp.baseModel;
export const buildProgram = walletApp.program;

void walletApp.runCli(import.meta.url, {
	compiledFileName: "cli.js",
});
