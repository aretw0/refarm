import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { discoverConformanceSuites, findWorkspaceRoot, moduleFor, workspacePackages } from "./discover.js";
import { createFixtureWorkspace, type FixtureWorkspace } from "./fixture-workspace.testkit.js";

let workspace: FixtureWorkspace | undefined;

afterEach(() => {
	workspace?.dispose();
	workspace = undefined;
});

const SUITE_SOURCE = `export async function runFixtureConformance(subject) {
	return { pass: true, total: 3, failed: 0, failures: [] };
}
`;

describe("discovery finds suites it was never told about", () => {
	it("finds a suite that exists nowhere in this repo", () => {
		// The claim under test. This suite was invented by this test; no list anywhere names it, and
		// the scanner was written before it existed. If discovery were hand-maintained — the thing the
		// design doc says fails to catch the NEXT suite — this assertion is what would go red.
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/newcomer",
				dir: "newcomer",
				files: { "src/conformance.mjs": SUITE_SOURCE },
			},
		]);
		const suites = discoverConformanceSuites(workspace.root);
		expect(suites.map((suite) => suite.id)).toEqual(["@fixture/newcomer#runFixtureConformance"]);
		expect(suites[0]!.declares).toBe("runner");
		expect(suites[0]!.source).toBe(path.join("packages", "newcomer", "src", "conformance.mjs"));
	});

	it("finds a suite whose file is not called conformance", () => {
		// `packages/ds/src/theme-conformance.ts`, `packages/homestead/src/sdk/host-renderer.ts` and
		// `packages/prompt-contract-v1/src/index.ts` all declare one. Scanning by filename would miss
		// three of the twenty-six.
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/elsewhere",
				dir: "elsewhere",
				files: { "src/sdk/host-renderer.mjs": SUITE_SOURCE },
			},
		]);
		expect(discoverConformanceSuites(workspace.root).map((suite) => suite.runner)).toEqual([
			"runFixtureConformance",
		]);
	});

	it("reads a file a grep would skip — one containing a NUL byte", () => {
		// `packages/artifact-contract-v1/src/conformance.ts` has a NUL byte in a string literal, and
		// `grep -r` silently reports zero matches for it: `runArtifactV1Conformance` was invisible to
		// every grep-driven audit of this repo. This is why discovery reads files itself.
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/nul",
				dir: "nul",
				files: { "src/conformance.mjs": `const id = "\0no-such-id";\n${SUITE_SOURCE}` },
			},
		]);
		expect(discoverConformanceSuites(workspace.root).map((suite) => suite.runner)).toEqual([
			"runFixtureConformance",
		]);
	});

	it("does not scan artifacts, tests or fixture directories", () => {
		// `dist/` is what `src/` compiles to: counting both would double every suite. A `fixtures/`
		// directory holds code written to be broken, and it must never reach a real signal.
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/noise",
				dir: "noise",
				files: {
					"src/conformance.mjs": SUITE_SOURCE,
					"dist/conformance.js": SUITE_SOURCE,
					"src/conformance.test.mjs": SUITE_SOURCE.replace("runFixture", "runFromATest"),
					"fixtures/broken.mjs": SUITE_SOURCE.replace("runFixture", "runFromAFixture"),
					"node_modules/dep/conformance.mjs": SUITE_SOURCE.replace("runFixture", "runFromADep"),
				},
			},
		]);
		expect(discoverConformanceSuites(workspace.root).map((suite) => suite.source)).toEqual([
			path.join("packages", "noise", "src", "conformance.mjs"),
		]);
	});

	it("reports a result shape with no runner as its own discovery, not as a suite", () => {
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/shape-only",
				dir: "shape-only",
				files: { "src/types.ts": "export interface ShapeOnlyConformanceResult { pass: boolean }\n" },
				buildable: true,
			},
		]);
		const suites = discoverConformanceSuites(workspace.root);
		expect(suites).toHaveLength(1);
		expect(suites[0]!.declares).toBe("result-shape");
		expect(suites[0]!.runner).toBe("ShapeOnlyConformanceResult");
	});

	it("keeps the result shape quiet when the package also has a runner", () => {
		workspace = createFixtureWorkspace([
			{
				name: "@fixture/both",
				dir: "both",
				files: {
					"src/types.mjs": "export const marker = 'BothConformanceResult';\n",
					"src/conformance.mjs": SUITE_SOURCE,
				},
			},
		]);
		expect(discoverConformanceSuites(workspace.root).map((suite) => suite.declares)).toEqual([
			"runner",
		]);
	});
});

describe("the workspace itself", () => {
	it("maps a TS source onto the artifact Node can load, and leaves JS alone", () => {
		workspace = createFixtureWorkspace([
			{ name: "@fixture/mapped", dir: "mapped", files: { "src/a.ts": "" }, buildable: true },
		]);
		const pkg = workspacePackages(workspace.root)[0]!;
		expect(moduleFor(pkg, path.join(pkg.dir, "src", "sdk", "a.ts"))).toBe(
			path.join(pkg.dir, "dist", "sdk", "a.js"),
		);
		expect(moduleFor(pkg, path.join(pkg.dir, "vendor", "copy.mjs"))).toBe(
			path.join(pkg.dir, "vendor", "copy.mjs"),
		);
		expect(pkg.buildable).toBe(true);
	});

	it("answers null outside a workspace instead of guessing", () => {
		expect(findWorkspaceRoot(path.parse(process.cwd()).root)).toBeNull();
	});

	it("finds this repository from its own package directory", () => {
		const root = findWorkspaceRoot(path.resolve(__dirname, ".."));
		expect(root).not.toBeNull();
		expect(workspacePackages(root!).map((pkg) => pkg.name)).toContain("@refarm.dev/hardening");
	});
});
