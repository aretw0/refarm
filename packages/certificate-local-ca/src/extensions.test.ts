import { describe, expect, it } from "vitest";

import {
	assertNamesUnderSuffixes,
	caConfigFile,
	caExtensions,
	certificateFileStem,
	leafConfigFile,
	leafExtensions,
	nameIsUnderSuffixes,
	normalizeNameSuffixes,
} from "./extensions.js";

describe("name suffixes are normalised into something deterministic", () => {
	it("lowercases, trims dots, deduplicates and sorts", () => {
		expect(normalizeNameSuffixes([" .Example.TS.net. ", "example.ts.net", "MY-NODE"])).toEqual([
			"example.ts.net",
			"my-node",
		]);
	});

	it("drops empties rather than producing an empty constraint entry", () => {
		expect(normalizeNameSuffixes(["", "  ", "."])).toEqual([]);
	});

	it("the same suffixes in a different order produce a byte-identical constraint", () => {
		expect(caExtensions(["b.example", "a.example"])).toBe(caExtensions(["a.example", "b.example"]));
	});
});

describe("nameIsUnderSuffixes follows RFC 5280's DNS rule", () => {
	it("matches the suffix itself and any labels added on the left", () => {
		expect(nameIsUnderSuffixes("example.ts.net", ["example.ts.net"])).toBe(true);
		expect(nameIsUnderSuffixes("node.example.ts.net", ["example.ts.net"])).toBe(true);
		expect(nameIsUnderSuffixes("a.b.example.ts.net", ["example.ts.net"])).toBe(true);
	});

	it("does NOT match a name that merely ends with the same characters", () => {
		expect(nameIsUnderSuffixes("notexample.ts.net", ["example.ts.net"])).toBe(false);
		expect(nameIsUnderSuffixes("example.ts.network", ["example.ts.net"])).toBe(false);
	});

	it("is case- and trailing-dot-insensitive", () => {
		expect(nameIsUnderSuffixes("NODE.Example.TS.net.", ["example.ts.net"])).toBe(true);
	});
});

describe("the CA extension block — the name constraint is present and correct", () => {
	const block = caExtensions(["example.ts.net", "my-node"]);

	it("carries a critical nameConstraints extension", () => {
		expect(block).toContain("nameConstraints = critical,");
	});

	it("permits exactly the declared suffixes, and nothing else", () => {
		expect(block).toContain("permitted;DNS:example.ts.net");
		expect(block).toContain("permitted;DNS:my-node");
		const permitted = [...block.matchAll(/permitted;DNS:([^,\n]+)/g)].map((m) => m[1]);
		expect(permitted).toEqual(["example.ts.net", "my-node"]);
	});

	it("excludes every IP address — a bare address is what a hostname constraint cannot bound", () => {
		expect(block).toContain("excluded;IP:0.0.0.0/0.0.0.0");
		expect(block).toContain("excluded;IP:::/::");
	});

	it("is a CA that can sign leaves and never a sub-CA", () => {
		expect(block).toContain("basicConstraints = critical,CA:TRUE,pathlen:0");
		expect(block).toContain("keyUsage = critical,keyCertSign,cRLSign");
	});

	it("refuses to build a CA with no constraint at all", () => {
		expect(() => caExtensions([])).toThrow(/vouch for anything/);
		expect(() => caExtensions(["  "])).toThrow(/vouch for anything/);
	});

	it("the config file embeds the very block, under [v3_ca]", () => {
		const config = caConfigFile(["example.ts.net"]);
		expect(config).toContain("[v3_ca]");
		expect(config).toContain(caExtensions(["example.ts.net"]));
		expect(config).toContain("x509_extensions = v3_ca");
	});
});

describe("the leaf extension block", () => {
	it("is a server certificate and nothing else", () => {
		const block = leafExtensions(["node", "node.example.ts.net"]);
		expect(block).toContain("basicConstraints = critical,CA:FALSE");
		expect(block).toContain("extendedKeyUsage = serverAuth");
		expect(block).toContain("subjectAltName = DNS:node,DNS:node.example.ts.net");
	});

	it("refuses a leaf with no name", () => {
		expect(() => leafExtensions([])).toThrow(/vouches for nothing/);
	});

	it("the config file embeds the very block, under [v3_leaf]", () => {
		expect(leafConfigFile(["node"])).toContain("[v3_leaf]");
		expect(leafConfigFile(["node"])).toContain(leafExtensions(["node"]));
	});
});

describe("refarm's OWN enforcement of the constraint — the half that is a guarantee", () => {
	it("passes names under the suffixes, normalised", () => {
		expect(assertNamesUnderSuffixes(["NODE.Example.TS.net."], ["example.ts.net"])).toEqual([
			"node.example.ts.net",
		]);
	});

	it("refuses an out-of-suffix name before openssl is ever called", () => {
		expect(() => assertNamesUnderSuffixes(["evil.com"], ["example.ts.net"])).toThrow(
			/outside this CA's name constraint/,
		);
	});

	it("says out loud that it holds even where a trust store ignores nameConstraints", () => {
		try {
			assertNamesUnderSuffixes(["evil.com"], ["example.ts.net"]);
			expect.unreachable("should have refused");
		} catch (error) {
			expect((error as Error & { fix: string }).fix).toMatch(/ignores the certificate's own/);
		}
	});

	it("refuses a CA with no suffixes rather than defaulting to 'anything'", () => {
		expect(() => assertNamesUnderSuffixes(["node"], [])).toThrow(/vouch for nothing at all/);
	});
});

describe("file stems are filesystem-safe and derived from the name", () => {
	it("keeps dots and hyphens, replaces the rest", () => {
		expect(certificateFileStem("node.example.ts.net")).toBe("node.example.ts.net");
		expect(certificateFileStem("My Node/../etc")).toBe("my-node-..-etc");
	});

	it("never produces an empty stem", () => {
		expect(certificateFileStem("///")).toBe("leaf");
	});
});
