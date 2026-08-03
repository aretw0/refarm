import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CertificateRefusal, MAX_LEAF_LIFETIME_DAYS } from "@refarm.dev/certificate-contract-v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { redactPrivateKeys, type OpensslResult, type OpensslRunner } from "./openssl.js";
import { createLocalCaProvider, subjectCommonName } from "./provider.js";

const opensslAvailable = (() => {
	try {
		return spawnSync("openssl", ["version"], { stdio: "ignore" }).status === 0;
	} catch {
		return false;
	}
})();

const SUFFIXES = ["refarm-test.invalid"];

function throwawayDir(): string {
	return mkdtempSync(join(tmpdir(), "refarm-local-ca-"));
}

describe("a missing openssl refuses honestly — it does not crash", () => {
	const absent: OpensslRunner = async () => ({
		code: null,
		stdout: "",
		stderr: "",
		spawnError: "ENOENT",
	});

	it("preflight answers 'not ready' rather than throwing", async () => {
		const provider = createLocalCaProvider({
			dir: "/nonexistent/never-created",
			nameSuffixes: SUFFIXES,
			openssl: absent,
		});
		const readiness = await provider.preflight();
		expect(readiness.ready).toBe(false);
		if (readiness.ready) return;
		expect(readiness.reason).toBe("tool-missing");
		expect(readiness.detail).toContain("openssl is not on PATH");
		// It explains WHY Node cannot do this itself, so the refusal is not mistaken for a bug.
		expect(readiness.detail).toContain("parses one, it does not issue one");
	});

	it("the fix names the install command AND the escape hatch that needs no tool", async () => {
		const provider = createLocalCaProvider({
			dir: "/nonexistent/never-created",
			nameSuffixes: SUFFIXES,
			openssl: absent,
		});
		const readiness = await provider.preflight();
		if (readiness.ready) return expect.unreachable("openssl should read as absent");
		expect(readiness.fix).toContain("apt install openssl");
		expect(readiness.fix).toContain("certFile");
	});

	it("issue() refuses with the same reason, and writes nothing", async () => {
		const dir = throwawayDir();
		try {
			const provider = createLocalCaProvider({
				dir,
				nameSuffixes: SUFFIXES,
				openssl: absent,
			});
			let refusal: CertificateRefusal | null = null;
			try {
				await provider.issue({ names: ["a.refarm-test.invalid"], lifetimeDays: 7 });
			} catch (error) {
				refusal = error as CertificateRefusal;
			}
			expect(refusal).toBeInstanceOf(CertificateRefusal);
			expect(refusal?.reason).toBe("tool-missing");
			expect(() => statSync(join(dir, "ca.key"))).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("a present-but-broken openssl is also a refusal, not a crash", async () => {
		const broken: OpensslRunner = async () => ({
			code: 127,
			stdout: "",
			stderr: "boom",
			spawnError: null,
		});
		const provider = createLocalCaProvider({
			dir: "/nonexistent",
			nameSuffixes: SUFFIXES,
			openssl: broken,
		});
		const readiness = await provider.preflight();
		expect(readiness.ready).toBe(false);
	});
});

describe("redactPrivateKeys is the filter every diagnostic passes through", () => {
	it("removes a PEM private key block whatever its label", () => {
		for (const label of ["PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY"]) {
			const text = `before\n-----BEGIN ${label}-----\nMIIEvQIBADAN\nAAAA\n-----END ${label}-----\nafter`;
			const redacted = redactPrivateKeys(text);
			expect(redacted).toContain("[private key redacted]");
			expect(redacted).not.toContain("MIIEvQIBADAN");
			expect(redacted).toContain("before");
			expect(redacted).toContain("after");
		}
	});

	it("leaves text with no key alone", () => {
		expect(redactPrivateKeys("nothing secret here")).toBe("nothing secret here");
	});
});

describe("the CA's subject is built from a label openssl will accept", () => {
	it("strips the characters that would break a -subj argument", () => {
		expect(subjectCommonName("a/b=c\nd")).toBe("a b c d");
	});

	it("never yields an empty CN", () => {
		expect(subjectCommonName("///")).toBe("refarm");
	});

	it("stays inside X.509's 64-character limit", () => {
		expect(subjectCommonName("x".repeat(200))).toHaveLength(64);
	});
});

// THE BUDGET IS SIZED FOR A VARIABLE-COST OPERATION, not for the median.
//
// Every test below shells out to `openssl`, and one to three of those spawns are
// `genrsa 2048` — a PRIME SEARCH, whose duration is inherently non-deterministic. Measured
// on an idle machine, 20 consecutive runs spanned 49ms to 532ms: a 10.8x spread with no
// competing load at all. Under CI, where this job runs beside seven others contending for
// CPU, that tail stretches further.
//
// Vitest's 5000ms default is calibrated on the median of that distribution, so it passes
// locally (~95-355ms per test) and fails intermittently in CI — which is exactly what it
// did, at "the leaf key is 0600 too", in run 30808370996.
//
// A retry would have hidden the one thing the failure had to say. The budget is what was
// wrong, so the budget is what changes — and only HERE: the pure-function suites above run
// in 0-2ms and keep the tight default, where a slow test is real news.
describe.skipIf(!opensslAvailable)("issuing for real — the output parses, and is bounded", { timeout: 30_000 }, () => {
	let dir: string;
	let logged: string[];

	beforeEach(() => {
		dir = throwawayDir();
		logged = [];
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function provider(overrides: Partial<Parameters<typeof createLocalCaProvider>[0]> = {}) {
		return createLocalCaProvider({
			dir,
			nameSuffixes: SUFFIXES,
			caName: "refarm test",
			log: (line) => logged.push(line),
			...overrides,
		});
	}

	it("creates the CA once and reuses it — issuance is idempotent, which is what makes rotation ordinary", async () => {
		const p = provider();
		const first = await p.ensureCa();
		expect(first.created).toBe(true);
		const second = await p.ensureCa();
		expect(second.created).toBe(false);
		expect(second.fingerprint).toBe(first.fingerprint);
	});

	it("the CA certificate carries the name constraint, permitting exactly the declared suffix", async () => {
		const handle = await provider().ensureCa();
		const text = spawnSync("openssl", ["x509", "-in", handle.certFile, "-noout", "-text"], {
			encoding: "utf8",
		}).stdout;
		expect(text).toContain("X509v3 Name Constraints: critical");
		expect(text).toContain("DNS:refarm-test.invalid");
		expect(text).toContain("Permitted");
		expect(text).toContain("Excluded");
		expect(text).toContain("CA:TRUE");
	});

	it("the CA private key is 0600 and its directory 0700", async () => {
		const handle = await provider().ensureCa();
		expect(statSync(handle.keyFile).mode & 0o777).toBe(0o600);
		expect(statSync(dir).mode & 0o777).toBe(0o700);
	});

	it("issues a leaf that parses, chains to the CA, and names what was asked for", async () => {
		const material = await provider().issue({
			names: ["node.refarm-test.invalid", "alt.refarm-test.invalid"],
			lifetimeDays: 7,
		});
		expect(material.providerId).toBe("local-ca");
		const leaf = new X509Certificate(readFileSync(material.certFile));
		const ca = new X509Certificate(readFileSync(material.caFile as string));
		expect(leaf.verify(ca.publicKey)).toBe(true);
		expect(leaf.subjectAltName).toContain("DNS:node.refarm-test.invalid");
		expect(leaf.subjectAltName).toContain("DNS:alt.refarm-test.invalid");
		expect(leaf.ca).toBe(false);
		expect(material.names).toEqual(["node.refarm-test.invalid", "alt.refarm-test.invalid"]);
	});

	it("the leaf's lifetime is SHORT and is the lifetime that was asked for", async () => {
		const material = await provider().issue({
			names: ["short.refarm-test.invalid"],
			lifetimeDays: 7,
		});
		const start = Date.parse(material.notBefore as string);
		const end = Date.parse(material.notAfter as string);
		const days = (end - start) / 86_400_000;
		expect(days).toBeGreaterThan(6.9);
		expect(days).toBeLessThan(7.1);
		expect(days).toBeLessThanOrEqual(MAX_LEAF_LIFETIME_DAYS);
	});

	it("refuses a lifetime past the contract's ceiling, and issues nothing", async () => {
		await expect(
			provider().issue({
				names: ["long.refarm-test.invalid"],
				lifetimeDays: MAX_LEAF_LIFETIME_DAYS + 1,
			}),
		).rejects.toThrow(/ceiling/);
		expect(() => statSync(join(dir, "long.refarm-test.invalid.crt"))).toThrow();
	});

	it("refuses a name outside the constraint — refarm's own gate, not the trust store's", async () => {
		await expect(
			provider().issue({ names: ["evil.example.com"], lifetimeDays: 7 }),
		).rejects.toThrow(/outside this CA's name constraint/);
	});

	it("the leaf key is 0600 too", async () => {
		const material = await provider().issue({
			names: ["perm.refarm-test.invalid"],
			lifetimeDays: 7,
		});
		expect(statSync(material.keyFile).mode & 0o777).toBe(0o600);
	});

	it("THE CA PRIVATE KEY IS NEVER LOGGED, and never appears in what issue() returns", async () => {
		const material = await provider().issue({
			names: ["quiet.refarm-test.invalid"],
			lifetimeDays: 7,
		});
		const caKeyPem = readFileSync(join(dir, "ca.key"), "utf8");
		const leafKeyPem = readFileSync(material.keyFile, "utf8");
		// A distinctive chunk of each key's base64 body — long enough that a match cannot be chance.
		const chunks = [caKeyPem, leafKeyPem].map((pem) => {
			const body = pem
				.split("\n")
				.filter((line) => !line.startsWith("-----"))
				.join("");
			return body.slice(20, 80);
		});
		expect(chunks.every((chunk) => chunk.length >= 40)).toBe(true);

		const everythingEmitted = [...logged, JSON.stringify(material)].join("\n");
		expect(logged.length).toBeGreaterThan(0); // the sink really did receive something
		for (const chunk of chunks) {
			expect(everythingEmitted).not.toContain(chunk);
		}
		expect(everythingEmitted).not.toContain("PRIVATE KEY");
		// What it DOES emit is the path and the fingerprint — enough to act on, nothing to leak.
		expect(everythingEmitted).toContain(material.keyFile);
	});

	it("refuses to widen an existing CA's constraint in place", async () => {
		await provider().ensureCa();
		const widened = createLocalCaProvider({
			dir,
			nameSuffixes: ["refarm-test.invalid", "something-else.invalid"],
		});
		await expect(widened.ensureCa()).rejects.toThrow(/widening a CA's constraint in place/);
	});

	it("states its costs, including the loose end that cannot be revoked remotely", () => {
		const costs = provider().costs.join(" ");
		expect(costs).toMatch(/CANNOT be revoked remotely/);
		expect(costs).toMatch(/installed once on each device/);
	});
});

describe("an openssl that fails mid-way leaves nothing half-made", () => {
	it("removes the CA key when the CA certificate could not be created", async () => {
		const dir = throwawayDir();
		try {
			let call = 0;
			const flaky: OpensslRunner = async (args) => {
				call += 1;
				if (args[0] === "version") {
					return { code: 0, stdout: "OpenSSL 3.0.0", stderr: "", spawnError: null };
				}
				if (args[0] === "genrsa") {
					// Pretend the key was produced.
					const { writeFileSync } = await import("node:fs");
					writeFileSync(args[args.indexOf("-out") + 1] as string, "key\n");
					return { code: 0, stdout: "", stderr: "", spawnError: null };
				}
				return {
					code: 1,
					stdout: "",
					stderr: `refused on call ${call}`,
					spawnError: null,
				} satisfies OpensslResult;
			};
			const p = createLocalCaProvider({ dir, nameSuffixes: SUFFIXES, openssl: flaky });
			await expect(p.ensureCa()).rejects.toThrow(/openssl failed while creating the CA/);
			expect(() => statSync(join(dir, "ca.key"))).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
