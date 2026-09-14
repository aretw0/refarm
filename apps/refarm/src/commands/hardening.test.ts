import type { BaselineRead, HardeningSignal, RatchetVerdict } from "@refarm.dev/hardening";
import { describe, expect, it, vi } from "vitest";

import { createHardeningCommand, type HardeningCommandDeps } from "./hardening.js";

const signal: HardeningSignal = {
	workspaceRoot: "/workspace",
	counts: { suites: 2, conformant: 1, notYetHardened: 1, notApplicable: 0, checks: 7 },
	entries: [
		{
			id: "@refarm.dev/example#runExampleConformance",
			packageName: "@refarm.dev/example",
			runner: "runExampleConformance",
			declares: "runner",
			source: "packages/example/src/conformance.ts",
			state: "not-yet-hardened",
			checks: 0,
			failed: 0,
			detail: [],
			fix: "bind a reference subject",
			reason: null,
		},
	],
};

const baseline: BaselineRead = {
	path: "/workspace/hardening-baseline.json",
	present: true,
	error: null,
	baseline: { entries: [] },
};

function deps(verdict: RatchetVerdict, writes: string[], exits: number[]): HardeningCommandDeps {
	return {
		cwd: () => "/workspace/apps/refarm",
		findRoot: vi.fn(() => "/workspace"),
		collect: vi.fn(async () => signal),
		readBaseline: vi.fn(() => baseline),
		evaluate: vi.fn(() => verdict),
		emit: (line) => writes.push(line),
		setExitCode: (code) => exits.push(code),
	};
}

const green: RatchetVerdict = {
	ok: true,
	regressions: [],
	fixed: [],
	stale: [],
	held: [],
	malformed: [],
};

describe("refarm hardening", () => {
	it("prints the signal without turning known debt into a command failure", async () => {
		const writes: string[] = [];
		const exits: number[] = [];
		await createHardeningCommand(deps(green, writes, exits)).parseAsync([], { from: "user" });
		expect(writes[0]).toContain("2 conformance suites, 1 conformant (7 checks)");
		expect(writes[0]).toContain("bind a reference subject");
		expect(exits).toEqual([]);
	});

	it("emits the complete JSON envelope", async () => {
		const writes: string[] = [];
		await createHardeningCommand(deps(green, writes, [])).parseAsync(["--json"], { from: "user" });
		expect(JSON.parse(writes[0]!)).toMatchObject({
			command: "hardening",
			operation: "signal",
			ok: true,
			signal: { counts: { suites: 2 } },
		});
	});

	it("rejects baseline growth only when invoked as a gate", async () => {
		const writes: string[] = [];
		const exits: number[] = [];
		const red = {
			...green,
			ok: false,
			regressions: [{ id: signal.entries[0]!.id, fix: "bind a reference subject" }],
		};
		await createHardeningCommand(deps(red, writes, exits)).parseAsync(["--gate", "--json"], {
			from: "user",
		});
		expect(JSON.parse(writes[0]!)).toMatchObject({ operation: "gate", ok: false });
		expect(exits).toEqual([1]);
	});
});
