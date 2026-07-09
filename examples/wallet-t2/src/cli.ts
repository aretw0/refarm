#!/usr/bin/env node
import {
	defineCapabilityApp,
	defineCapabilityHost,
	type CapabilityHost,
} from "@refarm.dev/capability-host";
import { createLocalRecordsAppDefaults } from "@refarm.dev/capability-host/node";

import {
	createWalletCapability,
	walletCapabilityBundle,
	type WalletStateOptions,
} from "./persona.js";

export const DGK_WALLET_STATE_PATH_ENV = "DGK_WALLET_STATE_PATH";

const walletAppDefaults = createLocalRecordsAppDefaults({
	appId: "dgk",
	envKey: DGK_WALLET_STATE_PATH_ENV,
	fileName: "wallet.manifest.json",
});
export const defaultWalletStatePath = walletAppDefaults.statePath;

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
			const { deps, records } = walletCapabilityBundle(options);
			return {
				deps,
				extensions: [createWalletCapability(records)],
			};
		},
		operatorStatus: {
			summary: "Show wallet operator status",
			httpPath: "/wallet/status",
			primaryVerb: {
				name: "wallet",
				subject: "Wallet",
				actionId: "open-wallet",
				intent: "wallet:open",
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
					pendingCorrection: {
						actionId: "verify-draft-credential",
						label: "Verify the draft credential",
						intent: "wallet:verify",
						targetState: "verified",
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
	defaultOptions: walletAppDefaults.defaultOptions,
});

export const buildRegistry = walletApp.registry;
export const buildWalletBaseModel = walletApp.baseModel;
export const buildProgram = walletApp.program;

void walletApp.runCli(import.meta.url, {
	compiledFileName: "cli.js",
});
