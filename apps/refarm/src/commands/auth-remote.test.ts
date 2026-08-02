/**
 * THE ENTRYPOINT THE NODE SPAWNS — and the three answers it can give.
 *
 * `remote-initiation.test.ts` pins the DECLARATION (silence is closed and argv is constant).
 * This file pins the one thing built on top of it: the verdict a remote surface
 * actually receives, and the fact that it distinguishes "I do not know that command" from "I
 * know it and it is shut" from "I could not" — the last of which is the node's answer, never
 * this command's, because a process that never started cannot print a line.
 *
 * Mutation-verified: collapse both refusal branches in `remoteInitiationVerdict` into one
 * reason and `the_two_refusals_are_not_the_same_sentence` fails.
 */

import { describe, expect, it } from "vitest";

import { program } from "../program.js";
import {
	reinvocationArgv,
	REMOTE_INITIATION_WIRE,
	remoteInitiationVerdict,
} from "./auth-remote.js";
import { everyCommandPath, REMOTELY_INITIABLE_OPERATIONS } from "./remote-initiation.js";

const KNOWN = everyCommandPath(program);

describe("remoteInitiationVerdict", () => {
	it("distinguishes a local-only workspace operation from an unknown id", () => {
		const remote = {
			id: "workspace:rcdc5:vpn",
			argv: ["workspace", "run", "rcdc5", "vpn"],
			why: "Connect VPN",
		};
		expect(remoteInitiationVerdict(remote.id, [remote.id], [remote]).ok).toBe(true);
		const localOnly = remoteInitiationVerdict(
			"workspace:rcdc5:secrets",
			["workspace:rcdc5:secrets"],
			[remote],
		);
		expect(localOnly.ok).toBe(false);
		if (!localOnly.ok) expect(localOnly.reason).toBe("not-remotely-invocable");
	});

	it("starts exactly what the table declares, and names it back", () => {
		for (const operation of REMOTELY_INITIABLE_OPERATIONS) {
			const verdict = remoteInitiationVerdict(operation.id, KNOWN);
			expect(verdict.ok, `${operation.id} is declared and must start`).toBe(true);
			if (!verdict.ok) continue;
			expect(verdict.wire).toBe(REMOTE_INITIATION_WIRE);
			// The name relayed is the TABLE's, not the caller's string — they are equal here by
			// construction (exact match is the only way in) and that equality is the point.
			expect(verdict.operation).toBe(operation.id);
		}
	});

	it("refuses everything the CLI has that the table does not declare", () => {
		const declared = new Set(REMOTELY_INITIABLE_OPERATIONS.map((operation) => operation.id));
		expect(KNOWN.length).toBeGreaterThan(50);
		for (const path of KNOWN) {
			if (declared.has(path)) continue;
			const verdict = remoteInitiationVerdict(path, KNOWN);
			expect(verdict.ok, `${path} is not declared and must be refused`).toBe(false);
		}
	});

	it("the two refusals are not the same sentence", () => {
		// MUTATION-VERIFIED. Collapse the branches and this fails.
		const real = remoteInitiationVerdict("auth revoke", KNOWN);
		expect(real.ok).toBe(false);
		if (real.ok) return;
		expect(real.reason).toBe("not-remotely-invocable");

		for (const nonsense of ["delivery ad", "totally made up", "", "🌾", "delivery add extra"]) {
			const verdict = remoteInitiationVerdict(nonsense, KNOWN);
			expect(verdict.ok, `${nonsense} must be refused`).toBe(false);
			if (verdict.ok) continue;
			expect(verdict.reason, `${nonsense} names no command this CLI has`).toBe("unknown-operation");
		}
	});

	it("never quotes back what the caller sent", () => {
		// A refusal that echoed the request would put one caller's bytes into a response — and,
		// through the node's relay, in front of a different device.
		const smuggled = "delivery add; rm -rf ~";
		const verdict = remoteInitiationVerdict(smuggled, KNOWN);
		expect(verdict.ok).toBe(false);
		if (verdict.ok) return;
		expect(verdict.detail).not.toContain(smuggled);
		expect(verdict.detail).not.toContain("rm -rf");
	});

	it("is one line of JSON, whatever the verdict — the node reads exactly one", () => {
		for (const requested of ["delivery add", "auth revoke", "nonsense\nwith\nnewlines"]) {
			const line = JSON.stringify(remoteInitiationVerdict(requested, KNOWN));
			expect(line.includes("\n")).toBe(false);
			expect(JSON.parse(line).wire).toBe(REMOTE_INITIATION_WIRE);
		}
	});

	it("judges nothing by the caller's credential, because it holds none", () => {
		// The signature is the assertion: an id and what the CLI has. Authority is the NODE's
		// question (`/operations` declares its narrow scope), settled before this process
		// exists. A credential parameter here would be a second authentication path reachable by
		// anyone already able to run this command locally.
		expect(remoteInitiationVerdict.length).toBe(2);
	});
});

describe("reinvocationArgv", () => {
	it("reconstructs this process's own invocation so the wizard starts the way a local one does", () => {
		expect(
			reinvocationArgv(["delivery", "add"], {
				execArgv: ["--import", "file:///loader.mjs"],
				argv: ["/usr/bin/node", "/opt/refarm/dist/index.js", "auth", "remote", "run"],
			} as unknown as typeof process),
		).toEqual(["--import", "file:///loader.mjs", "/opt/refarm/dist/index.js", "delivery", "add"]);
	});

	it("carries the loader flags — dropping them starts a wizard that cannot resolve the workspace", () => {
		const withLoader = reinvocationArgv(["delivery", "add"], {
			execArgv: ["--import", "file:///loader.mjs"],
			argv: ["node", "/entry.js"],
		} as unknown as typeof process);
		expect(withLoader.slice(0, 2)).toEqual(["--import", "file:///loader.mjs"]);
	});

	it("passes the operation's argv through as separate elements, never as one string", () => {
		const argv = reinvocationArgv(["delivery", "add"], {
			execArgv: [],
			argv: ["node", "/entry.js"],
		} as unknown as typeof process);
		expect(argv).toEqual(["/entry.js", "delivery", "add"]);
		expect(argv.some((token) => token.includes(" "))).toBe(false);
	});
});
