import {
	createInMemoryCredentialsProviderFixture,
	type VerifiableCredential,
} from "@refarm.dev/credentials-contract-v1";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
	createWalletCapabilities,
	walletCapabilityBundle,
} from "./persona.js";
import { createWalletShareCapability } from "./credentials.js";
import { parsePresentationFile } from "./verifier.js";

const now = () => "2026-07-12T00:00:00.000Z";

/** Issue a credential ABOUT a given subject (so holder-binding holds when that subject presents
 * it). Defaults to a fresh subject when none is given. */
async function issueTestCredential(
	fixture: ReturnType<typeof createInMemoryCredentialsProviderFixture>,
	overrides: Partial<VerifiableCredential> = {},
	subjectId?: string,
): Promise<VerifiableCredential> {
	const issuer = await fixture.identity.create("Synthetic civic issuer");
	const subject = subjectId ?? (await fixture.identity.create("Synthetic holder")).id;
	const unsigned: VerifiableCredential = {
		"@context": ["https://www.w3.org/2018/credentials/v1"],
		type: ["VerifiableCredential", "CarteiraDigital"],
		issuer: issuer.id,
		issuanceDate: "2026-01-01T00:00:00.000Z",
		credentialSubject: { id: subject, name: "Fulano de Tal" },
		...overrides,
	};
	return fixture.provider.issue(unsigned, issuer.id);
}

describe("verify-presentation — the receiving service validates what the citizen shared", () => {
	let fixture: ReturnType<typeof createInMemoryCredentialsProviderFixture>;
	let dir: string;

	beforeEach(() => {
		fixture = createInMemoryCredentialsProviderFixture();
		dir = mkdtempSync(path.join(os.tmpdir(), "wallet-verifier-"));
	});

	function bundle(statePath: string) {
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
		return { records: b.records, byName: new Map(verbs.map((v) => [v.name, v])) };
	}

	it("parsePresentationFile accepts a bare VP and share's wrapped envelope", async () => {
		const vc = await issueTestCredential(fixture);
		const holder = await fixture.identity.create("Cidadão");
		const vp = await fixture.provider.present([vc], holder.id);
		// Bare VP.
		expect(parsePresentationFile(JSON.stringify(vp)).holder).toBe(holder.id);
		// The `{ presentation }` envelope `share` prints.
		expect(parsePresentationFile(JSON.stringify({ presentation: vp })).holder).toBe(holder.id);
		// Non-VP is rejected.
		expect(() => parsePresentationFile('{"foo":1}')).toThrow(/INVALID_PRESENTATION/);
	});

	it("the full loop: citizen SHARES → the service ACCEPTS the presentation", async () => {
		// The citizen's own holder identity — the credential is ABOUT them, and they present AS
		// them, so holder-binding (subject == presenter) holds, as it must for a real presentation.
		const citizen = await fixture.identity.create("Cidadão");
		const idCred = await issueTestCredential(
			fixture,
			{ type: ["VerifiableCredential", "Identidade"] },
			citizen.id,
		);
		const statePath = path.join(dir, "wallet.json");
		const b = bundle(statePath);
		const file = path.join(dir, "id.json");
		writeFileSync(file, JSON.stringify(idCred));
		const id = ((await b.byName.get("import")!.run({ args: { file }, options: {}, json: true })) as unknown as { id: string }).id;

		// Citizen shares AS themselves — produces a signed presentation bound to them.
		const share = createWalletShareCapability(b.records, fixture.provider, fixture.identity, {
			holderIdentityId: citizen.id,
		});
		const shareRes = (await share.run({
			args: { ids: id },
			options: {},
			json: true,
		})) as unknown as { ok: boolean; presentation: unknown };
		expect(shareRes.ok).toBe(true);

		// The receiving service writes the shared presentation to a file and validates it.
		const vpFile = path.join(dir, "presented.json");
		writeFileSync(vpFile, JSON.stringify(shareRes.presentation));
		const res = (await bundle(statePath).byName.get("verify-presentation")!.run({
			args: { file: vpFile },
			options: {},
			json: true,
		})) as unknown as {
			ok: boolean;
			valid: boolean;
			holder: string;
			accepted: { type: string; issuer: string }[];
			checks: { holderBound?: { ok: boolean } };
		};
		expect(res.ok).toBe(true);
		expect(res.valid).toBe(true);
		// Holder-binding was checked (the essence of a presentation).
		expect(res.checks.holderBound?.ok).toBe(true);
		// The service sees exactly what was disclosed — the identity credential, nothing else.
		expect(res.accepted).toHaveLength(1);
		expect(res.accepted[0]?.type).toBe("Identidade");
	});

	it("the service REJECTS a tampered presentation", async () => {
		const vc = await issueTestCredential(fixture);
		const holder = await fixture.identity.create("Cidadão");
		const vp = await fixture.provider.present([vc], holder.id);
		// Tamper: swap the holder after signing → holder no longer matches the signature.
		const other = await fixture.identity.create("Impostor");
		const tampered = { ...vp, holder: other.id };
		const vpFile = path.join(dir, "tampered.json");
		writeFileSync(vpFile, JSON.stringify(tampered));

		const res = (await bundle(path.join(dir, "wallet.json")).byName.get("verify-presentation")!.run({
			args: { file: vpFile },
			options: {},
			json: true,
		})) as unknown as { ok: boolean; error?: string; valid?: boolean };
		expect(res.ok).toBe(false);
		expect(res.error).toBe("presentation_rejected");
		expect(res.valid).toBe(false);
	});
});
