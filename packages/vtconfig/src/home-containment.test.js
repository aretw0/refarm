import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// THE REAL `node:fs`, deliberately in its own file: `index.test.js` mocks it, and a guard tested
// against a mock proves nothing about what a test can actually write.
describe("the containment's own guard", () => {
	/**
	 * THE GUARD NEEDS A GUARD, and this is the test that would have caught the incident it exists
	 * to prevent.
	 *
	 * Measured 2026-08-12: `~/.silo/identity.json` on the operator's node carried
	 * `__refarm_ancestor_option_probe__` in `modelId`, `modelFallbackModelId` and `modelBaseUrl` —
	 * a sentinel that exists in exactly one place in this repository, a conformance TEST. A test
	 * had written its probe value into the operator's real model route, and `refarm model current`
	 * had been reporting it as his configured model ever since.
	 *
	 * The containment landed after that (the file's mtime is 08-11 01:31, before the guard), and
	 * the guard does hold now — but nothing asserted that it holds, so the next config change that
	 * dropped it would have gone unnoticed exactly as this one did.
	 *
	 * ISS-109 was written about `~/.refarm/config.json`. The damage here was in `~/.silo`, a
	 * SECOND store nobody had thought to check. Both are reached through HOME, which is why
	 * redirecting HOME — rather than blocklisting known paths — was the right shape.
	 */
	it("points HOME somewhere disposable, never at the operator's own", () => {
		// The whole mechanism in one assertion: if HOME still pointed at a real home, every
		// `os.homedir()`-derived path in 3300 tests would be writing into it.
		expect(process.env.HOME).toBeTruthy();
		expect(process.env.HOME).toContain(tmpdir());
	});

	it("REFUSES a write to a literal home path outside the contained tree", () => {
		// Not `os.homedir()` — that resolves to the CONTAINED home and is writable by design, and
		// reading its success as an escape is how this check was first got wrong. The literal path
		// is the only one that distinguishes containment from redirection.
		const outside = path.join("/", "home", "__refarm_containment_guard__", "probe");
		expect(() => fs.writeFileSync(outside, "x")).toThrow();
	});

	it("still allows the contained home, or every suite that writes state would fail", () => {
		const inside = path.join(process.env.HOME ?? tmpdir(), ".containment-self-check");
		fs.writeFileSync(inside, "x");
		expect(fs.readFileSync(inside, "utf8")).toBe("x");
		fs.rmSync(inside, { force: true });
	});
});

