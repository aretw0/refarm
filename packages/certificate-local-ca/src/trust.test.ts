import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createFileOperationTrail,
	createMemoryOperationTrail,
	renderOperationRequest,
	runOperationConsent,
	standingDecision,
	undoOperationRecord,
	type OperationConsentChannel,
} from "@refarm.dev/operation-consent-v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCaTrustRequest, describeCaGrant, linuxCaAnchorPath } from "./trust.js";

const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n";
const FINGERPRINT = "AA:BB:CC:DD";

function answering(answer: string): OperationConsentChannel & { asked: unknown[] } {
	const asked: unknown[] = [];
	return {
		asked,
		async ask(prompt) {
			asked.push(prompt);
			return answer;
		},
	};
}

function requestFor(anchorPath: string, overrides: Record<string, unknown> = {}) {
	return buildCaTrustRequest({
		caName: "refarm",
		caPem: CA_PEM,
		fingerprint: FINGERPRINT,
		nameSuffixes: ["example.ts.net"],
		device: "este notebook",
		anchorPath,
		requester: "refarm cert trust",
		requestedAt: "2026-07-31T12:00:00.000Z",
		...overrides,
	});
}

describe("the anchor path is the Linux answer, offered rather than imposed", () => {
	it("slugs the CA name and uses .crt, which is what update-ca-certificates picks up", () => {
		expect(linuxCaAnchorPath("Refarm Local CA")).toBe(
			"/usr/local/share/ca-certificates/refarm-local-ca.crt",
		);
	});

	it("honours a caller-supplied anchor dir", () => {
		expect(linuxCaAnchorPath("refarm", "/tmp/anchors/")).toBe("/tmp/anchors/refarm.crt");
	});
});

describe("the grant is stated plainly, and says the things that are easy to leave out", () => {
	const grant = describeCaGrant({
		caName: "refarm",
		fingerprint: FINGERPRINT,
		nameSuffixes: ["example.ts.net"],
		device: "o celular",
	}).join("\n");

	it("says WHAT the CA can do — any name under the constraint, not just this page", () => {
		expect(grant).toMatch(/QUALQUER\s+certificado/);
		expect(grant).toContain("example.ts.net");
		expect(grant).toMatch(/não é só esta página/i);
	});

	it("says WHICH DEVICE is affected, and that others are not", () => {
		expect(grant).toContain("o celular");
		expect(grant).toMatch(/nenhum outro\s+dispositivo/);
	});

	it("says HOW TO UNDO IT, and that it cannot be revoked remotely", () => {
		expect(grant).toMatch(/NÃO\s+pode ser revogada remotamente/);
		expect(grant).toMatch(/configurações daquele\s+dispositivo/);
	});

	it("is honest that nameConstraints enforcement varies by platform", () => {
		expect(grant).toMatch(/não avaliam essa restrição/);
		expect(grant).toMatch(/redução de risco, não uma garantia/);
	});

	it("says the private key is NOT what is being installed", () => {
		expect(grant).toMatch(/só o certificado público é instalado/);
		expect(grant).toContain("0600");
	});

	it("shows the fingerprint to compare before accepting", () => {
		expect(grant).toContain(FINGERPRINT);
	});

	it("names the manual step when the device has no refresh command", () => {
		const manual = describeCaGrant({
			caName: "refarm",
			fingerprint: FINGERPRINT,
			nameSuffixes: ["example.ts.net"],
			device: "o celular",
			refreshCommand: null,
		}).join("\n");
		expect(manual).toMatch(/NÃO HÁ COMANDO/);
	});
});

describe("the request is a diff, and it is the SAME question every time it is asked", () => {
	it("keys on the device and the fingerprint, not on a clock", () => {
		const a = requestFor("/anchors/refarm.crt");
		const b = requestFor("/anchors/refarm.crt", { requestedAt: "2027-01-01T00:00:00.000Z" });
		expect(a.id).toBe(b.id);
		expect(a.id).toBe(`ca-trust:este notebook:${FINGERPRINT}`);
	});

	it("a DIFFERENT CA is a different question — trusting a new authority is a new grant", () => {
		expect(requestFor("/a.crt", { fingerprint: "ZZ" }).id).not.toBe(requestFor("/a.crt").id);
	});

	it("proposes writing the CA's PUBLIC certificate, and shows the file as it is now", () => {
		const request = requestFor("/anchors/refarm.crt");
		expect(request.changes).toHaveLength(1);
		expect(request.changes[0]?.after).toBe(CA_PEM);
		expect(request.changes[0]?.before).toBeNull();
		expect(request.changes[0]?.path).toBe("/anchors/refarm.crt");
	});

	it("the undo is executable and names the refresh command", () => {
		const request = requestFor("/anchors/refarm.crt");
		expect(request.undo.kind).toBe("restore-snapshot");
		expect(request.undo.kind === "restore-snapshot" && request.undo.summary).toMatch(
			/update-ca-certificates --fresh/,
		);
		expect(request.undo.kind === "restore-snapshot" && request.undo.summary).toMatch(
			/não existe revogação remota/,
		);
	});

	it("renders the grant to the operator BEFORE the decision", () => {
		const rendered = renderOperationRequest(requestFor("/anchors/refarm.crt")).join("\n");
		expect(rendered).toMatch(/O QUE ISTO PERMITE/);
		expect(rendered).toContain(FINGERPRINT);
		expect(rendered).toMatch(/NÃO\s+pode ser revogada remotamente/);
	});
});

