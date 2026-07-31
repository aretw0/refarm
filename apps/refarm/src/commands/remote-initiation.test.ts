/**
 * THE TEETH OF "SILENCE IS CLOSED".
 *
 * The declaration in `remote-initiation.ts` is only worth what this file proves about it. Two of
 * these tests are load-bearing and were mutation-verified — the mutation is named in each, and
 * running it makes exactly that test fail:
 *
 *   1. `silence_is_closed` — deleting the `!operation` refusal (falling through to a permissive
 *      default) makes an undeclared id resolve.
 *   2. `device-only` — removing the credential check makes a scoped credential start work.
 *
 * The third pillar is not a rule but a SHAPE: the `ok: true` decision carries an argv and nothing
 * else, so there is nothing a wizard could read to learn where it was started from.
 */

import { describe, expect, it } from "vitest";

import { program } from "../program.js";
import {
	everyCommandPath,
	remoteInitiationCommandLine,
	REMOTELY_INITIABLE_OPERATIONS,
	resolveRemoteInitiation,
} from "./remote-initiation.js";

const DEVICE = { kind: "device" } as const;

describe("the remote-initiation declaration", () => {
	it("declares nothing by accident — every entry is a constant argv with a stated reason", () => {
		expect(REMOTELY_INITIABLE_OPERATIONS.length).toBeGreaterThan(0);
		for (const operation of REMOTELY_INITIABLE_OPERATIONS) {
			expect(operation.id.trim()).toBe(operation.id);
			expect(operation.argv.length).toBeGreaterThan(0);
			// The id IS the command path, so the wire value and the thing it starts cannot drift
			// into two different names.
			expect(operation.id).toBe(operation.argv.join(" "));
			expect(operation.why.length).toBeGreaterThan(40);
		}
		// Ids are unique — a duplicate would make `find` pick one silently.
		const ids = REMOTELY_INITIABLE_OPERATIONS.map((operation) => operation.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("names only operations the CLI actually has", () => {
		const known = new Set(everyCommandPath(program));
		for (const operation of REMOTELY_INITIABLE_OPERATIONS) {
			expect(known.has(operation.id)).toBe(true);
		}
	});

	it("declares operations whose argv takes no operand — a device sends an id, never input", () => {
		for (const operation of REMOTELY_INITIABLE_OPERATIONS) {
			for (const token of operation.argv) {
				expect(token.startsWith("-")).toBe(false);
				expect(token).toMatch(/^[a-z][a-z0-9-]*$/);
			}
		}
	});
});

describe("resolveRemoteInitiation", () => {
	it("starts a declared operation, and hands back the table's own argv", () => {
		const decision = resolveRemoteInitiation({ operation: "delivery add", credential: DEVICE });
		expect(decision.ok).toBe(true);
		if (!decision.ok) return;
		expect(decision.argv).toEqual(["delivery", "add"]);
		expect(decision.argv).toBe(decision.operation.argv);
	});

	/**
	 * MUTATION-VERIFIED. Replace the `if (!operation)` refusal in `resolveRemoteInitiation` with a
	 * fallback that synthesises an operation from the requested id and this test fails on the very
	 * first case below.
	 */
	it("refuses an operation that declared nothing — silence is closed", () => {
		for (const undeclared of [
			"auth revoke",
			"auth enroll",
			"auth verify",
			"cert trust",
			"delivery test",
			"intention arm",
			"init",
			"sow",
			"workspace run",
		]) {
			const decision = resolveRemoteInitiation({ operation: undeclared, credential: DEVICE });
			expect(decision.ok, `${undeclared} must not be startable from a device`).toBe(false);
			if (decision.ok) continue;
			expect(decision.refusal.reason).toBe("undeclared");
		}
	});

	it("closes every command the CLI has except the ones declared — including ones added tomorrow", () => {
		const declared = new Set(REMOTELY_INITIABLE_OPERATIONS.map((operation) => operation.id));
		const paths = everyCommandPath(program);
		// The walk is the point: a command added to `program.ts` is covered here for free, and a
		// hand-maintained list is exactly what fails to cover the next one.
		expect(paths.length).toBeGreaterThan(50);
		for (const path of paths) {
			if (declared.has(path)) continue;
			const decision = resolveRemoteInitiation({ operation: path, credential: DEVICE });
			expect(decision.ok, `${path} is not declared and must be refused`).toBe(false);
		}
	});

	it("matches exactly — no trimming, no case folding, no prefix", () => {
		for (const near of [
			"delivery add ",
			" delivery add",
			"Delivery Add",
			"delivery",
			"delivery add --replace",
			"delivery add; refarm auth revoke my-phone",
			"delivery/add",
		]) {
			expect(resolveRemoteInitiation({ operation: near, credential: DEVICE }).ok).toBe(false);
		}
	});

	it("refuses an id that is not a string at all", () => {
		for (const junk of [undefined, null, 42, ["delivery", "add"], { id: "delivery add" }]) {
			const decision = resolveRemoteInitiation({ operation: junk, credential: DEVICE });
			expect(decision.ok).toBe(false);
			if (decision.ok) continue;
			expect(decision.refusal.reason).toBe("undeclared");
		}
	});

	/**
	 * MUTATION-VERIFIED. Delete the credential branch and this test fails: a scoped credential
	 * would start `delivery add`.
	 *
	 * This mirrors the sidecar gate's own split (`8dd1ce5e`): `GET /prompts` is reachable with a
	 * scoped `prompt:answer` credential; publishing and — when it exists — initiating are not.
	 */
	it("refuses a scoped credential whatever its scope — initiation is device-only", () => {
		for (const scope of [["prompt:answer"], [], ["prompt:answer", "operation:initiate"], ["*"]]) {
			const decision = resolveRemoteInitiation({
				operation: "delivery add",
				credential: { kind: "scoped", scope },
			});
			expect(decision.ok, `scope ${JSON.stringify(scope)} must not initiate`).toBe(false);
			if (decision.ok) continue;
			expect(decision.refusal.reason).toBe("not-a-device");
		}
	});

	it("refuses a credential it does not recognise, and silence", () => {
		for (const credential of [undefined, null, {}, { kind: "Device" }, "device", true]) {
			const decision = resolveRemoteInitiation({ operation: "delivery add", credential });
			expect(decision.ok).toBe(false);
			if (decision.ok) continue;
			expect(decision.refusal.reason).toBe("not-a-device");
		}
	});

	it("judges the credential before the id, so a non-device cannot enumerate the catalog", () => {
		const declared = resolveRemoteInitiation({
			operation: "delivery add",
			credential: { kind: "scoped", scope: ["prompt:answer"] },
		});
		const invented = resolveRemoteInitiation({
			operation: "definitely not an operation",
			credential: { kind: "scoped", scope: ["prompt:answer"] },
		});
		expect(declared).toEqual(invented);
	});

	it("never lets the operator's own argv through this door", () => {
		// `workspaces.*.commands` is the operator's argv, and it keeps the allowlist it already
		// has (`runDeclaredWorkspaceCommand`). None of it is reachable by naming it here.
		for (const operatorArgv of [
			"vpn",
			"rcdc5 vpn",
			"workspace run rcdc5 vpn",
			"pnpm --filter @rcdcp/serpro-vpn run vpn connect",
			"/bin/sh",
		]) {
			const decision = resolveRemoteInitiation({ operation: operatorArgv, credential: DEVICE });
			expect(decision.ok, `${operatorArgv} must not be startable from a device`).toBe(false);
		}
	});
});

describe("what a started wizard can see", () => {
	/**
	 * The structural half of "a wizard must not learn it was started remotely". The decision has
	 * no environment, no marker and no field to carry one — so there is nothing to leak, which is
	 * stronger than a rule saying not to leak it.
	 */
	it("hands back an argv and nothing a wizard could read", () => {
		const decision = resolveRemoteInitiation({ operation: "delivery add", credential: DEVICE });
		expect(decision.ok).toBe(true);
		if (!decision.ok) return;
		expect(Object.keys(decision).sort()).toEqual(["argv", "ok", "operation"]);
		expect(Object.keys(decision.operation).sort()).toEqual(["argv", "id", "why"]);
	});

	it("starts the wizard with the argv an operator would type at the node", () => {
		for (const operation of REMOTELY_INITIABLE_OPERATIONS) {
			const decision = resolveRemoteInitiation({ operation: operation.id, credential: DEVICE });
			expect(decision.ok).toBe(true);
			if (!decision.ok) continue;
			// Byte-identical to the local invocation: no extra flag, and nothing that reads as a
			// provenance marker.
			expect(remoteInitiationCommandLine(decision.operation)).toBe(`refarm ${operation.id}`);
			for (const token of decision.argv) {
				expect(token.toLowerCase()).not.toContain("remote");
				expect(token.toLowerCase()).not.toContain("headless");
				expect(token.toLowerCase()).not.toContain("unattended");
			}
		}
	});

	it("cannot be handed an environment — the type has nowhere to put one", () => {
		const decision = resolveRemoteInitiation({ operation: "delivery add", credential: DEVICE });
		if (!decision.ok) throw new Error("expected the declared operation to resolve");
		expect(decision).not.toHaveProperty("env");
		expect(decision).not.toHaveProperty("initiatedBy");
		expect(decision).not.toHaveProperty("device");
	});
});
