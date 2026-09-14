/**
 * AUTOMATIC BASELINE CAPTURE MUST BE IMPOSSIBLE, NOT MERELY DISCOURAGED.
 *
 * "Adding an entry to the baseline must be an explicit, reviewable act — a deliberate edit, never
 * an automatic capture. Auto-capture turns the baseline into a mute button, and a mute button is
 * worse than no check because it looks like coverage."
 *
 * A comment saying so protects nothing: the next person under deadline adds `--update-baseline`,
 * every red run goes green, and the ratchet becomes decoration that reads as coverage. So the rule
 * is asserted against the SOURCE, from three directions at once — no write path in the shipped
 * package, no writer on its public surface, and no option on the command that would call one.
 *
 * These assertions are what a mutation test would drive: adding `writeFileSync` to any shipped
 * module, exporting a `writeHardeningBaseline`, or declaring `--update-baseline` on the command
 * each turns exactly one of them red.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as hardening from "./index.js";

const SRC = __dirname;
const APP_COMMAND = path.resolve(SRC, "../../../apps/refarm/src/commands/hardening.ts");

/** Everything `tsconfig.build.json` compiles: the code that actually ships and runs. Tests and
 *  test-kits are excluded from the build and from this rule — the testkit writes a throwaway
 *  workspace under `os.tmpdir()`, and `index.ts` is asserted below not to re-export it. */
function shippedSources(dir: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(dir)) {
		const target = path.join(dir, name);
		if (statSync(target).isDirectory()) {
			files.push(...shippedSources(target));
			continue;
		}
		if (!/\.ts$/.test(name)) continue;
		if (/\.test\.ts$|\.testkit\.ts$/.test(name)) continue;
		files.push(target);
	}
	return files;
}

/** Every Node API that can create or change a file. A writer has to use one of them. */
const WRITE_API =
	/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|mkdtemp|mkdtempSync|rm|rmSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|truncate|truncateSync|open|openSync|writev|writevSync|write)\s*\(/;

/** A name that offers to record the current state for you. */
const CAPTURE_NAME = /(?:write|update|capture|accept|bless|record|snapshot|save|regenerate|refresh)/i;

describe("the baseline cannot be captured automatically", () => {
	it("no shipped module in this package can write a file at all", () => {
		const offenders = shippedSources(SRC)
			.filter((file) => WRITE_API.test(readFileSync(file, "utf8")))
			.map((file) => path.relative(SRC, file));
		expect(
			offenders,
			"a hardening module gained a write path — the baseline must stay a hand-edited file",
		).toEqual([]);
	});

	it("imports nothing from node:fs but readers", () => {
		for (const file of shippedSources(SRC)) {
			for (const match of readFileSync(file, "utf8").matchAll(
				/import\s*\{([^}]*)\}\s*from\s*"node:fs(?:\/promises)?"/g,
			)) {
				const imported = (match[1] ?? "").split(",").map((name) => name.trim()).filter(Boolean);
				expect(imported.sort()).toEqual(
					imported.filter((name) => /^(?:read|stat|exists|access|realpath|opendir)/.test(name)).sort(),
				);
			}
		}
	});

	it("exports no writer on its public surface", () => {
		const capturers = Object.keys(hardening).filter(
			(name) => CAPTURE_NAME.test(name) && /baseline/i.test(name),
		);
		expect(capturers).toEqual([]);
		// The baseline round-trip is deliberately half a trip: it can be read, and that is all.
		expect(typeof hardening.readHardeningBaseline).toBe("function");
	});

	it("the command declares no option that would record the current state", () => {
		const source = readFileSync(APP_COMMAND, "utf8");
		const options = [...source.matchAll(/\.option\(\s*"(--[\w-]+)/g)].map((match) => match[1]!);
		expect(options.length).toBeGreaterThan(0);
		expect(options.filter((flag) => CAPTURE_NAME.test(flag))).toEqual([]);
		expect(WRITE_API.test(source)).toBe(false);
	});

	it("does not re-export the test-kit that can write", () => {
		const index = readFileSync(path.join(SRC, "index.ts"), "utf8");
		expect(index).not.toContain("testkit");
	});
});
