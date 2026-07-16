#!/usr/bin/env node
import {
	createHostCommandResolver,
	defineCapabilityApp,
	defineCapabilityHost,
	HostCommandOptions,
	type CapabilityHost,
} from "@refarm.dev/capability-host";
import { createLocalRecordsAppDefaults } from "@refarm.dev/capability-host/node";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	createWalletCapabilities,
	createSovereignWalletBundle,
	walletCapabilityBundle,
	type WalletBundleOptions,
	type WalletStateOptions,
} from "@refarm.dev/wallet";
import { createWalletReportCapability } from "./report.js";

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
		Pick<WalletBundleOptions, "credentialsProvider" | "identity" | "verifyPolicy" | "authorizationProvider"> {}

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
			const { deps, records, credentialsProvider, identity, authorizationProvider, verifyPolicy } =
				walletCapabilityBundle(options);
			return {
				deps,
				extensions: [
					...createWalletCapabilities(records, {
						credentialsProvider,
						identity,
						authorizationProvider,
						// The trust registry, threaded end to end: verify --strict now rejects an
						// untrusted issuer in the shipped CLI (DGK_TRUSTED_ISSUERS), not only in tests.
						...(verifyPolicy ? { verifyPolicy } : {}),
					}),
					// RECORD MATERIAL: the disclosure graph SVG + a report.md of the sovereign posture
					// with the real numbers, for the writeup. `--apply` writes to .dgk/report/.
					createWalletReportCapability(records, {
						writeReport: (rel, content) => {
							const file = path.join(process.cwd(), rel);
							mkdirSync(path.dirname(file), { recursive: true });
							writeFileSync(file, content, "utf8");
						},
					}),
				],
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
 * Compose the wallet's default options as a *resolver thunk*. `walletAppDefaults.defaultOptions`
 * is itself a resolver (it reads the state-path env at call time), so it must be COMPOSED, never
 * spread: `{ ...fn }` yields no own keys and silently drops `statePath`, leaving the wallet with
 * nowhere to persist. Both the plain and sovereign paths funnel through here so the bug can't
 * come back on only one branch.
 */
export function composeWalletDefaultOptions(
	base: () => WalletStateOptions,
	sovereign?: Pick<WalletHostOptions, "credentialsProvider" | "identity" | "authorizationProvider">,
): () => WalletHostOptions {
	return () => ({ ...base(), ...(sovereign ?? {}) });
}

/**
 * Resolve the wallet's default options, activating the SOVEREIGN backing when
 * `DGK_SOVEREIGN=1`: the citizen's identity becomes the sandboxed WASM signer
 * (@refarm.dev/identity-provider-ref) and the credentials provider signs through it,
 * so every `share`/`present` is signed inside the sandbox — the wallet process holds
 * no private key. Off by default: the in-memory fixture keeps the wallet offline and
 * deterministic for tests. Async because instantiating the component is async.
 */
async function resolveWalletDefaultOptions(): Promise<() => WalletHostOptions> {
	const base = () => walletAppDefaults.defaultOptions();
	if (process.env[DGK_SOVEREIGN_ENV] !== "1") return composeWalletDefaultOptions(base);
	const { credentialsProvider, identity, authorizationProvider } = await createSovereignWalletBundle();
	return composeWalletDefaultOptions(base, { credentialsProvider, identity, authorizationProvider });
}

void resolveWalletDefaultOptions().then((defaultOptions) =>
	defineCapabilityApp<WalletHostOptions>({
		host: buildWalletHost,
		defaultOptions,
	}).runCli(import.meta.url, { compiledFileName: "cli.js" }),
);
