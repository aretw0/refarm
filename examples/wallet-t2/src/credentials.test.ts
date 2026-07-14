import { createInMemoryCredentialsProviderFixture } from "@refarm.dev/credentials-contract-v1";
import type { VerifiableCredential } from "@refarm.dev/credentials-contract-v1";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWalletCapabilities, renderWalletHtml, walletCapabilityBundle } from "./persona.js";
import { credentialToRecord, parseCredentialFile, recordToCredential } from "./credentials.js";

const now = () => "2026-07-12T00:00:00.000Z";

/** Issue a real, signed VC from a provider fixture, so `verify` has something genuine to check.
 * Returns the signed credential + the issuer id. */
async function issueTestCredential(
	fixture: ReturnType<typeof createInMemoryCredentialsProviderFixture>,
	overrides: Partial<VerifiableCredential> = {},
): Promise<VerifiableCredential> {
	const issuer = await fixture.identity.create("Synthetic civic issuer");
	const subject = await fixture.identity.create("Synthetic holder");
	const unsigned: VerifiableCredential = {
		"@context": ["https://www.w3.org/2018/credentials/v1"],
		type: ["VerifiableCredential", "CarteiraDigital"],
		issuer: issuer.id,
		issuanceDate: "2026-01-01T00:00:00.000Z",
		credentialSubject: { id: subject.id, name: "Fulano de Tal" },
		...overrides,
	};
	return fixture.provider.issue(unsigned, issuer.id);
}

describe("credential mapping (VC ↔ record)", () => {
	it("maps a VC to a wallet record keeping the raw VC, and reads it back", () => {
		const vc: VerifiableCredential = {
			"@context": "https://www.w3.org/2018/credentials/v1",
			type: ["VerifiableCredential", "CarteiraDigital"],
			issuer: "did:example:issuer",
			issuanceDate: "2026-01-01T00:00:00.000Z",
			expirationDate: "2030-01-01T00:00:00.000Z",
			credentialSubject: { id: "did:example:me", name: "Fulano" },
		};
		const record = credentialToRecord(vc, now);
		expect(record["@type"]).toContain("VerifiableCredential");
		expect(record.fields.title).toBe("CarteiraDigital");
		expect(record.fields.issuer).toBe("did:example:issuer");
		expect(record.fields.expirationDate).toBe("2030-01-01T00:00:00.000Z");
		expect(record.review?.state).toBe("draft"); // imports are unverified
		expect(record.contentHash).toMatch(/^fnv1a32:/);
		// the raw VC round-trips, so verify can re-check it
		expect(recordToCredential(record)).toEqual(vc);
	});

	it("parseCredentialFile rejects non-JSON and non-VC", () => {
		expect(() => parseCredentialFile("not json")).toThrow(/INVALID_CREDENTIAL/);
		expect(() => parseCredentialFile("{}")).toThrow(/Verifiable Credential/);
		expect(() => parseCredentialFile('{"issuer":"x","credentialSubject":{}}')).not.toThrow();
	});
});

