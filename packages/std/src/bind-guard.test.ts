import { describe, expect, it } from "vitest";

import {
	assertBindAllowed,
	DEFAULT_BIND_HOST,
	isLoopbackBindHost,
	refuseUnguardedNonLoopbackBind,
} from "./bind-guard.js";

/**
 * These tests are the TS mirror of `bind_guard.rs`'s test module. Every case is PURE over
 * `(host, policyPresent)` — no socket is opened, no port is bound, nothing can hang. That is the
 * whole point of splitting the decision out of the `listen()` call: a bind rule you cannot test
 * without binding is a bind rule nobody tests.
 *
 * The two guards protect the same ports on the same machine, so they must agree case-for-case.
 * If a case here diverges from the Rust table, one of the two is wrong.
 */

describe("isLoopbackBindHost", () => {
	it("accepts the whole 127.0.0.0/8 range, not just 127.0.0.1", () => {
		expect(isLoopbackBindHost("127.0.0.1")).toBe(true);
		expect(isLoopbackBindHost("127.5.5.5")).toBe(true);
		expect(isLoopbackBindHost("127.255.255.254")).toBe(true);
	});

	it("accepts the literal localhost, case-insensitively", () => {
		expect(isLoopbackBindHost("localhost")).toBe(true);
		expect(isLoopbackBindHost("LOCALHOST")).toBe(true);
		expect(isLoopbackBindHost("  localhost  ")).toBe(true);
	});

	it("accepts ::1 both bare and bracketed, plus its zero-padded spelling", () => {
		expect(isLoopbackBindHost("::1")).toBe(true);
		expect(isLoopbackBindHost("[::1]")).toBe(true);
		expect(isLoopbackBindHost("0:0:0:0:0:0:0:1")).toBe(true);
		expect(isLoopbackBindHost("0000:0000:0000:0000:0000:0000:0000:0001")).toBe(true);
	});

	it("rejects the unspecified addresses in every spelling", () => {
		// Every interface — the single most dangerous host to get wrong here.
		for (const host of ["0.0.0.0", "::", "[::]", "0:0:0:0:0:0:0:0"]) {
			expect(isLoopbackBindHost(host), host).toBe(false);
		}
	});

	it("rejects the ENTIRE IPv4-mapped family, including mapped loopback", () => {
		// `::ffff:127.0.0.1` is the mapped spelling of loopback, but Rust's
		// `Ipv6Addr::is_loopback()` matches only the literal `::1` — it does not special-case
		// the mapped family. Folding a mapped address down to its embedded IPv4 form (the
		// "obvious simplification") would flip this to true and silently allow an
		// all-interfaces-reachable bind through the back door. Both directions stay rejected.
		for (const host of [
			"::ffff:127.0.0.1",
			"::ffff:0.0.0.0",
			"[::ffff:127.0.0.1]",
			"::ffff:7f00:1",
			"::ffff:0:0",
		]) {
			expect(isLoopbackBindHost(host), host).toBe(false);
		}
	});

	it("rejects routable addresses", () => {
		for (const host of ["100.64.0.1", "192.168.1.10", "10.0.0.1", "fe80::1", "2001:db8::1"]) {
			expect(isLoopbackBindHost(host), host).toBe(false);
		}
	});

	it("fails closed on anything it cannot parse", () => {
		for (const host of [
			"not-an-ip-or-localhost",
			"some.hostname",
			"localhost.evil.test",
			"127.0.0.1.evil.test",
			"",
			"   ",
			"127.0.0",
			"127.0.0.1.5",
			"999.0.0.1",
			"::1::1",
			"[::1",
			"127.0.0.1:42000",
		]) {
			expect(isLoopbackBindHost(host), host).toBe(false);
		}
	});

	it("rejects leading-zero octets rather than guessing what they mean", () => {
		// `010.0.0.1` is not a canonical dotted quad; parsers disagree about octal. A guard
		// that disagrees with the OS about which address a string names has a gap.
		expect(isLoopbackBindHost("0127.0.0.1")).toBe(false);
		expect(isLoopbackBindHost("127.00.0.1")).toBe(false);
	});
});

describe("refuseUnguardedNonLoopbackBind", () => {
	it("allows loopback regardless of policy — the default is unchanged by the guard", () => {
		expect(refuseUnguardedNonLoopbackBind("127.0.0.1", false)).toBeNull();
		expect(refuseUnguardedNonLoopbackBind("127.0.0.1", true)).toBeNull();
		expect(refuseUnguardedNonLoopbackBind("::1", false)).toBeNull();
		expect(refuseUnguardedNonLoopbackBind("localhost", false)).toBeNull();
	});

	it("refuses a non-loopback bind with no policy, and names the fix", () => {
		const refusal = refuseUnguardedNonLoopbackBind("0.0.0.0", false);
		expect(refusal).not.toBeNull();
		expect(refusal).toContain("refarm auth enroll");
		expect(refusal).toContain("REFARM_AUTH_POLICY");
		expect(refusal).toContain("0.0.0.0");
	});

	it("allows a non-loopback bind once a policy is configured", () => {
		expect(refuseUnguardedNonLoopbackBind("100.64.0.1", true)).toBeNull();
		// A policy is blanket permission regardless of host SHAPE — this guard refuses the
		// UNGUARDED case, it does not validate hostnames.
		expect(refuseUnguardedNonLoopbackBind("some.hostname", true)).toBeNull();
	});

	it("names the refusing surface so an operator knows WHICH listener said no", () => {
		const refusal = refuseUnguardedNonLoopbackBind("0.0.0.0", false, "the capability surface");
		expect(refusal).toContain("the capability surface");
	});
});

describe("assertBindAllowed", () => {
	it("returns the decision for an allowed bind", () => {
		expect(assertBindAllowed("127.0.0.1", false)).toEqual({ host: "127.0.0.1", loopback: true });
		expect(assertBindAllowed("100.64.0.1", true)).toEqual({
			host: "100.64.0.1",
			loopback: false,
		});
	});

	it("throws on a refused bind rather than returning a value a caller might ignore", () => {
		expect(() => assertBindAllowed("0.0.0.0", false)).toThrow(/no auth policy configured/);
	});
});

describe("DEFAULT_BIND_HOST", () => {
	it("is loopback — the one place 'what do we bind by default' is answered", () => {
		expect(DEFAULT_BIND_HOST).toBe("127.0.0.1");
		expect(isLoopbackBindHost(DEFAULT_BIND_HOST)).toBe(true);
	});
});
