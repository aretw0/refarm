import type { RecordsCommandDeps } from "@refarm.dev/capability-host";
import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import { citizenAttributes, verifiedAttributes } from "./authorization.js";

/**
 * The join that closes the sovereign loop: `present` discloses FROM the citizen's actually-verified
 * credentials, not a hardcoded synthetic set. These pin that `verifiedAttributes` projects a
 * VERIFIED credential's subject into disclosable attributes, and falls back to the baseline only
 * until the citizen has verified one.
 */
function credentialRecord(state: string, subject: Record<string, unknown>): KnowledgeRecord {
	return {
		id: `record:cred-${state}`,
		schemaVersion: 1,
		"@type": ["KnowledgeRecord", "WalletItem", "VerifiableCredential"],
		fields: {
			title: "Credencial",
			kind: "credencial",
			issuer: "did:gov:orgao",
			credential: {
				"@context": ["https://www.w3.org/ns/credentials/v2"],
				type: ["VerifiableCredential"],
				issuer: "did:gov:orgao",
				issuanceDate: "2026-02-01T00:00:00.000Z",
				credentialSubject: { id: "did:citizen:me", ...subject },
			},
		},
		sections: [],
		review: { state, at: "2026-02-01T00:00:00.000Z" },
		contentHash: "x",
	} as unknown as KnowledgeRecord;
}

function deps(records: KnowledgeRecord[]): RecordsCommandDeps {
	return { loadManifest: () => ({ records }) } as unknown as RecordsCommandDeps;
}

describe("verifiedAttributes — present discloses from the citizen's verified credentials", () => {
	it("projects a VERIFIED credential's subject fields into disclosable attributes", () => {
		const attrs = verifiedAttributes(
			deps([credentialRecord("verified", { faixa_etaria: "30-39", vinculo: "servidor" })]),
		)();
		// The disclosed attributes come from the verified credential's subject …
		expect(attrs.attributes).toEqual({ faixa_etaria: "30-39", vinculo: "servidor" });
		// … carrying the citizen's real subject + the credential's issuer.
		expect(attrs.subject).toBe("did:citizen:me");
		expect(attrs.issuer).toBe("did:gov:orgao");
		// The subject id is NEVER disclosed as an attribute.
		expect((attrs.attributes as Record<string, unknown>).id).toBeUndefined();
	});

	it("merges the subjects of MULTIPLE verified credentials", () => {
		const attrs = verifiedAttributes(
			deps([
				credentialRecord("verified", { faixa_etaria: "30-39" }),
				{ ...credentialRecord("verified", { curso: "Engenharia" }), id: "record:cred-2" } as KnowledgeRecord,
			]),
		)();
		expect(attrs.attributes).toMatchObject({ faixa_etaria: "30-39", curso: "Engenharia" });
	});

	it("SKIPS a verified credential for a different holder (never adopts another subject's identity)", () => {
		const attrs = verifiedAttributes(
			deps([
				credentialRecord("verified", { faixa_etaria: "30-39" }), // the citizen: did:citizen:me
				// A verified credential whose SUBJECT is a different holder (spread overrides the id).
				{
					...credentialRecord("verified", { id: "did:someone:else", curso: "Engenharia" }),
					id: "record:cred-other",
				} as KnowledgeRecord,
			]),
		)();
		// Only the citizen's OWN attribute is disclosed; the other holder's is skipped.
		expect(attrs.subject).toBe("did:citizen:me");
		expect(attrs.attributes).toEqual({ faixa_etaria: "30-39" });
		expect((attrs.attributes as Record<string, unknown>).curso).toBeUndefined();
	});

	it("falls back to the synthetic baseline until a credential is verified", () => {
		// A DRAFT (imported, not yet verified) credential is NOT disclosed from.
		expect(verifiedAttributes(deps([credentialRecord("draft", { curso: "X" })]))()).toEqual(citizenAttributes());
		// An empty wallet → the baseline.
		expect(verifiedAttributes(deps([]))()).toEqual(citizenAttributes());
	});
});
