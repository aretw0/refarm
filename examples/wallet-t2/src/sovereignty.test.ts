import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createWalletCapabilities, walletCapabilityBundle } from "./persona.js";
import { buildDisclosureGraph } from "./disclosure-graph.js";
import { sovereigntyToHtml, type SovereigntyReport } from "./sovereignty.js";

const now = () => "2026-07-14T00:00:00.000Z";

function walletVerbs() {
	const statePath = path.join(mkdtempSync(path.join(os.tmpdir(), "wallet-sov-")), "state.json");
	const bundle = walletCapabilityBundle({ statePath, now });
	const verbs = createWalletCapabilities(bundle.records, {
		credentialsProvider: bundle.credentialsProvider,
		identity: bundle.identity,
		authorizationProvider: bundle.authorizationProvider,
		now,
	});
	return Object.assign(Object.fromEntries(verbs.map((v) => [v.name, v])), { __records: bundle.records });
}

const request = {
	args: { requester: "servico-beneficio" },
	options: { purpose: "verificar elegibilidade", scope: "faixa_etaria,vinculo", expires: "2099-01-01T00:00:00.000Z" },
	json: true,
} as const;

describe("sovereignty — the citizen's whole posture in one view", () => {
	let verbs: ReturnType<typeof walletVerbs>;
	beforeEach(() => {
		verbs = walletVerbs();
	});

	it("aggregates credentials + consent + disclosure + last change", async () => {
		// Authorize then revoke → one revoked consent + a durable history + a RevocationEvent.
		const authz = (await verbs.authorize!.run!(request)) as Record<string, unknown>;
		await verbs.revoke!.run!({ args: { id: authz.id as string }, options: { reason: "mudei de ideia" }, json: true });

		const env = (await verbs.sovereignty!.run!({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			authorizations: { active: number; revoked: number; total: number };
			disclosures: Array<{ requester: string; status: string; revokedAt?: string; reason?: string }>;
			lastChange?: { origin?: string };
			sovereigntyHtml: string;
		};
		expect(env.ok).toBe(true);
		// One authorization, now revoked.
		expect(env.authorizations.revoked).toBe(1);
		expect(env.authorizations.active).toBe(0);
		// THE B2 JOIN: the revoked disclosure carries WHEN + WHY (from the RevocationEvent) — info
		// the graph edge alone lacks.
		const revoked = env.disclosures.find((d) => d.status === "revoked");
		expect(revoked?.revokedAt).toBeTruthy();
		expect(revoked?.reason).toBe("mudei de ideia");
		// The last sovereign change is the revocation.
		expect(env.lastChange?.origin).toBe("revoke");
		// The dashboard HTML the web content seam mounts.
		expect(env.sovereigntyHtml).toContain("data-sovereignty-dashboard");
		expect(env.sovereigntyHtml).toContain("Minha soberania");
	});
});

describe("buildDisclosureGraph — revocation enrichment (B2)", () => {
	it("attaches revokedAt/reason to a revoked receipt from the revocations map", () => {
		const receipts = [
			{ id: "authz-1", requester: "Serviço A", scope: ["x"], status: "revoked" } as never,
			{ id: "authz-2", requester: "Serviço B", scope: ["y"], status: "active" } as never,
		];
		const revocations = new Map([["authz-1", { revokedAt: "2026-07-14T10:00:00Z", reason: "retirei" }]]);
		const { disclosures } = buildDisclosureGraph(receipts, revocations);
		const a = disclosures.find((d) => d.requester === "Serviço A");
		expect(a).toMatchObject({ status: "revoked", revokedAt: "2026-07-14T10:00:00Z", reason: "retirei" });
		// An active receipt gets no revocation info.
		const b = disclosures.find((d) => d.requester === "Serviço B");
		expect(b?.revokedAt).toBeUndefined();
	});
});

describe("sovereigntyToHtml — pure render", () => {
	it("renders the four panes + escapes", () => {
		const report: SovereigntyReport = {
			credentials: { verified: 2, draft: 1, total: 3 },
			authorizations: { active: 1, revoked: 1, expired: 0, total: 2 },
			disclosures: [{ requester: "Serviço <X>", scope: ["faixa_etaria"], status: "revoked", revokedAt: "2026-07-14T10:00:00Z", reason: "r" }],
			lastChange: { origin: "revoke", recordedAt: "2026-07-14T10:00:00Z", totalRevisions: 2 },
			graphSvg: "<svg></svg>",
		};
		const html = sovereigntyToHtml(report);
		expect(html).toContain("2 verificadas");
		expect(html).toContain("1 revogados");
		expect(html).toContain("Serviço &lt;X&gt;"); // escaped
		expect(html).toContain("revogado em 2026-07-14T10:00:00Z");
		expect(html).toContain("<svg>"); // the graph mounted
	});
});