describe("the consent journey, driven end to end against a throwaway anchor dir", () => {
	let dir: string;
	let anchorPath: string;
	let trailPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "refarm-ca-trust-"));
		anchorPath = join(dir, "refarm.crt");
		trailPath = join(dir, "operations.json");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("declining writes NOTHING and records the refusal, so it is not re-asked", async () => {
		const trail = createFileOperationTrail(trailPath);
		const outcome = await runOperationConsent({
			request: requestFor(anchorPath),
			trail,
			channel: answering("decline"),
			now: () => "2026-07-31T12:00:01.000Z",
		});
		expect(outcome.status).toBe("declined");
		expect(existsSync(anchorPath)).toBe(false);

		const again = await runOperationConsent({
			request: requestFor(anchorPath),
			trail,
			channel: answering("authorize"),
		});
		expect(again.status).toBe("already-decided");
		expect(existsSync(anchorPath)).toBe(false);
	});

	it("with no operator to ask, nothing is written and nothing is recorded", async () => {
		const trail = createMemoryOperationTrail();
		const outcome = await runOperationConsent({
			request: requestFor(anchorPath),
			trail,
			channel: null,
		});
		expect(outcome.status).toBe("no-operator");
		expect(existsSync(anchorPath)).toBe(false);
		expect(await trail.read()).toEqual([]);
	});

	it("authorizing installs the anchor, announces the grant, and remembers the undo", async () => {
		const trail = createFileOperationTrail(trailPath);
		const announced: string[] = [];
		const outcome = await runOperationConsent({
			request: requestFor(anchorPath),
			trail,
			channel: answering("authorize"),
			now: () => "2026-07-31T12:00:02.000Z",
			decidedBy: "operator",
			announce: (line) => announced.push(line),
		});
		expect(outcome.status).toBe("authorized");
		expect(readFileSync(anchorPath, "utf8")).toBe(CA_PEM);
		expect(announced.join("\n")).toMatch(/O QUE ISTO PERMITE/);
		expect(outcome.record?.undo.kind).toBe("restore-snapshot");
	});

	it("AND THE UNDO ACTUALLY UNDOES IT — applied here, not described", async () => {
		const trail = createFileOperationTrail(trailPath);
		const authorized = await runOperationConsent({
			request: requestFor(anchorPath),
			trail,
			channel: answering("authorize"),
			now: () => "2026-07-31T12:00:02.000Z",
		});
		expect(existsSync(anchorPath)).toBe(true);
		if (authorized.record === null) return expect.unreachable("should have recorded");

		const undone = await undoOperationRecord({
			record: authorized.record,
			trail,
			now: () => "2026-07-31T12:30:00.000Z",
		});

		expect(existsSync(anchorPath)).toBe(false);
		expect(undone.decision).toBe("undone");
		expect(undone.revisitOf).toBe(authorized.record.id);

		// The trail stays append-only: the grant is still visible, followed by its reversal.
		const records = await trail.read();
		expect(records.map((r) => r.decision)).toEqual(["authorized", "undone"]);
		expect(standingDecision(records, authorized.record.requestId)?.decision).toBe("undone");
	});

	it("re-trusting after an undo restores exactly the anchor that was there", async () => {
		const trail = createFileOperationTrail(trailPath);
		const first = await runOperationConsent({
			request: requestFor(anchorPath),
			trail,
			channel: answering("authorize"),
			now: () => "2026-07-31T12:00:02.000Z",
		});
		if (first.record === null) return expect.unreachable("should have recorded");
		await undoOperationRecord({
			record: first.record,
			trail,
			now: () => "2026-07-31T12:30:00.000Z",
		});

		const again = await runOperationConsent({
			request: requestFor(anchorPath),
			trail,
			channel: answering("authorize"),
			now: () => "2026-07-31T13:00:00.000Z",
			revisit: true,
		});
		expect(again.status).toBe("authorized");
		expect(readFileSync(anchorPath, "utf8")).toBe(CA_PEM);
	});
});
