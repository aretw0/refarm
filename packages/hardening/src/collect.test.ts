import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { collectHardeningSignal } from "./collect.js";
import { findWorkspaceRoot } from "./discover.js";
import { createFixtureWorkspace, type FixtureWorkspace } from "./fixture-workspace.testkit.js";
import type { HardeningEntry } from "./types.js";

let workspace: FixtureWorkspace | undefined;

afterEach(() => {
	workspace?.dispose();
	workspace = undefined;
});

/** A suite in the shape 23 of this repo's 26 use, plus the in-memory subject it checks. */
const PASSING_PACKAGE = {
	name: "@fixture/passing",
	dir: "passing",
	manifest: { exports: { ".": { import: "./index.mjs" } } },
	files: {
		"index.mjs": `export function createInMemoryPassingAdapter() {
	return { ok: true };
}
export async function runPassingConformance(adapter) {
	return { pass: adapter.ok === true, total: 4, failed: 0, failures: [] };
}
`,
	},
};

function entry(entries: readonly HardeningEntry[], id: string): HardeningEntry {
	const found = entries.find((candidate) => candidate.id === id);
	expect(found, `no entry for ${id}`).toBeDefined();
	return found!;
}

describe("the collector, on suites written for it to find", () => {
	it("binds a subject by convention and reports the suite as conformant", async () => {
		workspace = createFixtureWorkspace([PASSING_PACKAGE]);
		const signal = await collectHardeningSignal({ workspaceRoot: workspace.root });
		const result = entry(signal.entries, "@fixture/passing#runPassingConformance");
		expect(result.state).toBe("conformant");
		expect(result.checks).toBe(4);
		expect(signal.counts).toMatchObject({ suites: 1, conformant: 1, checks: 4 });
	});

	it("reports a failing suite as not-yet-hardened, with what it says is wrong", async () => {
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/failing",
				dir: "failing",
				manifest: { exports: { ".": { import: "./index.mjs" } } },
				files: {
					"index.mjs": `export function createInMemoryFailingAdapter() { return {}; }
export async function runFailingConformance() {
	return { pass: false, total: 3, failed: 1, failures: ["get() returned null"] };
}
`,
				},
			},
		]);
		const signal = await collectHardeningSignal({ workspaceRoot: workspace.root });
		const result = entry(signal.entries, "@fixture/failing#runFailingConformance");
		expect(result.state).toBe("not-yet-hardened");
		expect(result.failed).toBe(1);
		expect(result.detail).toEqual(["get() returned null"]);
		expect(result.fix).toContain("1 of 3 checks fail");
	});

	it("counts a vendored copy ONCE, and says which entry carries the contract", async () => {
		// The exact shape in this repo: `packages/farm-client/vendor/prompt-contract-v1.mjs` and
		// `packages/prompt-contract-v1` both export `runOperatorChannelConformance`. Identical source
		// is what justifies the merge — not the `vendor/` path on its own.
		const suite = `export async function runSharedConformance(channel) {
	return { pass: true, total: 2, failed: 0, failures: [] };
}
`;
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/canonical",
				dir: "canonical",
				manifest: { exports: { ".": { import: "./index.mjs" } } },
				files: {
					"index.mjs": `export function createInMemorySharedChannel() { return {}; }\n${suite}`,
				},
			},
			{
				name: "@fixture/consumer",
				dir: "consumer",
				manifest: { exports: { ".": { import: "./index.mjs" } } },
				files: { "index.mjs": "export const nothing = true;\n", "vendor/canonical.mjs": suite },
			},
		]);
		const signal = await collectHardeningSignal({ workspaceRoot: workspace.root });
		expect(entry(signal.entries, "@fixture/canonical#runSharedConformance").state).toBe("conformant");
		const copy = entry(signal.entries, "@fixture/consumer#runSharedConformance");
		expect(copy.state).toBe("not-applicable");
		expect(copy.reason).toContain("vendored copy of @fixture/canonical");
		expect(copy.reason).toContain(path.join("packages", "canonical", "index.mjs"));
		// Counted once: two discoveries, one contract, one set of checks.
		expect(signal.counts).toMatchObject({ suites: 2, conformant: 1, notApplicable: 1, checks: 2 });
	});

	it("stops merging a vendored copy that has DRIFTED from its origin", async () => {
		// A copy that no longer matches its origin is a real second thing, and a hardening signal
		// should surface that rather than hide it behind a dedup rule based on a directory name.
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/canonical",
				dir: "canonical",
				manifest: { exports: { ".": { import: "./index.mjs" } } },
				files: {
					"index.mjs": `export function createInMemorySharedChannel() { return {}; }
export async function runSharedConformance(channel) {
	return { pass: true, total: 2, failed: 0, failures: [] };
}
`,
				},
			},
			{
				name: "@fixture/consumer",
				dir: "consumer",
				manifest: { exports: { ".": { import: "./index.mjs" } } },
				files: {
					"index.mjs": "export function createInMemorySharedChannel() { return {}; }\n",
					"vendor/canonical.mjs": `export async function runSharedConformance(channel) {
	return { pass: false, total: 2, failed: 1, failures: ["the vendored copy drifted"] };
}
`,
				},
			},
		]);
		const signal = await collectHardeningSignal({ workspaceRoot: workspace.root });
		const copy = entry(signal.entries, "@fixture/consumer#runSharedConformance");
		expect(copy.state).not.toBe("not-applicable");
		expect(copy.detail).toContain("the vendored copy drifted");
	});

	it("reports a result shape with no runner as not-applicable — never as a failure", async () => {
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/shape-only",
				dir: "shape-only",
				buildable: true,
				files: { "src/types.ts": "export interface ShapeOnlyConformanceResult { pass: boolean }\n" },
			},
		]);
		const signal = await collectHardeningSignal({ workspaceRoot: workspace.root });
		const result = entry(signal.entries, "@fixture/shape-only#ShapeOnlyConformanceResult");
		expect(result.state).toBe("not-applicable");
		expect(result.reason).toContain("no entry point");
		expect(signal.counts.notYetHardened).toBe(0);
	});

	it("reports a test-framework suite as not-applicable, with how to run it", async () => {
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/vitest-suite",
				dir: "vitest-suite",
				files: {
					"src/conformance.mjs": `import { describe, it } from "node:test";
export function runConformanceTests(name, factory) {
	describe(name, () => it("works", () => factory()));
}
`,
				},
			},
		]);
		const signal = await collectHardeningSignal({ workspaceRoot: workspace.root });
		const result = entry(signal.entries, "@fixture/vitest-suite#runConformanceTests");
		expect(result.state).toBe("not-applicable");
		expect(result.reason).toContain("run test");
	});

	it("says a suite is UNCOLLECTED rather than passing when no subject can be bound", async () => {
		// The property that makes discovery worth having: a suite the collector cannot drive is still
		// reported, loudly, with the fix. Silence is the failure mode of a hand-maintained list.
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/unbound",
				dir: "unbound",
				manifest: { exports: { ".": { import: "./index.mjs" } } },
				files: {
					"index.mjs": `export async function runUnboundConformance(host, digest) {
	return { pass: true, total: 1, failed: 0, failures: [] };
}
`,
				},
			},
		]);
		const signal = await collectHardeningSignal({ workspaceRoot: workspace.root });
		const result = entry(signal.entries, "@fixture/unbound#runUnboundConformance");
		expect(result.state).toBe("not-yet-hardened");
		expect(result.checks).toBe(0);
		expect(result.fix).toContain("no subject is bound");
	});

	it("refuses to guess when a package exports two candidate subjects", async () => {
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/ambiguous",
				dir: "ambiguous",
				manifest: { exports: { ".": { import: "./index.mjs" } } },
				files: {
					"index.mjs": `export function createInMemoryOne() { return { which: 1 }; }
export function createInMemoryTwo() { return { which: 2 }; }
export async function runAmbiguousConformance(subject) {
	return { pass: true, total: 1, failed: 0, failures: [] };
}
`,
				},
			},
		]);
		const result = entry(
			(await collectHardeningSignal({ workspaceRoot: workspace.root })).entries,
			"@fixture/ambiguous#runAmbiguousConformance",
		);
		expect(result.state).toBe("not-yet-hardened");
		expect(result.fix).toContain("createInMemoryOne, createInMemoryTwo");
	});

	it("says an unbuilt package is unbuilt, and how to build it", async () => {
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/unbuilt",
				dir: "unbuilt",
				buildable: true,
				files: {
					"src/conformance.ts": "export function runUnbuiltConformance(): void {}\n",
				},
			},
		]);
		const result = entry(
			(await collectHardeningSignal({ workspaceRoot: workspace.root })).entries,
			"@fixture/unbuilt#runUnbuiltConformance",
		);
		expect(result.state).toBe("not-yet-hardened");
		expect(result.fix).toContain("pnpm --filter @fixture/unbuilt run build");
	});

	it("does not score an unreadable result shape as a pass", async () => {
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/strange",
				dir: "strange",
				manifest: { exports: { ".": { import: "./index.mjs" } } },
				files: {
					"index.mjs": `export function createInMemoryStrange() { return {}; }
export async function runStrangeConformance(subject) { return { verdict: "fine" }; }
`,
				},
			},
		]);
		const result = entry(
			(await collectHardeningSignal({ workspaceRoot: workspace.root })).entries,
			"@fixture/strange#runStrangeConformance",
		);
		expect(result.state).toBe("not-yet-hardened");
		expect(result.fix).toContain("normalise.ts");
	});

	it("orders by package and runner, not by severity", async () => {
		workspace = createFixtureWorkspace([
			PASSING_PACKAGE,
			{
				name: "@fixture/aardvark",
				dir: "aardvark",
				manifest: { exports: { ".": { import: "./index.mjs" } } },
				files: {
					"index.mjs": `export function createInMemoryAardvark() { return {}; }
export async function runAardvarkConformance(subject) {
	return { pass: false, total: 1, failed: 1, failures: ["nope"] };
}
`,
				},
			},
		]);
		const signal = await collectHardeningSignal({ workspaceRoot: workspace.root });
		expect(signal.entries.map((item) => item.packageName)).toEqual([
			"@fixture/aardvark",
			"@fixture/passing",
		]);
	});
});

