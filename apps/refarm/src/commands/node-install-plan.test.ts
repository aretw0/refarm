import { describe, expect, it } from "vitest";

import {
	checkoutDirtiness,
	independenceVerdict,
	installedTreePath,
	installVersionLabel,
	shimScript,
	verificationVerdict,
	workspaceMaterializations,
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

	it("says -dirty when the tree carried changes that commit does not have (ISS-158)", () => {
		// MEASURED 2026-08-22, on the install that fixed the coupling. The tree filed under
		// `0.1.0-c58ae2ba` carried `materializeWorkspacePackages`, a symbol c58ae2ba does not
		// contain — because the label comes from `git HEAD` and the tree comes from the working
		// tree's `dist/`. The label promised a traceability it did not have, which is worse than
		// promising none: it invites the trust it cannot carry.
		expect(installVersionLabel("0.1.0", "c58ae2ba", true)).toBe("0.1.0-c58ae2ba-dirty");
		expect(installVersionLabel("0.1.0", "c58ae2ba", false)).toBe("0.1.0-c58ae2ba");
	});

	it("has nothing to qualify when there is no commit — dirty against WHAT?", () => {
		// `-dirty` is a statement about a difference from a named commit. With no commit named,
		// it would decorate a label that already claims nothing.
		expect(installVersionLabel("0.1.0", null, true)).toBe("0.1.0");
	});
});

describe("checkoutDirtiness", () => {
	it("is clean only when git ANSWERED and had nothing to report", () => {
		expect(checkoutDirtiness({ status: 0, stdout: "" })).toMatchObject({ dirty: false });
		expect(checkoutDirtiness({ status: 0, stdout: "\n  \n" })).toMatchObject({ dirty: false });
	});

	it("is dirty when git listed anything, and names how much", () => {
		const verdict = checkoutDirtiness({ status: 0, stdout: " M a.ts\n?? b.ts\n" });
		expect(verdict.dirty).toBe(true);
		expect(verdict.because).toContain("2");
	});

	it("COLLAPSES 'could not tell' into dirty, deliberately, and says which it was", () => {
		// The asymmetry is the whole decision. Marking a dirty tree clean is a false assurance that
		// travels into a label an operator rolls back by; marking a clean tree dirty is only an
		// alarm. This repository already chose that side once, for the install that reports success
		// without running what it installed.
		const unreadable = checkoutDirtiness({ status: 128, stdout: "" });
		expect(unreadable.dirty).toBe(true);
		expect(unreadable.because).toContain("could not");

		const unspawnable = checkoutDirtiness({ status: null, stdout: "" });
		expect(unspawnable.dirty).toBe(true);
		expect(unspawnable.because).toContain("could not");
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

describe("workspaceMaterializations", () => {
	it("picks the packages materialized from a workspace PATH, and leaves the registry alone", () => {
		// Measured on the operator's node 2026-08-22: 443 directories under `.pnpm`, of which 77
		// carry `@file+` — pnpm's own encoding of "this came from a path in the workspace, not
		// from a registry". Those 77 are the ones hardlinked back to the checkout, and the only
		// ones worth copying: a registry tarball is content-addressed and nothing rewrites it.
		expect(
			workspaceMaterializations([
				"@refarm.dev+model-account-contract-v1@file+packages+model-account-contract-v1",
				"chalk@5.3.0",
				"@refarm.dev+attend-web-v1@file+packages+attend-web-v1",
				"acorn@8.17.0",
			]),
		).toEqual([
			"@refarm.dev+model-account-contract-v1@file+packages+model-account-contract-v1",
			"@refarm.dev+attend-web-v1@file+packages+attend-web-v1",
		]);
	});

	it("finds the separator even when the peer-dependency suffix carries its own `@`", () => {
		// MEASURED ON THE REAL TREE 2026-08-22, after the first version of this shipped and did not
		// work. pnpm appends a peer hash to a package that has peers, and that suffix contains
		// scoped names — so the LAST `@` is inside `@types+nod_...`, not the separator. 1081 files
		// stayed hardlinked to the checkout while the install reported itself independent, and only
		// a measurement outside the tool found it. The separator is the FIRST `@` past a scope.
		expect(
			workspaceMaterializations([
				"@refarm.dev+cli@file+packages+cli_@emnapi+core@1.11.1_@emnapi+runtime@1.11.1_@types+nod_f284c20f",
				"@types+node@25.9.4",
			]),
		).toEqual([
			"@refarm.dev+cli@file+packages+cli_@emnapi+core@1.11.1_@emnapi+runtime@1.11.1_@types+nod_f284c20f",
		]);
	});

	it("is not fooled by a registry package whose NAME contains the marker", () => {
		// `file+` is a substring, and a package may legitimately be called this. The marker is the
		// separator between name and reference — anything else is a name that happens to read alike.
		expect(workspaceMaterializations(["file-type@19.0.0", "@scope+file+util@2.0.0"])).toEqual([]);
	});
});

describe("independenceVerdict", () => {
	it("passes only when NOTHING in the tree is still shared with the checkout", () => {
		expect(independenceVerdict({ shared: [] })).toMatchObject({ ok: true });
	});

	it("refuses a tree that still shares a file with the checkout, and names one", () => {
		// THE DEFECT THIS EXISTS FOR, measured on the operator's node 2026-08-22. `pnpm deploy`
		// hardlinks workspace packages, so the "self-contained" tree shared inodes with
		// `packages/<pkg>/dist`. A `tsc` run at 00:58 rewrote an installed file in place; the node
		// began importing a module that did not exist in its own tree; and it stayed alive until
		// a reboot 33 hours later, when every unit died at once. No flag prevents it —
		// `package-import-method=copy`, the env var, and `inject-workspace-packages` were each
		// measured hardlinking anyway.
		const verdict = independenceVerdict({
			shared: [
				{ path: "node_modules/.pnpm/@refarm.dev+x@file+packages+x/node_modules/x/dist/index.js" },
			],
		});
		expect(verdict.ok).toBe(false);
		expect(verdict.because).toContain("dist/index.js");
	});

	it("counts what it found, so the operator sees scale rather than one example", () => {
		const verdict = independenceVerdict({
			shared: [{ path: "a.js" }, { path: "b.js" }, { path: "c.js" }],
		});
		expect(verdict.because).toContain("3");
	});
});
