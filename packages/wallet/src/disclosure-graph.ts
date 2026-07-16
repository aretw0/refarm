import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";
import type { AuthorizationReceipt } from "@refarm.dev/authorization-contract-v1";
import { graphToSvg, type GraphInput } from "@refarm.dev/surveyor";

import { recordToReceipt } from "./authorization.js";

/**
 * DISCLOSURE GRAPH — the citizen SEES their own disclosure surface: with whom they
 * shared what, and whether it's still live. Each authorization receipt is an edge
 * (citizen → service), labelled by the scope shared and coloured by status
 * (active / revoked / expired). The sovereignty "shows well" artifact — the wallet's
 * result view made visual, the same Surveyor block T1's plugin graph and T3's
 * requirements graph use; here the records are disclosure receipts.
 */

/** The stable node id for the citizen (the holder) at the centre of their graph. */
export const CITIZEN_NODE = "me";

/** When/why a disclosure was revoked — the time dimension the graph alone lacks (from the
 * persisted RevocationEvent, keyed by the authorization id). */
export interface RevocationInfo {
	revokedAt?: string;
	reason?: string;
}

export interface DisclosureGraph {
	graph: GraphInput;
	labels: Record<string, string>;
	/** The disclosure edges, as data for the JSON envelope: who got what, its status, and — for a
	 * revoked one — WHEN and WHY (enriched from the RevocationEvent). */
	disclosures: Array<{ requester: string; scope: string[]; status: string; revokedAt?: string; reason?: string }>;
}

/** A stable node id for a requester (a service the citizen disclosed to). */
function requesterNode(requester: string): string {
	return `svc:${requester}`;
}

/**
 * Build the citizen's disclosure graph from their held authorization receipts. The
 * citizen is one node; each distinct requester is a node; each receipt is an edge
 * citizen → requester. A requester's degree reflects how many disclosures it holds.
 * Pure — unit-tested.
 */
export function buildDisclosureGraph(
	receipts: readonly AuthorizationReceipt[],
	revocations: ReadonlyMap<string, RevocationInfo> = new Map(),
): DisclosureGraph {
	const labels: Record<string, string> = { [CITIZEN_NODE]: "Eu (cidadão)" };
	const links: Array<{ source: string; target: string }> = [];
	const disclosures: DisclosureGraph["disclosures"] = [];
	const degree = new Map<string, number>([[CITIZEN_NODE, 0]]);
	const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);

	for (const receipt of receipts) {
		const node = requesterNode(receipt.requester);
		if (!(node in labels)) labels[node] = receipt.requester;
		links.push({ source: CITIZEN_NODE, target: node });
		// A revoked disclosure gains WHEN/WHY from its RevocationEvent — the graph edge alone shows
		// only THAT it's revoked; this enriches it with the time dimension (the B2 join).
		const revocation = receipt.status === "revoked" ? revocations.get(receipt.id) : undefined;
		disclosures.push({
			requester: receipt.requester,
			scope: receipt.scope,
			status: receipt.status,
			...(revocation?.revokedAt ? { revokedAt: revocation.revokedAt } : {}),
			...(revocation?.reason ? { reason: revocation.reason } : {}),
		});
		bump(CITIZEN_NODE);
		bump(node);
	}

	const nodeIds = Object.keys(labels);
	const nodes = nodeIds.map((id) => ({ id, degree: degree.get(id) ?? 0 }));
	return { graph: { nodes, links }, labels, disclosures };
}

/** Read the citizen's held authorization receipts from the wallet manifest. */
export function loadReceipts(recordsDeps: RecordsCommandDeps): AuthorizationReceipt[] {
	return recordsDeps
		.loadManifest()
		.records.map((record) => recordToReceipt(record))
		.filter((r): r is AuthorizationReceipt => r !== null);
}

/** Read the persisted RevocationEvents into a map (authorizationId → when/why), so a revoked
 * disclosure can show WHEN and WHY it was revoked. */
export function loadRevocations(recordsDeps: RecordsCommandDeps): Map<string, RevocationInfo> {
	const map = new Map<string, RevocationInfo>();
	for (const record of recordsDeps.loadManifest().records) {
		const types = record["@type"];
		const isEvent = Array.isArray(types) ? types.includes("RevocationEvent") : types === "RevocationEvent";
		if (!isEvent) continue;
		const fields = record.fields as Record<string, unknown> | undefined;
		const authorizationId = typeof fields?.authorizationId === "string" ? fields.authorizationId : undefined;
		if (!authorizationId) continue;
		map.set(authorizationId, {
			...(typeof fields?.revokedAt === "string" ? { revokedAt: fields.revokedAt } : {}),
			...(typeof fields?.reason === "string" ? { reason: fields.reason } : {}),
		});
	}
	return map;
}

/**
 * `disclosure-graph [--svg]` — render the citizen's disclosure surface: with whom they
 * shared what. Default (JSON) reports the disclosures as data; `--svg` returns the SVG
 * the web face shows. Empty on a fresh wallet — it grows as the citizen authorizes.
 */
export function createDisclosureGraphCapability(recordsDeps: RecordsCommandDeps): CapabilityDescriptor {
	return {
		name: "disclosure-graph",
		summary: "See with whom I shared what — my disclosure surface, as a graph",
		options: [{ name: "svg", kind: "boolean", summary: "Return the rendered SVG instead of the JSON graph" }],
		transports: { http: { path: "/wallet/disclosure-graph" } },
		renderers: { tui: { section: "wallet" }, web: { route: "/disclosure-graph", icon: "share" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const receipts = loadReceipts(recordsDeps);
			const { graph, labels, disclosures } = buildDisclosureGraph(receipts, loadRevocations(recordsDeps));
			const svg = graphToSvg(graph, {
				labelFor: (id) => labels[id] ?? id,
				title: "Minha superfície de compartilhamento — com quem compartilhei o quê",
			});
			return buildJsonSuccessEnvelope({
				command: "disclosure-graph",
				operation: "disclosure-graph",
				nextCommand: "dgk wallet",
				nextCommands: ["dgk wallet"],
				extra: {
					disclosureCount: disclosures.length,
					disclosures,
					...(input.options?.svg === true ? { svg } : {}),
					// The web face mounts this to show the disclosure surface.
					graphSvg: svg,
				},
			});
		},
	};
}
