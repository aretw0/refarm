import {
	defineRecordsViewCapability,
	type CapabilityDescriptor,
	type RecordsAnalyzeEnvelope,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import { createLocalRecordsCapabilityDeps } from "@refarm.dev/capability-host/node";

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

export function walletCapabilityBundle(options: WalletStateOptions = {}) {
	return createLocalRecordsCapabilityDeps({
		seed: walletManifest,
		statePath: options.statePath,
	});
}

const STATE_LABELS: Record<string, string> = {
	verified: "Verificados",
	draft: "A verificar",
	unreviewed: "Sem status",
};

/** Render the citizen's wallet — their held items, grouped by verification status. */
function renderWallet(env: RecordsAnalyzeEnvelope): string {
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
	return defineRecordsViewCapability({
		name: "wallet",
		summary: "Show my digital wallet — the items I hold (sovereign, local-first)",
		records: recordsDeps,
		project: (analyzed) => ({
			total: analyzed.summary.total,
			wallet: renderWallet(analyzed),
			byState: analyzed.summary.byState,
		}),
	});
}
