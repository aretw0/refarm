import { afterEach, beforeEach, describe, expect, it } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { refarmSearchDirs } from "../../src/commands/session-launch.js";

/**
 * The credential-readiness gate must look where the credential actually IS.
 *
 * `refarm sow` stores an OAuth model credential through Silo, which writes
 * `identity.json` under `resolveSiloHome()` — `SILO_HOME || REFARM_HOME ||
 * ~/.silo`. The readiness gate searched only `resolveRefarmHome()` and
 * `<cwd>/.refarm`, so on any machine where `REFARM_HOME` is unset the store
 * lands in `~/.silo` and is invisible: `refarm model current` reports
 * `silo-oauth` (it loads Silo directly) while `refarm ask` refuses with "No
 * usable model credentials configured", and re-running `sow` never helps
 * because `sow` writes exactly where the gate is not looking.
 *
 * The bug is environment-dependent — with `REFARM_HOME` set, Silo's home and
 * refarm's home are the same directory and the gate happens to work — which is
 * why it survived. These tests pin both homes explicitly so the machine's own
 * configuration cannot mask either case.
 */
describe("the credential search covers Silo's home", () => {
	let siloHome: string;
	let refarmHome: string;
	const savedSiloHome = process.env.SILO_HOME;
	const savedRefarmHome = process.env.REFARM_HOME;

	beforeEach(() => {
		siloHome = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-silo-"));
		refarmHome = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-home-"));
	});

	afterEach(() => {
		if (savedSiloHome === undefined) delete process.env.SILO_HOME;
		else process.env.SILO_HOME = savedSiloHome;
		if (savedRefarmHome === undefined) delete process.env.REFARM_HOME;
		else process.env.REFARM_HOME = savedRefarmHome;
		fs.rmSync(siloHome, { recursive: true, force: true });
		fs.rmSync(refarmHome, { recursive: true, force: true });
	});

	it("searches Silo's home when it differs from refarm's home", () => {
		// The failing configuration in the wild: REFARM_HOME unset, so Silo lands
		// in its own directory that the gate never looked at.
		process.env.SILO_HOME = siloHome;
		process.env.REFARM_HOME = refarmHome;

		const dirs = refarmSearchDirs();
		expect(dirs).toContain(siloHome);
		expect(dirs).toContain(refarmHome);
	});

	it("lists the shared directory once when Silo and refarm resolve to the same home", () => {
		// The configuration where the bug was invisible: one directory, and it must
		// not be searched twice.
		process.env.REFARM_HOME = refarmHome;
		delete process.env.SILO_HOME;

		const dirs = refarmSearchDirs();
		expect(dirs.filter((dir) => dir === refarmHome)).toHaveLength(1);
	});

	it("keeps searching refarm's home and the working directory", () => {
		// The fix must ADD a place to look, never replace the existing ones.
		process.env.SILO_HOME = siloHome;
		process.env.REFARM_HOME = refarmHome;

		expect(refarmSearchDirs()).toContain(path.join(process.cwd(), ".refarm"));
	});
});