describe("the collector, on this repository", () => {
	it("collects every suite that is really here, and runs a real number of checks", async () => {
		const root = findWorkspaceRoot(path.resolve(__dirname, ".."));
		expect(root).not.toBeNull();
		const signal = await collectHardeningSignal({ workspaceRoot: root! });
		// A floor, not an equality: this must not have to be edited every time a contract is added —
		// that is the maintenance burden discovery exists to remove. What it does catch is discovery
		// silently going to zero, which would make every assertion above vacuous.
		expect(signal.counts.suites).toBeGreaterThanOrEqual(26);
		expect(signal.counts.conformant).toBeGreaterThanOrEqual(20);
		expect(signal.counts.checks).toBeGreaterThan(200);
		// The vendored copy of the operator-channel suite is counted once, at its origin.
		const operatorChannel = signal.entries.filter(
			(item) => item.runner === "runOperatorChannelConformance",
		);
		expect(operatorChannel).toHaveLength(2);
		expect(operatorChannel.filter((item) => item.state === "conformant")).toHaveLength(1);
		expect(operatorChannel.filter((item) => item.state === "not-applicable")).toHaveLength(1);
		// Every entry answers WHICH KIND of absent it is (H3).
		for (const item of signal.entries) {
			if (item.state === "not-yet-hardened") expect(item.fix).toBeTruthy();
			if (item.state === "not-applicable") expect(item.reason).toBeTruthy();
		}
	}, 60_000);
});
