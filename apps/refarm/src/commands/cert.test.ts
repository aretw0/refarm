import { X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	createCertificateProviderRegistry,
	MAX_LEAF_LIFETIME_DAYS,
} from "@refarm.dev/certificate-contract-v1";
import {
	createProcessHandoffSpecFromRunner,
	runProcessHandoffSync,
} from "@refarm.dev/cli/process-handoff";
import {
	createMemoryOperationTrail,
	undoOperationRecord,
	type OperationConsentChannel,
	type OperationTrail,
} from "@refarm.dev/operation-consent-v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildCertificateRegistry,
	defaultNameSuffixes,
	resolveCertTrailPath,
	resolveTlsDir,
	runCertIssue,
	runCertProviders,
	runCertTrust,
} from "./cert.js";

/** openssl through the app's sanctioned process seam — `node:child_process` is barred from this
 *  source tree by `test/architecture/process-boundary.test.ts`, tests included. */
const opensslAvailable = (() => {
	try {
		return (
			runProcessHandoffSync(createProcessHandoffSpecFromRunner("openssl", ["version"]), {
				capture: true,
			}).exitCode === 0
		);
	} catch {
		return false;
	}
})();

const HOST = "refarm-cert-test";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), "refarm-cert-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function answering(answer: string): OperationConsentChannel {
	return {
		async ask() {
			return answer;
		},
	};
}

describe("where things live is derived, never guessed", () => {
	it("keeps the CA under the sovereign root's .refarm/tls", () => {
		expect(resolveTlsDir("/srv/farm")).toBe("/srv/farm/.refarm/tls");
		expect(resolveCertTrailPath("/srv/farm")).toBe("/srv/farm/.refarm/tls/operations.json");
	});

	it("defaults the CA's constraint to this node's own hostname, and invents nothing wider", () => {
		expect(defaultNameSuffixes("Serpro-1577853")).toEqual(["serpro-1577853"]);
		expect(defaultNameSuffixes("  ")).toEqual([]);
	});
});

describe("`refarm cert providers` — the choice is the operator's, so the costs are printed", () => {
	it("reports local-ca with what it needs and what it costs", async () => {
		const report = await runCertProviders({ root: dir, hostname: HOST });
		const local = report.providers.find((entry) => entry.id === "local-ca");
		expect(local).toBeDefined();
		expect(local?.requires.join(" ")).toMatch(/openssl/);
		expect(local?.costs.join(" ")).toMatch(/CANNOT be revoked remotely/);
		expect(local?.costs.join(" ")).toMatch(/no external exposure/);
	});

	it("says out loud that a certificate you already have needs no provider", async () => {
		const report = await runCertProviders({ root: dir, hostname: HOST });
		expect(report.declaredCertificateIsAlwaysAvailable).toBe(true);
	});

	it("exposes the JSON handoff fields every command in this repo exposes", async () => {
		const report = await runCertProviders({ root: dir, hostname: HOST });
		expect(report.ok).toBe(true);
		expect(report.nextCommand).toBeTruthy();
		expect(Array.isArray(report.nextCommands)).toBe(true);
	});

	it("an empty registry reports no providers rather than failing", async () => {
		const report = await runCertProviders({
			root: dir,
			hostname: HOST,
			registry: createCertificateProviderRegistry(),
		});
		expect(report.providers).toEqual([]);
		expect(report.ok).toBe(true);
	});
});

describe("`refarm cert issue` — T2's third case runs no provider at all", () => {
	it("accepts a certificate the operator already has, against an EMPTY registry", async () => {
		const certFile = path.join(dir, "mine.crt");
		const keyFile = path.join(dir, "mine.key");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(certFile, "cert");
		writeFileSync(keyFile, "key");

		const result = await runCertIssue(
			{ certFile, keyFile },
			{ root: dir, hostname: HOST, registry: createCertificateProviderRegistry() },
		);
		expect(result.certificate.providerId).toBeNull();
		expect(result.certificate.certFile).toBe(certFile);
		expect(result.serveCommand).toContain(`--tls-cert ${certFile}`);
		// Nothing was generated: the directory holds exactly the two files the operator put there.
		expect(existsSync(path.join(dir, "ca.crt"))).toBe(false);
	});

	it("refuses half a pair", async () => {
		await expect(
			runCertIssue({ certFile: path.join(dir, "a.crt") }, { root: dir, hostname: HOST }),
		).rejects.toThrow(/go together/);
	});

	it("refuses a certificate that is declared but not there, naming the path", async () => {
		await expect(
			runCertIssue(
				{ certFile: path.join(dir, "gone.crt"), keyFile: path.join(dir, "gone.key") },
				{ root: dir, hostname: HOST, registry: createCertificateProviderRegistry() },
			),
		).rejects.toThrow(/gone\.crt/);
	});
});

