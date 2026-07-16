import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import { graphToSvg } from "@refarm.dev/surveyor";
import { manifestRevisions } from "@refarm.dev/history-contract-v1";

import { buildDisclosureGraph, loadReceipts, loadRevocations } from "./disclosure-graph.js";

/**
 * SOVEREIGNTY — "minha soberania" in one view (the T2 analog of T1's plugin-ops).
 *
 * The citizen's sovereign posture is scattered across verbs (wallet, disclosure-graph, history)
 * whose web routes don't even mount. This aggregates the daemon-free facts from the SAME manifest
 * into one report + HTML dashboard the web content seam mounts: CREDENTIALS (verified / drafts) →
 * CONSENT (active / revoked authorizations) → DISCLOSURE (with whom, the graph) → TIMELINE (the
 * last sovereign change, from history — a revoked disclosure carries its when/why). One
 * photograph of the whole posture, a cross-join of distinct facts, not a concat.
 */

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface SovereigntyReport {
	credentials: { verified: number; draft: number; total: number };
	authorizations: { active: number; revoked: number; expired: number; total: number };
	/** With whom the citizen shared what, revoked ones carrying when/why. */
	disclosures: Array<{ requester: string; scope: string[]; status: string; revokedAt?: string; reason?: string }>;
	/** The most recent sovereign change recorded (which verb, when, total revisions). */
	lastChange?: { origin?: string; recordedAt: string; totalRevisions: number };
	/** The disclosure graph SVG for the dashboard. */
	graphSvg: string;
}

/** Assemble the sovereignty report from the wallet manifest — all pure, no daemon. */
export function buildSovereigntyReport(recordsDeps: RecordsCommandDeps): SovereigntyReport {
	const manifest = recordsDeps.loadManifest();
	// Credentials by review state (a credential record is a WalletItem with a review).
	let verified = 0;
	let draft = 0;
	for (const r of manifest.records) {
		const types = r["@type"];
		const isCredential = Array.isArray(types) ? types.includes("VerifiableCredential") : false;
		if (!isCredential) continue;
		if (r.review?.state === "verified") verified += 1;
		else draft += 1;
	}
	// Authorizations by status (from the held receipts).
	const receipts = loadReceipts(recordsDeps);
	const revocations = loadRevocations(recordsDeps);
	const byStatus = { active: 0, revoked: 0, expired: 0 };
	for (const receipt of receipts) {
		if (receipt.status === "active") byStatus.active += 1;
		else if (receipt.status === "revoked") byStatus.revoked += 1;
		else if (receipt.status === "expired") byStatus.expired += 1;
	}
	const { graph, labels, disclosures } = buildDisclosureGraph(receipts, revocations);
	const graphSvg = graphToSvg(graph, {
		labelFor: (id) => labels[id] ?? id,
		title: "Minha superfície de compartilhamento",
	});
	const revisions = manifestRevisions(manifest);
	const newest = revisions.slice().sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0];
	return {
		credentials: { verified, draft, total: verified + draft },
		authorizations: { ...byStatus, total: receipts.length },
		disclosures,
		...(newest ? { lastChange: { origin: newest.origin, recordedAt: newest.recordedAt, totalRevisions: revisions.length } } : {}),
		graphSvg,
	};
}

/** Render the report as a self-contained HTML dashboard (mirrors the T1/T3 dashboards). */
export function sovereigntyToHtml(r: SovereigntyReport): string {
	const disclosureRows = r.disclosures
		.map((d) => {
			const when = d.status === "revoked" && d.revokedAt ? ` — revogado em ${escapeHtml(d.revokedAt)}${d.reason ? ` (${escapeHtml(d.reason)})` : ""}` : "";
			return `<tr><td>${escapeHtml(d.requester)}</td><td>${escapeHtml(d.scope.join(", "))}</td><td>${escapeHtml(d.status)}${when}</td></tr>`;
		})
		.join("");
	const last = r.lastChange
		? `${escapeHtml(r.lastChange.origin ?? "—")} em ${escapeHtml(r.lastChange.recordedAt)} (${r.lastChange.totalRevisions} revisões)`
		: "sem histórico ainda";
	return `<section class="refarm-stack" data-sovereignty-dashboard>
  <h3>Minha soberania</h3>
  <p><strong>Credenciais:</strong> ${r.credentials.verified} verificadas · ${r.credentials.draft} a verificar (${r.credentials.total} total).</p>
  <p><strong>Consentimentos:</strong> ${r.authorizations.active} ativos · ${r.authorizations.revoked} revogados · ${r.authorizations.expired} expirados.</p>
  <table class="sovereignty-disclosures"><thead><tr><th>Serviço</th><th>Escopo</th><th>Estado</th></tr></thead><tbody>${disclosureRows || "<tr><td colspan=\"3\">Nada compartilhado ainda</td></tr>"}</tbody></table>
  <p><strong>Última mudança:</strong> ${last}.</p>
  <section class="refarm-stack" data-disclosure-graph>${r.graphSvg}</section>
</section>`;
}

/**
 * `sovereignty` — the citizen's whole sovereign posture in one view: credentials (verified/draft),
 * consent (active/revoked authorizations), the disclosure graph (with when/why for revoked ones),
 * and the last sovereign change. Emits JSON + an HTML dashboard the web content seam mounts.
 * Offline (pure over the manifest).
 */
export function createSovereigntyCapability(recordsDeps: RecordsCommandDeps): CapabilityDescriptor {
	return {
		name: "sovereignty",
		summary: "My sovereignty in one view: credentials, consent, disclosure, and the last change",
		transports: { http: { path: "/wallet/sovereignty" } },
		renderers: { tui: { section: "wallet" }, web: { route: "/sovereignty", icon: "shield" } },
		async run(_input: CapabilityInput): Promise<CapabilityEnvelope> {
			const report = buildSovereigntyReport(recordsDeps);
			return buildJsonSuccessEnvelope({
				command: "sovereignty",
				operation: "sovereignty",
				nextCommand: "dgk wallet",
				nextCommands: ["dgk wallet"],
				extra: {
					credentials: report.credentials,
					authorizations: report.authorizations,
					disclosures: report.disclosures,
					lastChange: report.lastChange,
					// The content-seam field the web boot reads to mount the dashboard above the cards.
					sovereigntyHtml: sovereigntyToHtml(report),
				},
			});
		},
	};
}
