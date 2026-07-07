import {
	createRecordsCapabilityGroup,
	defaultVaultDeps,
	defaultSourceDeps,
	type RecordsCommandDeps,
	type RefarmCapabilityDeps,
} from "@refarm.dev/capabilities-v1";
import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
} from "@refarm.dev/cli/capabilities";
import { buildJsonSuccessEnvelope } from "@refarm.dev/cli/json-output";
import { createReferenceEnrichmentProvider } from "@refarm.dev/enrichment-contract-v1";
import { createReferenceRecordsProvider } from "@refarm.dev/records-contract-v1";

import { walletManifest } from "./fixture.js";

/**
 * The T2 persona (result mode). wallet presents the sovereign citizen's DIGITAL WALLET
 * as a finished product: the citizen sees their held items, grouped and curated — never
 * the neutral engine underneath. The focus is the benefit (my data, my wallet), not the
 * machine — the opposite of T1's process view.
 */

/** The citizen's records deps, backed by a mutable in-memory manifest (local-first —
 * the citizen's data lives with them; a real deployment backs it with local storage). */
export function walletRecordsDeps(): RecordsCommandDeps {
	let manifest = walletManifest();
	return {
		loadManifest: () => manifest,
		saveManifest: (next) => {
			manifest = next;
		},
		enrichmentProvider: createReferenceEnrichmentProvider(),
		recordsProvider: createReferenceRecordsProvider(),
	};
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

/** The T2 persona verb: `wallet-show` — the citizen's wallet view over the neutral
 * `records analyze` envelope (grouped by review state). */
export function createWalletShowCapability(
	recordsDeps: RecordsCommandDeps,
): CapabilityDescriptor {
	const analyzeAction = createRecordsCapabilityGroup(recordsDeps).actions.analyze;
	return {
		name: "wallet-show",
		summary: "Show my digital wallet — the items I hold (sovereign, local-first)",
		transports: {
			cli: {},
			repl: {},
			http: { method: "GET", path: "/wallet" },
			agent: { tool: true, toolName: "wallet_show" },
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
				command: "wallet-show",
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