describe.skipIf(!opensslAvailable)("`refarm cert issue` — the canonical path", () => {
	it("issues from the node's own CA, for its own name, with a short lifetime", async () => {
		const result = await runCertIssue(
			{ dir, days: 7 },
			{ root: dir, hostname: HOST, say: () => {} },
		);
		expect(result.certificate.providerId).toBe("local-ca");
		expect(result.certificate.names).toEqual([HOST]);
		expect(result.caFile).toBe(path.join(dir, "ca.crt"));

		const leaf = new X509Certificate(readFileSync(result.certificate.certFile));
		const days =
			(Date.parse(result.certificate.notAfter as string) -
				Date.parse(result.certificate.notBefore as string)) /
			86_400_000;
		expect(days).toBeLessThanOrEqual(MAX_LEAF_LIFETIME_DAYS);
		expect(leaf.subjectAltName).toContain(`DNS:${HOST}`);
	});

	it("hands the operator the exact command that serves it beside the plain listener", async () => {
		const result = await runCertIssue({ dir, days: 7 }, { root: dir, hostname: HOST });
		expect(result.serveCommand).toMatch(/refarm web serve .* --tls-cert .* --tls-key /);
		expect(result.nextCommands).toContain("refarm cert trust --json");
	});

	it("re-issuing reuses the same CA — rotation is running the command again", async () => {
		const first = await runCertIssue({ dir, days: 7 }, { root: dir, hostname: HOST });
		const second = await runCertIssue({ dir, days: 7 }, { root: dir, hostname: HOST });
		const a = new X509Certificate(readFileSync(first.caFile as string));
		const b = new X509Certificate(readFileSync(second.caFile as string));
		expect(a.fingerprint256).toBe(b.fingerprint256);
	});
});

describe.skipIf(!opensslAvailable)("`refarm cert trust` — the grant goes through consent", () => {
	let trail: OperationTrail;
	let anchor: string;

	beforeEach(() => {
		trail = createMemoryOperationTrail();
		anchor = path.join(dir, "anchors", "refarm.crt");
	});

	function deps(channel: OperationConsentChannel | null) {
		return {
			root: dir,
			hostname: HOST,
			trail,
			operator: channel,
			now: () => "2026-07-31T12:00:00.000Z",
			say: () => {},
		};
	}

	it("shows the grant — what the CA can do, which device, and how to undo it", async () => {
		const result = await runCertTrust({ dir, anchor }, deps(answering("later")));
		if (result.status === "manual") return expect.unreachable("this host is not manual");
		const grant = result.grant.join("\n");
		expect(grant).toMatch(/QUALQUER\s+certificado/);
		expect(grant).toContain(HOST);
		expect(grant).toMatch(/NÃO\s+pode ser revogada remotamente/);
		expect(grant).toMatch(/redução de risco, não uma garantia/);
		expect(result.fingerprint).toMatch(/^[0-9A-F:]+$/);
	});

	it("'agora não' changes nothing and records nothing", async () => {
		const result = await runCertTrust({ dir, anchor }, deps(answering("later")));
		expect(result.status).toBe("deferred");
		expect(existsSync(anchor)).toBe(false);
		expect(await trail.read()).toEqual([]);
	});

	it("with no operator to ask, nothing is written", async () => {
		const result = await runCertTrust({ dir, anchor }, deps(null));
		expect(result.status).toBe("no-operator");
		expect(existsSync(anchor)).toBe(false);
	});

	it("authorizing installs the anchor — and the undo removes it again", async () => {
		const result = await runCertTrust({ dir, anchor }, deps(answering("authorize")));
		if (result.status === "manual") return expect.unreachable("this host is not manual");
		expect(result.status).toBe("authorized");
		expect(readFileSync(anchor, "utf8")).toContain("BEGIN CERTIFICATE");
		expect(result.nextCommand).toBe("sudo update-ca-certificates");

		const records = await trail.read();
		const authorized = records[0];
		expect(authorized).toBeDefined();
		await undoOperationRecord({
			record: authorized as NonNullable<typeof authorized>,
			trail,
			now: () => "2026-07-31T13:00:00.000Z",
		});
		expect(existsSync(anchor)).toBe(false);
		expect((await trail.read()).map((r) => r.decision)).toEqual(["authorized", "undone"]);
	});

	it("declining is remembered, so the same question is not asked again", async () => {
		expect((await runCertTrust({ dir, anchor }, deps(answering("decline")))).status).toBe(
			"declined",
		);
		expect((await runCertTrust({ dir, anchor }, deps(answering("authorize")))).status).toBe(
			"already-decided",
		);
		expect(existsSync(anchor)).toBe(false);
	});

	it("another device is answered honestly — refarm does not pretend to reach its trust store", async () => {
		const result = await runCertTrust({ dir, device: "o celular" }, deps(answering("authorize")));
		expect(result.status).toBe("manual");
		if (result.status !== "manual") return;
		expect(result.steps.join("\n")).toMatch(/chave privada não sai daqui/);
		expect(result.steps.join("\n")).toContain(result.fingerprint);
		expect(result.grant.join("\n")).toMatch(/NÃO HÁ COMANDO/);
	});
});

describe("the registry is built once, and a second provider would be one line", () => {
	it("holds local-ca and nothing it was not given", () => {
		const { registry, localCa } = buildCertificateRegistry({
			dir,
			nameSuffixes: [HOST],
		});
		expect(registry.ids()).toEqual(["local-ca"]);
		expect(localCa.caCertFile).toBe(path.join(dir, "ca.crt"));
		expect(localCa.nameSuffixes).toEqual([HOST]);
	});
});