describe("wallet import + REAL verify (end-to-end)", () => {
	let fixture: ReturnType<typeof createInMemoryCredentialsProviderFixture>;
	let dir: string;

	beforeEach(() => {
		fixture = createInMemoryCredentialsProviderFixture();
		dir = mkdtempSync(path.join(os.tmpdir(), "wallet-cred-"));
	});
	afterEach(() => {
		// temp dir left for the OS to reap; deterministic per test
	});

	function bundle(statePath: string) {
		// The SAME provider + identity issue the test VC and back verify/share, so a genuine
		// signature (and holder-signed presentation) checks out.
		const b = walletCapabilityBundle({
			statePath,
			credentialsProvider: fixture.provider,
			identity: fixture.identity,
			now,
		});
		const verbs = createWalletCapabilities(b.records, {
			credentialsProvider: b.credentialsProvider,
			identity: b.identity,
			now,
		});
		const byName = new Map(verbs.map((v) => [v.name, v]));
		return { records: b.records, byName };
	}

	it("import a credential file → it appears as a draft; verify → it becomes verified", async () => {
		const vc = await issueTestCredential(fixture);
		const file = path.join(dir, "cred.json");
		writeFileSync(file, JSON.stringify(vc));
		const statePath = path.join(dir, "wallet.json");

		// IMPORT
		const imp = bundle(statePath).byName.get("import")!;
		const impRes = (await imp.run({ args: { file }, options: {}, json: true })) as unknown as {
			ok: boolean;
			id: string;
			state: string;
			persisted: boolean;
		};
		expect(impRes.ok).toBe(true);
		expect(impRes.state).toBe("draft");
		expect(impRes.persisted).toBe(true);
		const id = impRes.id;

		// VERIFY (real: signature + issuer + validity) → promotes to verified
		const ver = bundle(statePath).byName.get("verify")!;
		const verRes = (await ver.run({ args: { id }, options: {}, json: true })) as unknown as {
			ok: boolean;
			valid: boolean;
			state: string;
			checks: { signature?: { ok: boolean } };
		};
		expect(verRes.ok).toBe(true);
		expect(verRes.valid).toBe(true);
		expect(verRes.state).toBe("verified");
		expect(verRes.checks.signature?.ok).toBe(true);

		// The record is now verified in the persisted wallet.
		const after = bundle(statePath)
			.records.loadManifest()
			.records.find((r) => r.id === id);
		expect(after?.review?.state).toBe("verified");
	});

	it("verify REJECTS a tampered credential and does NOT promote it", async () => {
		const vc = await issueTestCredential(fixture);
		// Tamper: change a subject claim AFTER signing → signature no longer matches.
		const tampered = { ...vc, credentialSubject: { ...vc.credentialSubject, name: "Impostor" } };
		const file = path.join(dir, "tampered.json");
		writeFileSync(file, JSON.stringify(tampered));
		const statePath = path.join(dir, "wallet.json");

		const b = bundle(statePath);
		const imp = b.byName.get("import")!;
		const id = (
			(await imp.run({ args: { file }, options: {}, json: true })) as unknown as { id: string }
		).id;

		const ver = bundle(statePath).byName.get("verify")!;
		const verRes = (await ver.run({ args: { id }, options: {}, json: true })) as unknown as {
			ok: boolean;
			error?: string;
			valid?: boolean;
			failures?: string[];
		};
		expect(verRes.ok).toBe(false);
		expect(verRes.error).toBe("verification_failed");
		expect(verRes.valid).toBe(false);
		expect(verRes.failures?.join(" ")).toMatch(/signature/i);

		// The record stays draft — a tampered credential is never marked verified.
		const after = bundle(statePath)
			.records.loadManifest()
			.records.find((r) => r.id === id);
		expect(after?.review?.state).toBe("draft");
	});

	it("verify errors helpfully on a non-credential wallet item", async () => {
		const statePath = path.join(dir, "wallet.json");
		const ver = bundle(statePath).byName.get("verify")!;
		// The seed has plain documents (no VC) — verifying one is a helpful error.
		const res = (await ver.run({
			args: { id: "record:doc-identidade" },
			options: {},
			json: true,
		})) as unknown as { ok: boolean; error: string };
		expect(res.ok).toBe(false);
		expect(res.error).toBe("not_a_credential");
	});

	it("the DEFAULT policy enforces validity — verify runs the withinValidity check, not signature alone", async () => {
		// The regression this guards: verify used to pass NO policy, so only the signature was
		// checked. The default policy (validity: required) must now make the substrate run the
		// validity check — proven by its presence in the reported checks.
		const vc = await issueTestCredential(fixture);
		const file = path.join(dir, "cred.json");
		writeFileSync(file, JSON.stringify(vc));
		const statePath = path.join(dir, "wallet.json");
		const imp = bundle(statePath).byName.get("import")!;
		const id = ((await imp.run({ args: { file }, options: {}, json: true })) as unknown as { id: string }).id;

		const ver = bundle(statePath).byName.get("verify")!;
		const res = (await ver.run({ args: { id }, options: {}, json: true })) as unknown as {
			ok: boolean;
			valid: boolean;
			checks: { withinValidity?: { ok: boolean }; notRevoked?: unknown };
			enforced: string[];
		};
		expect(res.ok).toBe(true);
		expect(res.valid).toBe(true);
		// Validity WAS evaluated (the wire works) …
		expect(res.checks.withinValidity?.ok).toBe(true);
		expect(res.enforced).toContain("withinValidity");
		// … but revocation is NOT in the default (opt-in via --strict).
		expect(res.checks.notRevoked).toBeUndefined();
	});

	it("verify REJECTS an expired credential under the default policy", async () => {
		// An expired credential has a valid signature but must fail validity — the exact case a
		// signature-only check silently accepted before the policy was wired.
		const vc = await issueTestCredential(fixture, {
			issuanceDate: "2020-01-01T00:00:00.000Z",
			expirationDate: "2021-01-01T00:00:00.000Z", // well before the `now` clock (2026)
		});
		const file = path.join(dir, "expired.json");
		writeFileSync(file, JSON.stringify(vc));
		const statePath = path.join(dir, "wallet.json");
		const imp = bundle(statePath).byName.get("import")!;
		const id = ((await imp.run({ args: { file }, options: {}, json: true })) as unknown as { id: string }).id;

		const ver = bundle(statePath).byName.get("verify")!;
		const res = (await ver.run({ args: { id }, options: {}, json: true })) as unknown as {
			ok: boolean;
			error?: string;
			failures?: string[];
		};
		expect(res.ok).toBe(false);
		expect(res.error).toBe("verification_failed");
		expect(res.failures?.join(" ")).toMatch(/expired/i);
		// The expired credential stays draft — never promoted.
		const after = bundle(statePath).records.loadManifest().records.find((r) => r.id === id);
		expect(after?.review?.state).toBe("draft");
	});

	it("--strict additionally enforces revocation + issuer trust (a provider-issued credential passes)", async () => {
		// A credential issued through the provider carries a signed status list, so --strict's
		// revocation + issuer-trust checks resolve and pass — proving the strict wire end to end.
		const vc = await issueTestCredential(fixture);
		const file = path.join(dir, "cred.json");
		writeFileSync(file, JSON.stringify(vc));
		const statePath = path.join(dir, "wallet.json");
		const imp = bundle(statePath).byName.get("import")!;
		const id = ((await imp.run({ args: { file }, options: {}, json: true })) as unknown as { id: string }).id;

		const ver = bundle(statePath).byName.get("verify")!;
		const res = (await ver.run({ args: { id }, options: { strict: true }, json: true })) as unknown as {
			ok: boolean;
			valid: boolean;
			strict: boolean;
			checks: { notRevoked?: { ok: boolean }; issuerTrusted?: { ok: boolean } };
			enforced: string[];
		};
		expect(res.ok).toBe(true);
		expect(res.valid).toBe(true);
		expect(res.strict).toBe(true);
		// The strict-only checks ran and passed.
		expect(res.checks.notRevoked?.ok).toBe(true);
		expect(res.checks.issuerTrusted?.ok).toBe(true);
		expect(res.enforced).toContain("notRevoked");
		expect(res.enforced).toContain("issuerTrusted");
	});

	it("REVOCATION chain: issuer issues → wallet passes --strict → issuer revokes → --strict rejects", async () => {
		// The canonical SSI story: a credential can be KILLED after issuance, and the wallet
		// detects it. The issuer issues (auto status list), the citizen verifies strictly (passes),
		// the ISSUER revokes it (flips the bit), and the SAME credential re-verified strictly now
		// fails — no re-import, no new file: the revocation is discovered from the status list.
		const issuer = await fixture.identity.create("Emissor civil");
		const subject = await fixture.identity.create("Cidadão");
		const vc = await fixture.provider.issue(
			{
				"@context": ["https://www.w3.org/2018/credentials/v1"],
				type: ["VerifiableCredential", "CarteiraDigital"],
				issuer: issuer.id,
				issuanceDate: "2026-01-01T00:00:00.000Z",
				credentialSubject: { id: subject.id, name: "Fulano" },
			},
			issuer.id,
		);
		const file = path.join(dir, "cred.json");
		writeFileSync(file, JSON.stringify(vc));

		// Before revocation, in a fresh wallet — strict verify PASSES (status list resolves, bit unset).
		const beforePath = path.join(dir, "before.json");
		const impBefore = bundle(beforePath).byName.get("import")!;
		const beforeId = ((await impBefore.run({ args: { file }, options: {}, json: true })) as unknown as { id: string }).id;
		const before = (await bundle(beforePath).byName.get("verify")!.run({
			args: { id: beforeId },
			options: { strict: true },
			json: true,
		})) as unknown as { ok: boolean; checks: { notRevoked?: { ok: boolean } } };
		expect(before.ok).toBe(true);
		expect(before.checks.notRevoked?.ok).toBe(true);

		// The ISSUER revokes it (only the issuer can — the wallet just detects it).
		const revocation = await fixture.provider.revoke(vc, issuer.id);
		expect(revocation.revoked).toBe(true);

		// After revocation, a fresh import + strict verify — the SAME credential is now REJECTED.
		const afterPath = path.join(dir, "after.json");
		const impAfter = bundle(afterPath).byName.get("import")!;
		const afterId = ((await impAfter.run({ args: { file }, options: {}, json: true })) as unknown as { id: string }).id;
		const after = (await bundle(afterPath).byName.get("verify")!.run({
			args: { id: afterId },
			options: { strict: true },
			json: true,
		})) as unknown as { ok: boolean; error?: string; failures?: string[] };
		expect(after.ok).toBe(false);
		expect(after.error).toBe("verification_failed");
		expect(after.failures?.join(" ")).toMatch(/revoked/i);
		// It stays draft — a revoked credential is never promoted.
		const rec = bundle(afterPath).records.loadManifest().records.find((r) => r.id === afterId);
		expect(rec?.review?.state).not.toBe("verified");
	});

	it("import errors helpfully on a bad file", async () => {
		const file = path.join(dir, "bad.json");
		writeFileSync(file, "not a credential");
		const imp = bundle(path.join(dir, "wallet.json")).byName.get("import")!;
		const res = (await imp.run({ args: { file }, options: {}, json: true })) as unknown as {
			ok: boolean;
			error: string;
		};
		expect(res.ok).toBe(false);
		expect(res.error).toBe("invalid_credential");
	});

	it("SHARE only the chosen credentials — a signed presentation the other party can verify", async () => {
		// The sovereignty move: hold TWO credentials, share only ONE. The presentation is signed
		// by the citizen (holder) and carries ONLY the chosen credential; the other stays private.
		const idCred = await issueTestCredential(fixture, {
			type: ["VerifiableCredential", "Identidade"],
		});
		const salaryCred = await issueTestCredential(fixture, {
			type: ["VerifiableCredential", "ComprovanteRenda"],
		});
		const statePath = path.join(dir, "wallet.json");
		const b = bundle(statePath);
		const imp = b.byName.get("import")!;
		writeFileSync(path.join(dir, "id.json"), JSON.stringify(idCred));
		writeFileSync(path.join(dir, "salary.json"), JSON.stringify(salaryCred));
		const idId = (
			(await imp.run({
				args: { file: path.join(dir, "id.json") },
				options: {},
				json: true,
			})) as unknown as { id: string }
		).id;
		await imp.run({ args: { file: path.join(dir, "salary.json") }, options: {}, json: true });

		// SHARE only the identity credential — NOT the income one.
		const share = bundle(statePath).byName.get("share")!;
		const shareRes = (await share.run({
			args: { ids: idId },
			options: {},
			json: true,
		})) as unknown as {
			ok: boolean;
			count: number;
			presentation: {
				verifiableCredential: Array<{ type: string[] }>;
				holder: string;
				proof?: unknown;
			};
		};
		expect(shareRes.ok).toBe(true);
		expect(shareRes.count).toBe(1); // ONLY one credential in the presentation
		const vp = shareRes.presentation;
		expect(vp.verifiableCredential).toHaveLength(1);
		expect(vp.verifiableCredential[0]?.type).toContain("Identidade");
		// The income credential was NOT disclosed — privacy / minimization.
		expect(JSON.stringify(vp)).not.toContain("ComprovanteRenda");
		expect(vp.proof).toBeDefined(); // signed by the holder

		// The receiving party VERIFIES the presentation: credential genuine + holder signed it.
		const result = await fixture.provider.verify(vp as never);
		expect(result.valid).toBe(true);
		expect(result.checks.signature?.ok).toBe(true);
	});

	it("share errors helpfully on a non-credential id", async () => {
		const share = bundle(path.join(dir, "wallet.json")).byName.get("share")!;
		const res = (await share.run({
			args: { ids: "record:doc-identidade" }, // a plain doc, not a VC
			options: {},
			json: true,
		})) as unknown as { ok: boolean; error: string };
		expect(res.ok).toBe(false);
		expect(res.error).toBe("not_a_credential");
	});
});

