/**
 * A THROWAWAY WORKSPACE, for proving the collector against suites that did not exist when it was
 * written.
 *
 * Discovery's whole claim is that it finds suites it was never told about. A test that asserts
 * against the 26 suites already in this repo cannot prove that — they were all present while the
 * scanner was being written. So the tests build a workspace under the OS temp directory, put a
 * conformance suite in it that exists nowhere else, and check that the collector finds and runs it.
 *
 * It lives in `src/` rather than in a `fixtures/` directory on purpose: a fixture directory holding
 * a deliberately-failing suite inside a real workspace package would be discovered by the real scan
 * and would pollute the real signal. Nothing here is written until a test calls `createFixtureWorkspace`,
 * and everything it writes is under `os.tmpdir()`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface FixturePackage {
	/** Package name, e.g. `@fixture/task-contract`. */
	name: string;
	/** Directory under `packages/`. */
	dir: string;
	/** Files to write, relative to the package directory. */
	files: Record<string, string>;
	/** Extra `package.json` fields (`exports`, `main`, …). */
	manifest?: Record<string, unknown>;
	/** Write a `tsconfig.build.json`, making the package TS-strict (CLAUDE.md §5). */
	buildable?: boolean;
}

export interface FixtureWorkspace {
	root: string;
	dispose: () => void;
}

export function createFixtureWorkspace(packages: readonly FixturePackage[]): FixtureWorkspace {
	const root = mkdtempSync(path.join(tmpdir(), "refarm-hardening-fixture-"));
	writeFileSync(path.join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n', "utf8");
	for (const pkg of packages) {
		const dir = path.join(root, "packages", pkg.dir);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			path.join(dir, "package.json"),
			`${JSON.stringify({ name: pkg.name, version: "0.0.0", type: "module", ...pkg.manifest }, null, 2)}\n`,
			"utf8",
		);
		if (pkg.buildable) {
			writeFileSync(path.join(dir, "tsconfig.build.json"), "{}\n", "utf8");
		}
		for (const [relative, contents] of Object.entries(pkg.files)) {
			const file = path.join(dir, relative);
			mkdirSync(path.dirname(file), { recursive: true });
			writeFileSync(file, contents, "utf8");
		}
	}
	return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
