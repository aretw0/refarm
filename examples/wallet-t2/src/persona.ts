import {
	buildJsonSuccessEnvelope,
	createRecordsCapabilityGroup,
	defaultSourceDeps,
	defaultVaultDeps,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type RecordsCommandDeps,
	type RefarmCapabilityDeps,
} from "@refarm.dev/capabilities-v1";
import { createLocalRecordsCommandDeps } from "@refarm.dev/capabilities-v1/node";
import { createReferenceEnrichmentProvider } from "@refarm.dev/enrichment-contract-v1";
import { createReferenceRecordsProvider } from "@refarm.dev/records-contract-v1";

import { walletManifest } from "./fixture.js";

/**
 * The T2 persona (result mode). wallet presents the sovereign citizen's DIGITAL WALLET
 * as a finished product: the citizen sees their held items, grouped and curated — never
 * the neutral engine underneath. The focus is the benefit (my data, my wallet), not the
 * machine — the opposite of T1's process view.
 */

/** The citizen's records deps, backed by a mutable manifest and optional local state
 * file. Without a state path it stays in-memory for deterministic tests. */
export interface WalletStateOptions {
	statePath?: string;
}

export function walletRecordsDeps(options: WalletStateOptions = {}): RecordsCommandDeps {
	return createLocalRecordsCommandDeps({
		seed: walletManifest,
		statePath: options.statePath,
		enrichmentProvider: createReferenceEnrichmentProvider(),
		recordsProvider: createReferenceRecordsProvider(),
	});
}

export function walletCapabilityDeps(
	recordsDeps: RecordsCommandDeps = walletRecordsDeps(),
): RefarmCapabilityDeps {
	return {
		// The citizen holds their own data — no external source to pull. An ephemeral
		// source provider satisfies the block; the wallet is local-first.
		source: defaultSourceDeps(),
		vault: defaultVaultDeps({
			discover: () => ({ providers: [], rejected: [] }),
			submitEffort: async () => "wallet-noop",
			seed: walletManifest,
		}),
		records: recordsDeps,
	};
}

interface AnalyzeEnvelope {
	summary: { total: number; byState: Record<string, number> };
	groups: Array<{
		key: string;
		label: string;
		count: number;
		records: Array<{ id: string; title: string; link: string }>;
	}>;
}

const STATE_LABELS: Record<string, string> = {
	verified: "Verificados",
	draft: "A verificar",
	unreviewed: "Sem status",
};

/** Render the citizen's wallet — their held items, grouped by verification status. */
function renderWallet(env: AnalyzeEnvelope): string {
	const lines: string[] = [
		"👜 Minha Carteira Digital",
		"",
		`${env.summary.total} itens · você é dono dos seus dados`,
		"",
	];
	for (const group of env.groups) {
		lines.push(`${STATE_LABELS[group.key] ?? group.label} (${group.count})`);
		for (const record of group.records) {
			lines.push(`  • ${record.title}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd() + "\n";
}

/** The T2 persona verb: `wallet` - the citizen's wallet view over the neutral
 * `records analyze` envelope (grouped by review state). */
export function createWalletCapability(
	recordsDeps: RecordsCommandDeps,
): CapabilityDescriptor {
	const analyzeAction = createRecordsCapabilityGroup(recordsDeps).actions.analyze;
	return {
		name: "wallet",
		summary: "Show my digital wallet — the items I hold (sovereign, local-first)",
		transports: {
			cli: {},
			repl: {},
			http: { method: "GET", path: "/wallet" },
			agent: { tool: true, toolName: "wallet" },
		},
		renderers: { tui: { section: "wallet" } },
		async run(): Promise<CapabilityEnvelope> {
			if (!analyzeAction) throw new Error("records analyze missing");
			const analyzed = (await analyzeAction.run({
				args: {},
				options: { by: "reviewState" },
				json: true,
			})) as unknown as AnalyzeEnvelope;
			return buildJsonSuccessEnvelope({
				command: "wallet",
				operation: "render",
				extra: {
					total: analyzed.summary.total,
					wallet: renderWallet(analyzed),
					byState: analyzed.summary.byState,
				},
			});
		},
	};
}
