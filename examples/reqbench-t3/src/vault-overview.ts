import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import type { KnowledgeRecord, RecordsManifest } from "@refarm.dev/records-contract-v1";
import { analyzeCorpusHealth } from "@refarm.dev/vault-contract-v1";
import { manifestRevisions } from "@refarm.dev/history-contract-v1";

/**
 * VAULT OVERVIEW — the analyst's whole vault in one view (the T3 analog of T1's plugin-ops).
 *
 * Today knowing "where does my vault stand" means running five verbs (requirements, health,
 * graph, history, search). This aggregates the daemon-free facts from the SAME manifest into one
 * report + HTML dashboard the web content seam mounts: COVERAGE (by sistema/tipo/status) →
 * TRACEABILITY (relations) → ATTACHMENTS → HEALTH (orphans/duplicates/dangling) → LAST CHANGE
 * (the newest revision origin/time). A cross-join of the corpus from five angles, not a concat.
 */

function countBy(records: readonly KnowledgeRecord[], field: string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const r of records) {
		const value = String(r.fields?.[field] ?? "—");
		out[value] = (out[value] ?? 0) + 1;
	}
	return out;
}

export interface VaultOverview {
	total: number;
	bySistema: Record<string, number>;
	byTipo: Record<string, number>;
	byStatus: Record<string, number>;
	/** How many in-corpus traceability edges (relations resolving to another record). */
	relations: number;
	/** How many records carry a materialized attachment. */
	attachments: number;
	health: { healthy: boolean; orphans: number; duplicates: number; dangling: number };
	/** The most recent change recorded: which verb, when, and how many total revisions. */
	lastChange?: { origin?: string; recordedAt: string; totalRevisions: number };
}

/** Assemble the overview from the manifest — all pure, no daemon. */
export function buildVaultOverview(manifest: RecordsManifest): VaultOverview {
	const records = manifest.records;
	const ids = new Set(records.map((r) => r.id));
	let relations = 0;
	let attachments = 0;
	for (const r of records) {
		for (const rel of r.relations ?? []) {
			// Count only IN-corpus edges (a resolved target) — the traceability the graph draws.
			if (ids.has(rel.target)) relations += 1;
		}
		if ((r.attachments && r.attachments.length > 0) || r.fields?.attachmentHash) attachments += 1;
	}
	const health = analyzeCorpusHealth(records);
	const revisions = manifestRevisions(manifest);
	const newest = revisions.slice().sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0];
	return {
		total: records.length,
		bySistema: countBy(records, "sistema"),
		byTipo: countBy(records, "tipo"),
		byStatus: countBy(records, "status"),
		relations,
		attachments,
		health: {
			healthy: health.healthy,
			orphans: health.counts.orphan,
			duplicates: health.counts.duplicate,
			dangling: health.counts["dangling-relation"],
		},
		...(newest ? { lastChange: { origin: newest.origin, recordedAt: newest.recordedAt, totalRevisions: revisions.length } } : {}),
	};
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function countRow(label: string, counts: Record<string, number>): string {
	const cells = Object.entries(counts)
		.map(([k, n]) => `${escapeHtml(k)}: <strong>${n}</strong>`)
		.join(" · ");
	return `<tr><td>${escapeHtml(label)}</td><td>${cells || "—"}</td></tr>`;
}

/** Render the overview as a self-contained HTML dashboard (mirrors governanceToHtml / plugin-ops). */
export function vaultOverviewToHtml(o: VaultOverview): string {
	const healthLine = o.health.healthy
		? "healthy — no orphans, duplicates, or dangling links"
		: `${o.health.orphans} orphan · ${o.health.duplicates} duplicate · ${o.health.dangling} dangling`;
	const last = o.lastChange
		? `${escapeHtml(o.lastChange.origin ?? "—")} at ${escapeHtml(o.lastChange.recordedAt)} (${o.lastChange.totalRevisions} revisions)`
		: "no history yet";
	return `<section class="refarm-stack" data-vault-overview>
  <h3>Vault overview — ${o.total} requirements</h3>
  <table class="vault-overview-coverage">
    <tbody>
      ${countRow("Sistema", o.bySistema)}
      ${countRow("Tipo", o.byTipo)}
      ${countRow("Status", o.byStatus)}
      <tr><td>Rastreabilidade</td><td><strong>${o.relations}</strong> relações · <strong>${o.attachments}</strong> anexos</td></tr>
      <tr><td>Saúde</td><td>${escapeHtml(healthLine)}</td></tr>
      <tr><td>Última mudança</td><td>${last}</td></tr>
    </tbody>
  </table>
</section>`;
}

/**
 * `requirements-overview` — the vault's whole state in one view: coverage (sistema/tipo/status),
 * traceability (relations + attachments), health (orphans/duplicates/dangling), and the last
 * change. Emits JSON + an HTML dashboard the web content seam mounts. Offline (pure over the
 * manifest).
 */
export function createRequirementsOverviewCapability(recordsDeps: RecordsCommandDeps): CapabilityDescriptor {
	return {
		name: "requirements-overview",
		summary: "The vault in one view: coverage, traceability, health, and the last change",
		transports: { http: { path: "/requirements/overview" } },
		renderers: { tui: { section: "requirements" }, web: { route: "/overview", icon: "layout-dashboard" } },
		async run(_input: CapabilityInput): Promise<CapabilityEnvelope> {
			const overview = buildVaultOverview(recordsDeps.loadManifest());
			return buildJsonSuccessEnvelope({
				command: "requirements-overview",
				operation: "overview",
				nextCommand: "dgk requirements",
				nextCommands: ["dgk requirements"],
				extra: {
					total: overview.total,
					bySistema: overview.bySistema,
					byTipo: overview.byTipo,
					byStatus: overview.byStatus,
					relations: overview.relations,
					attachments: overview.attachments,
					health: overview.health,
					lastChange: overview.lastChange,
					// The content-seam field the web boot reads to mount the dashboard above the cards.
					overviewHtml: vaultOverviewToHtml(overview),
				},
			});
		},
	};
}
