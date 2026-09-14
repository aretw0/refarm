/**
 * PINS THE SUITE-WIDE FS WRITE GUARD, DEFINED IN vitest.setup.ts.
 *
 * `pnpm --filter @refarm.dev/refarm run test` was measured rewriting the
 * operator's REAL `~/.refarm/session.lock`. The fix (vitest.setup.ts) points
 * `HOME`/`REFARM_HOME`/`XDG_*` at a throwaway directory, hoisted before any test
 * file's own imports run, and wraps every mutating `node:fs` entry point so a
 * write outside that throwaway tree throws instead of landing on disk.
 *
 * A guard that can never go red is decoration. This file proves it can: a
 * fixture deliberately writes outside the sandbox and this test asserts THAT
 * throws — mirroring the same pin already established for the CLI refusal
 * guard in test/architecture/cli-refusal-conformance.test.ts ("the harness
 * itself" describe block, commit 8c31e8f5). It does not re-declare its own
 * sandbox or its own `vi.mock("node:fs", ...)` — vitest.setup.ts's guard is
 * already live for every test file in this suite, this one included, so the
 * plain `node:fs` import below already resolves to the guarded module.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("suite-wide test-home sandbox (vitest.setup.ts)", () => {
	it("redirects HOME, REFARM_HOME, and XDG_* into the OS temp dir, not the operator's real home", () => {
		const tmpRoot = fs.realpathSync(os.tmpdir());
		for (const key of [
			"HOME",
			"USERPROFILE",
			"REFARM_HOME",
			"XDG_CONFIG_HOME",
			"XDG_DATA_HOME",
			"XDG_CACHE_HOME",
			"XDG_STATE_HOME",
		] as const) {
			const value = process.env[key];
			expect(value, `${key} must be set by the suite-wide sandbox`).toBeTruthy();
			const resolved = path.resolve(value as string);
			expect(
				resolved === tmpRoot || resolved.startsWith(`${tmpRoot}${path.sep}`),
				`${key}=${value} must resolve under the OS temp dir (${tmpRoot}), not a real home`,
			).toBe(true);
		}
	});

	it("refuses a write outside the sandbox — naming the path and throwing SandboxEscape", () => {
		// A deliberately-offending fixture: a path that is definitely NOT under the OS
		// temp dir (the sandbox's allowed root) — genuinely writable by this process
		// (inside the repo checkout), so a disabled guard would actually succeed here
		// rather than fail for an unrelated OS permission reason. That distinction
		// matters for mutation-verification (see the report): a path this test's
		// operator account cannot write to anyway would "pass" with or without the
		// guard, proving nothing.
		const escapePath = path.join(process.cwd(), "refarm-guard-fixture-escape.txt");

		// No cleanup needed here: with the guard live, the write below never reaches
		// disk, so there is nothing to remove — and rmSync on this same escapePath
		// would itself be refused by the guard (it checks the path, not whether
		// anything exists there yet), which would mask the assertions below inside a
		// `finally`. If this ever needs cleanup, that is itself a guard failure.
		let thrown: unknown;
		try {
			fs.writeFileSync(escapePath, "this must never land on disk");
		} catch (error) {
			thrown = error;
		}

		expect(thrown, "the guard must throw for a write outside the sandbox").toBeInstanceOf(Error);
		expect((thrown as Error).name).toBe("SandboxEscape");
		expect((thrown as Error).message).toContain(escapePath);
		expect(fs.existsSync(escapePath), "the offending write must never have landed on disk").toBe(
			false,
		);
	});

	it("still allows a write genuinely inside the sandbox (the OS temp dir)", () => {
		const tmpRoot = fs.realpathSync(os.tmpdir());
		const insidePath = path.join(tmpRoot, `refarm-guard-fixture-allowed-${process.pid}.txt`);
		try {
			fs.writeFileSync(insidePath, "ok");
			expect(fs.readFileSync(insidePath, "utf-8")).toBe("ok");
		} finally {
			fs.rmSync(insidePath, { force: true });
		}
	});

	it("does not mistake a string DATA argument for a path (writeFileSync(path, data))", () => {
		// Regression pin: an earlier version of this guard checked BOTH of
		// writeFileSync's first two arguments as candidate paths, so a plain string
		// payload (not a path at all) was misidentified as an escape and every
		// ordinary write in the suite failed. Only argument 0 is a path here.
		const tmpRoot = fs.realpathSync(os.tmpdir());
		const insidePath = path.join(tmpRoot, `refarm-guard-fixture-data-${process.pid}.txt`);
		try {
			expect(() => fs.writeFileSync(insidePath, "not a path, just content")).not.toThrow();
		} finally {
			fs.rmSync(insidePath, { force: true });
		}
	});
});
