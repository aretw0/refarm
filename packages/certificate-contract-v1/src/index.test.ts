import { describe, expect, it } from "vitest";

import {
	assertShortLeafLifetime,
	CertificateRefusal,
	createCertificateProviderRegistry,
	DEFAULT_LEAF_LIFETIME_DAYS,
	MAX_LEAF_LIFETIME_DAYS,
	needsRotation,
	parseCertificateDeclaration,
	resolveCertificate,
	type CertificateIssueRequest,
	type CertificateMaterial,
	type CertificateProvider,
} from "./index.js";

function fakeProvider(
	id: string,
	overrides: Partial<CertificateProvider> = {},
): CertificateProvider {
	const seen: CertificateIssueRequest[] = [];
	const provider: CertificateProvider = {
		id,
		title: `the ${id} provider`,
		requires: [],
		costs: [],
		async preflight() {
			return { ready: true, detail: "ok" };
		},
		async issue(request) {
			seen.push(request);
			return {
				certFile: `/tmp/${id}/leaf.crt`,
				keyFile: `/tmp/${id}/leaf.key`,
				caFile: `/tmp/${id}/ca.crt`,
				names: [...request.names],
				notBefore: "2026-07-31T00:00:00.000Z",
				notAfter: "2026-08-30T00:00:00.000Z",
				providerId: id,
			} satisfies CertificateMaterial;
		},
		...overrides,
	};
	(provider as CertificateProvider & { seen: CertificateIssueRequest[] }).seen = seen;
	return provider;
}

const nothingExists = async () => false;
const everythingExists = async () => true;

describe("the leaf lifetime is the contract's business", () => {
	it("accepts a short lifetime and returns it", () => {
		expect(assertShortLeafLifetime(1)).toBe(1);
		expect(assertShortLeafLifetime(DEFAULT_LEAF_LIFETIME_DAYS)).toBe(DEFAULT_LEAF_LIFETIME_DAYS);
		expect(assertShortLeafLifetime(MAX_LEAF_LIFETIME_DAYS)).toBe(MAX_LEAF_LIFETIME_DAYS);
	});

	it("refuses a lifetime past the ceiling, naming the ceiling and the fix", () => {
		let refusal: CertificateRefusal | null = null;
		try {
			assertShortLeafLifetime(MAX_LEAF_LIFETIME_DAYS + 1);
		} catch (error) {
			refusal = error as CertificateRefusal;
		}
		expect(refusal).toBeInstanceOf(CertificateRefusal);
		expect(refusal?.reason).toBe("lifetime-refused");
		expect(refusal?.message).toContain(String(MAX_LEAF_LIFETIME_DAYS));
		expect(refusal?.fix).toContain(String(MAX_LEAF_LIFETIME_DAYS));
	});

	it("refuses a non-integer or non-positive lifetime", () => {
		expect(() => assertShortLeafLifetime(0)).toThrow(CertificateRefusal);
		expect(() => assertShortLeafLifetime(-1)).toThrow(CertificateRefusal);
		expect(() => assertShortLeafLifetime(30.5)).toThrow(CertificateRefusal);
	});

	it("the ceiling is enforced through a declaration too, not only at the call site", () => {
		expect(() =>
			parseCertificateDeclaration({ provider: "local-ca", names: ["a"], lifetimeDays: 365 }),
		).toThrow(/ceiling/);
	});
});

describe("rotation is a first-class question, answered from the certificate itself", () => {
	const material: CertificateMaterial = {
		certFile: "/c",
		keyFile: "/k",
		caFile: null,
		names: ["node"],
		notBefore: "2026-01-01T00:00:00.000Z",
		notAfter: "2026-01-31T00:00:00.000Z",
		providerId: "local-ca",
	};

	it("is false early in the life and true in the last third", () => {
		expect(needsRotation(material, new Date("2026-01-02T00:00:00Z"))).toBe(false);
		expect(needsRotation(material, new Date("2026-01-15T00:00:00Z"))).toBe(false);
		expect(needsRotation(material, new Date("2026-01-25T00:00:00Z"))).toBe(true);
		expect(needsRotation(material, new Date("2026-02-05T00:00:00Z"))).toBe(true);
	});

	it("unknown validity reads as 'cannot tell', not as 'rotate now'", () => {
		expect(needsRotation({ ...material, notAfter: null }, new Date("2030-01-01Z"))).toBe(false);
		expect(needsRotation({ ...material, notBefore: "nonsense" }, new Date("2030-01-01Z"))).toBe(
			false,
		);
	});
});

