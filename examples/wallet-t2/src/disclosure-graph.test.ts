import type { AuthorizationReceipt } from "@refarm.dev/authorization-contract-v1";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createWalletCapabilities, walletCapabilityBundle } from "./persona.js";
import { buildDisclosureGraph, CITIZEN_NODE } from "./disclosure-graph.js";

const now = () => "2026-07-14T00:00:00.000Z";

function receipt(requester: string, scope: string[], status: AuthorizationReceipt["status"]): AuthorizationReceipt {
	return {
		id: `authz-${requester}`,
		holder: "did:example:cidadao",
		requester,
		purpose: "test",
		scope,
		issuedAt: now(),
		expiresAt: "2099-01-01T00:00:00.000Z",
		status,
		proof: { type: "test", algorithm: "test", signature: "sig" },
	};
}

describe("disclosure-graph — the citizen's disclosure surface (with whom I shared what)", () => {
	it("puts the citizen at the centre with an edge per disclosure", () => {
		const { graph, disclosures, labels } = buildDisclosureGraph([
			receipt("Loja A", ["faixa_etaria"], "active"),
			receipt("Órgão B", ["vinculo"], "revoked"),
		]);
		// The citizen + two services.
		expect(graph.nodes.map((n) => n.id).sort()).toEqual([CITIZEN_NODE, "svc:Loja A", "svc:Órgão B"].sort());
		expect(labels[CITIZEN_NODE]).toContain("cidadão");
		// One edge per disclosure, all from the citizen.
		expect(graph.links).toHaveLength(2);
		expect(graph.links.every((l) => l.source === CITIZEN_NODE)).toBe(true);
		// The disclosures carry the scope + status (revoked is visible, not hidden).
		expect(disclosures).toEqual([
			{ requester: "Loja A", scope: ["faixa_etaria"], status: "active" },
			{ requester: "Órgão B", scope: ["vinculo"], status: "revoked" },
		]);
	});

	it("is empty on a fresh wallet, and grows as the citizen authorizes", async () => {
		const statePath = path.join(mkdtempSync(path.join(os.tmpdir(), "wallet-disc-")), "state.json");
		const bundle = walletCapabilityBundle({ statePath, now });
		const verbs = Object.fromEntries(
			createWalletCapabilities(bundle.records, {
				authorizationProvider: bundle.authorizationProvider,
				now,
			}).map((v) => [v.name, v]),
		);

		// Fresh wallet: no disclosures yet.
		const empty = (await verbs["disclosure-graph"]!.run!({ args: {}, options: {}, json: true })) as Record<string, unknown>;
		expect(empty.ok).toBe(true);
		expect(empty.disclosureCount).toBe(0);
		expect(empty.graphSvg).toContain("<svg");

		// The citizen authorizes a service — now the graph has an edge.
		await verbs.authorize!.run!({
			args: { requester: "Serviço Fictício" },
			options: { purpose: "verificar", scope: "faixa_etaria", expires: "2099-01-01T00:00:00.000Z" },
			json: true,
		});
		const grown = (await verbs["disclosure-graph"]!.run!({ args: {}, options: { svg: true }, json: true })) as Record<
			string,
			unknown
		>;
		expect(grown.disclosureCount).toBe(1);
		expect((grown.disclosures as Array<{ requester: string }>)[0]?.requester).toBe("Serviço Fictício");
		expect(grown.svg).toContain("surveyor-graph__edges");
	});
});
