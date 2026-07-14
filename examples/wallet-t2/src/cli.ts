#!/usr/bin/env node
import {
	createHostCommandResolver,
	defineCapabilityApp,
	defineCapabilityHost,
	HostCommandOptions,
	type CapabilityHost,
} from "@refarm.dev/capability-host";
import { createLocalRecordsAppDefaults } from "@refarm.dev/capability-host/node";

import {
	createWalletCapabilities,
	walletCapabilityBundle,
	type WalletBundleOptions,
	type WalletStateOptions,
} from "./persona.js";
import { createSovereignWalletBundle } from "./sovereign.js";

export const DGK_WALLET_STATE_PATH_ENV = "DGK_WALLET_STATE_PATH";
/** Opt-in: back the wallet with the sovereign WASM signer (the citizen's Ed25519 key
 * lives inside the sandbox, never in JS). Off by default so the in-memory fixture
 * keeps the wallet offline + deterministic for tests. */
export const DGK_SOVEREIGN_ENV = "DGK_SOVEREIGN";
export const DGK_COMMAND = "dgk";

const walletAppDefaults = createLocalRecordsAppDefaults({
	appId: DGK_COMMAND,
	envKey: DGK_WALLET_STATE_PATH_ENV,
	fileName: "wallet.manifest.json",
});
export const defaultWalletStatePath = walletAppDefaults.statePath;
export interface WalletHostOptions
	extends WalletStateOptions,
		HostCommandOptions,
		Pick<WalletBundleOptions, "credentialsProvider" | "identity"> {}

const resolveCommand = createHostCommandResolver({ defaultCommand: DGK_COMMAND });

/**
 * `dgk` - the T2 POC CLI (result mode). The sovereign citizen's digital wallet:
 * neutral blocks underneath, one persona verb (`wallet`) on top. The
 * citizen sees their held items, not the machine.
 */
export function buildWalletHost(options: WalletHostOptions = {}): CapabilityHost {
	const command = resolveCommand(options);
	return defineCapabilityHost({
		id: "examples/wallet-t2",
		command,
		description: "Digital Gardening Kit - sovereign wallet",
		version: "0.0.0",
		capabilities: () => {
			const { deps, records, credentialsProvider, identity, authorizationProvider } =
				walletCapabilityBundle(options);
			return {
				deps,
				extensions: createWalletCapabilities(records, {
					credentialsProvider,
					identity,
					authorizationProvider,
				}),
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
			description: `Serve ${command} wallet verbs over HTTP (their transports.http routes)`,
			openApiPath: "/docs/openapi.json",
			openApiTitle: `${command} Wallet API`,
		},
	});
}

export const walletApp = defineCapabilityApp<WalletHostOptions>({
	host: buildWalletHost,
	defaultOptions: walletAppDefaults.defaultOptions,
});

export const buildRegistry = walletApp.registry;
export const buildWalletBaseModel = walletApp.baseModel;
export const buildProgram = walletApp.program;

/**
 * Resolve the wallet's default options, activating the SOVEREIGN backing when
 * `DGK_SOVEREIGN=1`: the citizen's identity becomes the sandboxed WASM signer
 * (@refarm.dev/identity-provider-ref) and the credentials provider signs through it,
 * so every `share`/`present` is signed inside the sandbox — the wallet process holds
 * no private key. Off by default: the in-memory fixture keeps the wallet offline and
 * deterministic for tests. Async because instantiating the component is async.
 */
async function resolveWalletDefaultOptions(): Promise<WalletHostOptions> {
	const base = walletAppDefaults.defaultOptions as WalletHostOptions;
	if (process.env[DGK_SOVEREIGN_ENV] !== "1") return base;
	const { credentialsProvider, identity } = await createSovereignWalletBundle();
	return { ...base, credentialsProvider, identity };
}

void resolveWalletDefaultOptions().then((defaultOptions) =>
	defineCapabilityApp<WalletHostOptions>({
		host: buildWalletHost,
		defaultOptions,
	}).runCli(import.meta.url, { compiledFileName: "cli.js" }),
);