describe("parsing a declaration is fail-shut", () => {
	it("reads an existing certificate the operator already has", () => {
		expect(parseCertificateDeclaration({ certFile: "/a.crt", keyFile: "/a.key" })).toEqual({
			kind: "declared",
			certFile: "/a.crt",
			keyFile: "/a.key",
		});
	});

	it("carries an optional caFile through", () => {
		expect(
			parseCertificateDeclaration({ certFile: "/a.crt", keyFile: "/a.key", caFile: "/ca.crt" }),
		).toEqual({ kind: "declared", certFile: "/a.crt", keyFile: "/a.key", caFile: "/ca.crt" });
	});

	it("reads a provider declaration with its names", () => {
		expect(
			parseCertificateDeclaration({ provider: "local-ca", names: ["node", "node.ts.net"] }),
		).toEqual({ kind: "provider", provider: "local-ca", names: ["node", "node.ts.net"] });
	});

	it("refuses a declaration that names BOTH a provider and files, rather than guessing", () => {
		expect(() =>
			parseCertificateDeclaration({ provider: "local-ca", certFile: "/a", keyFile: "/b" }),
		).toThrow(/only one of them can be the source/);
	});

	it("refuses half a pair — a certificate is a pair", () => {
		expect(() => parseCertificateDeclaration({ certFile: "/a.crt" })).toThrow(/PAIR/);
		expect(() => parseCertificateDeclaration({ keyFile: "/a.key" })).toThrow(/PAIR/);
	});

	it("refuses a provider with no names", () => {
		expect(() => parseCertificateDeclaration({ provider: "local-ca" })).toThrow(/names/);
		expect(() => parseCertificateDeclaration({ provider: "local-ca", names: [] })).toThrow(/names/);
	});

	it("refuses silence dressed as a declaration", () => {
		expect(() => parseCertificateDeclaration({})).toThrow(/neither a provider nor/);
		expect(() => parseCertificateDeclaration(null)).toThrow(/must be an object/);
		expect(() => parseCertificateDeclaration([])).toThrow(/must be an object/);
	});

	it("every refusal carries an actionable fix, never only a complaint", () => {
		for (const raw of [null, {}, { certFile: "/a" }, { provider: "x" }]) {
			try {
				parseCertificateDeclaration(raw);
				expect.unreachable("should have refused");
			} catch (error) {
				expect(error).toBeInstanceOf(CertificateRefusal);
				expect((error as CertificateRefusal).fix.length).toBeGreaterThan(10);
			}
		}
	});
});

describe("the registry admits providers, and refuses a duplicate id", () => {
	it("lists ids in a stable order", () => {
		const registry = createCertificateProviderRegistry([
			fakeProvider("tailscale-cert"),
			fakeProvider("local-ca"),
		]);
		expect(registry.ids()).toEqual(["local-ca", "tailscale-cert"]);
		expect(registry.list().map((p) => p.id)).toEqual(["local-ca", "tailscale-cert"]);
	});

	it("refuses two providers under one id — an operator writing that id must get ONE answer", () => {
		const registry = createCertificateProviderRegistry([fakeProvider("local-ca")]);
		expect(() => registry.register(fakeProvider("local-ca"))).toThrow(/already registered/);
	});

	it("get() of an unregistered id is null, not a throw", () => {
		expect(createCertificateProviderRegistry().get("nope")).toBeNull();
	});
});

describe("resolution — the declared certificate is the case that proves the seam", () => {
	it("resolves an existing pair against an EMPTY registry, consulting no provider at all", async () => {
		const material = await resolveCertificate({
			declaration: { kind: "declared", certFile: "/a.crt", keyFile: "/a.key" },
			registry: createCertificateProviderRegistry(),
			exists: everythingExists,
		});
		expect(material.certFile).toBe("/a.crt");
		expect(material.keyFile).toBe("/a.key");
		expect(material.providerId).toBeNull();
	});

	it("resolves an existing pair with NO registry passed at all", async () => {
		const material = await resolveCertificate({
			declaration: { kind: "declared", certFile: "/a.crt", keyFile: "/a.key", caFile: "/ca.crt" },
			exists: everythingExists,
		});
		expect(material.caFile).toBe("/ca.crt");
		expect(material.providerId).toBeNull();
	});

	it("refuses a declared file that is not there, naming the path", async () => {
		await expect(
			resolveCertificate({
				declaration: { kind: "declared", certFile: "/gone.crt", keyFile: "/gone.key" },
				exists: nothingExists,
			}),
		).rejects.toThrow(/\/gone\.crt/);
	});

	it("issues through a named provider, at the default lifetime", async () => {
		const provider = fakeProvider("local-ca");
		const registry = createCertificateProviderRegistry([provider]);
		const material = await resolveCertificate({
			declaration: { kind: "provider", provider: "local-ca", names: ["node"] },
			registry,
			exists: nothingExists,
		});
		expect(material.providerId).toBe("local-ca");
		const seen = (provider as CertificateProvider & { seen: CertificateIssueRequest[] }).seen;
		expect(seen).toEqual([{ names: ["node"], lifetimeDays: DEFAULT_LEAF_LIFETIME_DAYS }]);
	});

	it("names the registered providers when the declared one is unknown", async () => {
		const registry = createCertificateProviderRegistry([fakeProvider("local-ca")]);
		await expect(
			resolveCertificate({
				declaration: { kind: "provider", provider: "letsencrypt", names: ["node"] },
				registry,
				exists: nothingExists,
			}),
		).rejects.toThrow(/Registered providers: local-ca/);
	});

	it("turns a provider that is not ready into a refusal that carries its fix", async () => {
		const registry = createCertificateProviderRegistry([
			fakeProvider("local-ca", {
				async preflight() {
					return {
						ready: false,
						reason: "tool-missing",
						detail: "openssl is not on PATH",
						fix: "sudo apt install openssl",
					};
				},
			}),
		]);
		let refusal: CertificateRefusal | null = null;
		try {
			await resolveCertificate({
				declaration: { kind: "provider", provider: "local-ca", names: ["node"] },
				registry,
				exists: nothingExists,
			});
		} catch (error) {
			refusal = error as CertificateRefusal;
		}
		expect(refusal?.reason).toBe("tool-missing");
		expect(refusal?.fix).toBe("sudo apt install openssl");
	});
});
