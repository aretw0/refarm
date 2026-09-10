import { describe, expect, it } from "vitest";

import { classifyByLayout, declaredNamespaces, namespaceOf } from "./sovereign-layout.js";

const DECLARED = ["default"];
const nature = (relative: string, declared = DECLARED) => classifyByLayout(relative, declared).nature;

/**
 * The layout replaced a list of filename rules because the list had already missed a certificate
 * authority private key. These pin the order that prevents a repeat: secrets are matched before
 * anything else can call them ordinary.
 */
describe("classifyByLayout", () => {
	it("reads a CA key as a secret BEFORE the tls/ rule calls it identity material", () => {
		// Order is the whole defence. `tls/` is legitimately carried — it holds the certificates a
		// restored node needs — so a broad `tls/` rule ahead of the key rule would carry the key with
		// them, which is the leak this file exists to make impossible.
		expect(nature(".refarm/tls/ca.key")).toBe("secret");
		expect(nature(".refarm/tls/ca.crt")).toBe("data");
		expect(nature(".refarm/tls/ca.cnf")).toBe("data");
		expect(classifyByLayout(".refarm/tls/ca.key", DECLARED).reason).toContain("re-enrolled by hand");
	});

	it("reads any key or token as a secret, wherever it sits", () => {
		// By suffix rather than by directory, so a subsystem that starts writing keys somewhere new
		// is covered the day it does, instead of after someone notices.
		expect(nature(".refarm/delivery/telegram.token")).toBe("secret");
		expect(nature(".refarm/somewhere/new/private.pem")).toBe("secret");
		expect(nature(".silo/identity.json")).toBe("secret");
	});

	it("carries a DECLARED namespace and calls an undeclared one foreign", () => {
		// The operator's policy, 2026-08-13. His data directory held 67 databases of which 2 carry
		// his namespace; the other 65 are scratch. A rule retires the ones after them too.
		expect(nature(".refarm/data/refarm/default.db")).toBe("data");
		expect(nature(".local/share/refarm/default.peer")).toBe("data");
		expect(nature(".local/share/refarm/repro.db")).toBe("foreign");
		expect(classifyByLayout(".local/share/refarm/repro.db", DECLARED).reason).toContain(
			"not deleted either",
		);
	});

	it("honours a declaration of MORE than one namespace", () => {
		expect(nature(".local/share/refarm/serpro.db", ["default", "serpro"])).toBe("data");
	});

	it("treats an EMPTY declaration as none, not as everything", () => {
		// The failure that would silently carry 67 scratch databases: reading an empty list as
		// "unfiltered". A node declaring nothing owns nothing here.
		expect(nature(".refarm/data/refarm/default.db", [])).toBe("foreign");
	});

	it("separates the operator's hand-made backups as foreign, not as data", () => {
		expect(nature(".refarm/config.json.bak-antes-do-batismo")).toBe("foreign");
	});

	it("calls installed artifacts cache, and names what rebuilds them", () => {
		expect(nature(".refarm/dist/farm-client/index.js")).toBe("cache");
		expect(nature(".refarm/plugins/agent/plugin.json")).toBe("cache");
		expect(classifyByLayout(".refarm/plugins/x", DECLARED).rebuiltBy).toContain("plugin install");
	});

	it("keeps an audit trail as data, because nothing rebuilds a record of the past", () => {
		// The one place a `.ndjson` under a working directory must NOT be read as regenerable.
		expect(nature(".refarm/scarecrow-audit.ndjson")).toBe("data");
		expect(nature(".refarm/streams/activity.ndjson")).toBe("data");
		// A response stream beside it is working state and does regenerate.
		expect(nature(".refarm/streams/urn:tractor:stream:response:x.ndjson")).toBe("cache");
	});

	it("keeps the node's own records as data", () => {
		for (const file of [
			".refarm/sas/verification-log.ndjson",
			".refarm/task-results/abc.json",
			".refarm/task-memory.db",
			".refarm/operations.json",
		]) {
			expect(nature(file), file).toBe("data");
		}
	});

	it("calls the operator's declarations decisions", () => {
		expect(nature(".refarm/config.json")).toBe("decision");
		expect(nature(".refarm/auth-policy.json")).toBe("decision");
	});

	it("leaves an unknown path UNREGISTERED — not cache, not foreign", () => {
		// The state that makes the layout self-correcting. Anything else here would hide the next
		// subsystem that writes somewhere nobody described.
		const verdict = classifyByLayout(".refarm/something-nobody-declared/file.json", DECLARED);
		expect(verdict.nature).toBe("unregistered");
		expect(verdict.reason).toContain("certificate authority key went unnoticed");
	});

	it("normalises separators, so a Windows path classifies the same", () => {
		expect(classifyByLayout(".refarm\\tls\\ca.key", DECLARED).nature).toBe("secret");
	});
});

describe("namespaceOf", () => {
	it("reads the namespace from either storage directory", () => {
		expect(namespaceOf(".refarm/data/refarm/default.db")).toBe("default");
		expect(namespaceOf(".local/share/refarm/repro.peer")).toBe("repro");
		expect(namespaceOf(".refarm/config.json")).toBeNull();
	});
});

describe("declaredNamespaces", () => {
	it("uses what the node declares", () => {
		expect(declaredNamespaces({ storage: { namespaces: ["default", "serpro"] } })).toEqual({
			namespaces: ["default", "serpro"],
			origin: "declared",
		});
	});

	it("falls back to the convention when the question was never asked, and SAYS so", () => {
		// A node predating this must not report its own database as foreign. `origin` is what lets
		// the report tell the operator whether he chose this or inherited it.
		expect(declaredNamespaces({})).toEqual({ namespaces: ["default"], origin: "convention" });
		expect(declaredNamespaces(null)).toEqual({ namespaces: ["default"], origin: "convention" });
	});

	it("honours an explicitly EMPTY declaration as a choice", () => {
		// "None of these are mine" is a thing an operator may mean, and it is not the same as not
		// having been asked.
		expect(declaredNamespaces({ storage: { namespaces: [] } })).toEqual({
			namespaces: [],
			origin: "declared",
		});
	});
});
