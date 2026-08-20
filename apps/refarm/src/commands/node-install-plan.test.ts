import { describe, expect, it } from "vitest";

import {
	installedTreePath,
	installVersionLabel,
	shimScript,
	verificationVerdict,
} from "./node-install-plan.js";

/**
 * The pure half of `refarm node install` — assemble, verify, repoint, roll back.
 *
 * Every decision here was made by hand on the operator's node on 2026-08-19 and is written down
 * so the next one is not. The impure half (spawning `pnpm deploy`, running the tree, writing the
 * shim through the consent journey) lives beside this and owns no decisions.
 */
describe("installVersionLabel", () => {
	it("pairs the declared version with the commit it was built from", () => {
		// Two installs of "0.1.0" from different commits are different trees, and an operator
		// rolling back has to be able to tell them apart in a directory listing.
		expect(installVersionLabel("0.1.0", "28b82de9")).toBe("0.1.0-28b82de9");
	});

	it("stands alone when there is no commit to name", () => {
		// An install from a tarball has no commit. Inventing one would make a label that looks
		// traceable and is not.
		expect(installVersionLabel("0.1.0", null)).toBe("0.1.0");
		expect(installVersionLabel("0.1.0", "  ")).toBe("0.1.0");
	});
});

describe("installedTreePath", () => {
	it("installs BESIDE the launcher, never inside the sovereign directory", () => {
		// `~/.refarm` is what `backup plan` walks. 434MB of code there would land as `undecidable`
		// and take the whole backup plan back to "not yet trustworthy" — measured this session.
		const target = installedTreePath("/home/op", "0.1.0-abc");
		expect(target).toBe("/home/op/.local/lib/refarm/0.1.0-abc");
		expect(target).not.toContain("/.refarm/");
	});
});

describe("shimScript", () => {
	it("execs the installed entrypoint with the interpreter that is running", () => {
		const script = shimScript({
			node: "/usr/bin/node",
			entrypoint: "/home/op/.local/lib/refarm/0.1.0-abc/dist/index.js",
			shimPath: "/home/op/.local/bin/refarm",
		});
		expect(script).toContain('exec "/usr/bin/node" "/home/op/.local/lib/refarm/0.1.0-abc/dist/index.js" "$@"');
	});

	it("exports REFARM_COMMAND, which is how the node names itself in a unit file", () => {
		// `deriveRefarmInvocation` reads it first, so a supervised process keeps pointing at the
		// launcher rather than at whichever build was current when it was declared.
		const script = shimScript({
			node: "/usr/bin/node",
			entrypoint: "/x/dist/index.js",
			shimPath: "/home/op/.local/bin/refarm",
		});
		expect(script).toContain('export REFARM_COMMAND="/home/op/.local/bin/refarm"');
	});

	it("says how to roll back, in the file itself", () => {
		// The operator reads this file at the moment something is wrong, and that is the moment a
		// rollback command is worth the two lines it costs.
		expect(
			shimScript({ node: "/usr/bin/node", entrypoint: "/x/dist/index.js", shimPath: "/s/refarm" }),
		).toMatch(/rollback|\.previous/iu);
	});

	it("fails on error rather than continuing past a broken exec", () => {
		expect(shimScript({ node: "/n", entrypoint: "/x", shimPath: "/s" })).toContain("set -euo pipefail");
	});
});

describe("verificationVerdict", () => {
	it("passes only when the assembled tree ANSWERED", () => {
		// The step that separates an install from a hope. An assemble that reports success without
		// running what it assembled is the shape of backup that fails on the day it is needed.
		expect(verificationVerdict({ status: 0, stdout: "0.1.0\n" }).ok).toBe(true);
	});

	it("fails on a non-zero exit, and carries what it said", () => {
		const verdict = verificationVerdict({ status: 1, stdout: "", stderr: "Cannot find module 'x'" });
		expect(verdict.ok).toBe(false);
		expect(verdict.because).toContain("Cannot find module 'x'");
	});

	it("fails on a zero exit that printed NOTHING", () => {
		// Exit 0 with no output is not an answer. A tree that runs and says nothing has not been
		// shown to work, and calling that verified is the failure this whole step exists to stop.
		expect(verificationVerdict({ status: 0, stdout: "   " }).ok).toBe(false);
	});

	it("fails when the process could not be started at all", () => {
		expect(verificationVerdict({ status: null, stdout: "" }).ok).toBe(false);
	});
});