describe("renderWalletHtml — rich credential cards (the web face)", () => {
	const NOW = Date.parse("2026-07-01T00:00:00.000Z");
	// An analyze-envelope shape with the fields the projection now carries.
	const env = {
		ok: true,
		by: "reviewState" as const,
		summary: { total: 3, byState: { verified: 1, draft: 1 } },
		groups: [
			{
				key: "verified",
				label: "verified",
				count: 2,
				records: [
					{
						id: "record:cred-a",
						title: "Carteira de Motorista",
						link: "a.md",
						reviewState: "verified",
						fields: {
							kind: "credencial",
							issuer: "did:gov:br",
							expirationDate: "2030-01-01T00:00:00.000Z",
						},
					},
					{
						id: "record:cred-exp",
						title: "Passaporte",
						link: "exp.md",
						reviewState: "verified",
						fields: {
							kind: "documento",
							issuer: "did:gov:br",
							expirationDate: "2020-01-01T00:00:00.000Z",
						},
					},
				],
			},
			{
				key: "draft",
				label: "draft",
				count: 1,
				records: [
					{
						id: "record:cred-b",
						title: "Comprovante",
						link: "b.md",
						reviewState: "draft",
						fields: { kind: "documento" },
					},
				],
			},
		],
	};

	it("shows issuer, validity and a status badge per credential card", () => {
		const html = renderWalletHtml(env, NOW);
		// A verified, non-expired credential → verified badge + issuer + validity.
		expect(html).toContain("✓ Verificado");
		expect(html).toContain("emitido por did:gov:br");
		expect(html).toContain("válido até 2030-01-01");
		// A draft credential → "a verificar" badge.
		expect(html).toContain("A verificar");
		// Each item is a card the citizen sees.
		expect(html).toContain("data-wallet-item");
		expect(html).toContain("Carteira de Motorista");
	});

	it("flags an EXPIRED credential (past expirationDate) as Expirado, not Verificado", () => {
		const html = renderWalletHtml(env, NOW);
		expect(html).toContain("Expirado"); // the Passaporte (2020) is past
		// the expired one is not shown as verified even though its review state is verified
		expect(html).toMatch(/Passaporte[\s\S]*?Expirado/);
	});

	it("escapes user-derived text in a card", () => {
		const nasty = {
			...env,
			groups: [
				{
					key: "draft",
					label: "draft",
					count: 1,
					records: [
						{
							id: "x",
							title: "<script>alert(1)</script>",
							link: "x.md",
							reviewState: "draft",
							fields: {},
						},
					],
				},
			],
		};
		const html = renderWalletHtml(nasty, NOW);
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;");
	});
});
