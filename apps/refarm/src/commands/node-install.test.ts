/**
 * What happens to THE LAUNCHER — the only part of an install that can leave an operator with no
 * working CLI. The assembling is stubbed on purpose: this file exists to prove the file the
 * operator's shell resolves, not to re-measure `pnpm deploy`.
 *
 * The verdict logic itself is proven next door in `node-install-plan.test.ts`, pure. What is only
 * provable here is the ORDER: a tree that fails verification must leave the launcher exactly as it
 * was, because the alternative is a node that cannot run the command that would fix it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { digestTree, SOURCE_STAMP } from "./node-install-freshness.js";
import {
	InstalledNodeIdentity,
	NODE_IDENTITY_FILE,
} from "./node-install-plan.js";
import { materializeWorkspacePackages, runNodeInstall, sharedWithCheckout } from "./node-install.js";

/** The same 8-char prefix `runNodeInstall` files the tree under, computed the identical way
 *  (`digestTree` over `apps/refarm/src`) so a fixture never hardcodes a hash literal that would
 *  silently stop matching if `fakeCheckout`'s content ever changed. */
function srcDigestOf(repoRoot: string): string {
	return (digestTree(path.join(repoRoot, "apps", "refarm", "src")) ?? "").slice(0, 8);
}

/** The FULL digest — never truncated — the same function the label's own 8-char prefix comes
 *  from. Used to prove the install RECORD carries the whole thing, distinct from the label. */
function fullSrcDigestOf(repoRoot: string): string {
	return digestTree(path.join(repoRoot, "apps", "refarm", "src")) ?? "";
}

/** A checkout shaped enough for the install to read a version and resolve pnpm.
 *
 * Also stamped FRESH: this file exists to prove what happens to the launcher, not to
 * re-prove `node-install-freshness.test.ts`'s guard, so every fixture here carries a `dist`
 * whose stamp matches its `src` — the same digest the guard itself computes, not a
 * hand-picked string it happens to accept. */
function fakeCheckout(name: string): string {
	const root = path.join(os.homedir(), name);
	const srcDir = path.join(root, "apps", "refarm", "src");
	const distDir = path.join(root, "apps", "refarm", "dist");
	fs.mkdirSync(srcDir, { recursive: true });
	fs.mkdirSync(distDir, { recursive: true });
	fs.writeFileSync(path.join(srcDir, "index.ts"), "export const marker = 1;\n");
	fs.writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({ name: "root", packageManager: "pnpm@10.0.0" }),
	);
	fs.writeFileSync(
		path.join(root, "apps", "refarm", "package.json"),
		JSON.stringify({ name: "@refarm.dev/refarm", version: "9.9.9" }),
	);
	fs.writeFileSync(path.join(distDir, SOURCE_STAMP), digestTree(srcDir) ?? "");
	return root;
}

/** A runner that answers each step by id, and records what it was asked to do. */
function runnerFor(answers: Record<string, { exitCode: number | null; stdout?: string }>) {
	const seen: string[] = [];
	const run = (spec: { id: string }) => {
		seen.push(spec.id);
		const answer = answers[spec.id] ?? { exitCode: 0, stdout: "" };
		return { exitCode: answer.exitCode, stdout: answer.stdout ?? "", stderr: "" };
	};
	return { run, seen };
}

describe("refarm node install", () => {
	it("repoints the launcher, keeps the previous one, and records an undo", async () => {
		const repoRoot = fakeCheckout("checkout-happy");
		const home = path.join(os.homedir(), "node-happy");
		const shimPath = path.join(home, ".local", "bin", "refarm");
		fs.mkdirSync(path.dirname(shimPath), { recursive: true });
		fs.writeFileSync(shimPath, "#!/bin/sh\nexec node /somewhere/old/index.js \"$@\"\n");

		const { run, seen } = runnerFor({
			"git-head": { exitCode: 0, stdout: "abc1234\n" },
			verify: { exitCode: 0, stdout: "9.9.9\n" },
		});
		const result = await runNodeInstall({}, { repoRoot, home, shimPath, run, announce: () => {} });

		expect(result.status).toBe("installed");
		// It ran what it assembled BEFORE it repointed anything — and it put the checkout's
		// dependency status back straight after assembling, which `deploy --legacy` leaves stale.
		expect(seen).toEqual(["git-head", "git-status", "assemble", "resync", "verify"]);
		if (result.status === "installed") expect(result.checkout.status).toBe("restored");
		if (result.status !== "installed") return;
		expect(result.tree).toContain("9.9.9-abc1234");

		// The launcher now names the installed tree, and the old one survives beside it.
		expect(fs.readFileSync(shimPath, "utf-8")).toContain(result.tree);
		expect(fs.readFileSync(`${shimPath}.previous`, "utf-8")).toContain("/somewhere/old/index.js");
		expect(fs.statSync(shimPath).mode & 0o111).toBeGreaterThan(0);

		// And the change is remembered, with the before-state an undo can restore.
		const trail = JSON.parse(
			fs.readFileSync(path.join(home, ".refarm", "node", "operations.json"), "utf-8"),
		) as {
			records: {
				id: string;
				decision: string;
				changes: { before: string | null }[];
				undo: { kind: string };
			}[];
		};
		const record = trail.records.find((entry) => entry.id === result.recordId);
		expect(record?.decision).toBe("authorized");
		expect(record?.changes[0]?.before).toContain("/somewhere/old/index.js");
		expect(record?.undo.kind).toBe("restore-snapshot");
	});

	it("makes the tree independent of the checkout BEFORE it runs or repoints anything", async () => {
		// THE DEFECT THIS ORDER EXISTS FOR, measured on the operator's node 2026-08-22. The install
		// verified a tree that was hardlinked to `packages/<pkg>/dist`, so a later `tsc` rewrote an
		// installed file in place, the node began importing a module missing from its own tree, and
		// nothing said so until a reboot 33 hours later killed every unit at once.
		const repoRoot = fakeCheckout("checkout-coupled");
		const home = path.join(os.homedir(), "node-coupled");
		const built = path.join(repoRoot, "packages", "x", "dist", "index.js");
		fs.mkdirSync(path.dirname(built), { recursive: true });
		fs.writeFileSync(built, "export const built = 1;\n");

		const tree = path.join(home, ".local", "lib", "refarm", `9.9.9-abc1234-${srcDigestOf(repoRoot)}`);
		const installed = path.join(
			tree, "node_modules", ".pnpm", "@refarm.dev+x@file+packages+x",
			"node_modules", "@refarm.dev", "x", "dist", "index.js",
		);
		const seen: string[] = [];
		let sharedAtVerify: boolean | null = null;
		const run = (spec: { id: string }) => {
			seen.push(spec.id);
			if (spec.id === "assemble") {
				// Stands in for `pnpm deploy`, which hardlinks rather than copies.
				fs.mkdirSync(path.dirname(installed), { recursive: true });
				fs.linkSync(built, installed);
			}
			if (spec.id === "verify") {
				sharedAtVerify = fs.statSync(installed).ino === fs.statSync(built).ino;
			}
			if (spec.id === "git-status") return { exitCode: 0, stdout: "", stderr: "" };
			return { exitCode: 0, stdout: spec.id === "git-head" ? "abc1234\n" : "9.9.9\n", stderr: "" };
		};

		const result = await runNodeInstall({}, { repoRoot, home, run, announce: () => {} });

		expect(result.status).toBe("installed");
		// Independent by the time it was RUN — not merely by the time the command returned.
		expect(sharedAtVerify).toBe(false);
		expect(fs.statSync(installed).ino).not.toBe(fs.statSync(built).ino);
		expect(fs.readFileSync(installed, "utf-8")).toBe("export const built = 1;\n");
		expect(seen).toEqual(["git-head", "git-status", "assemble", "resync", "verify"]);
	});

	it("refuses, and leaves the launcher alone, when the tree is still coupled to the checkout", async () => {
		// The materialiser picks packages by name and can be wrong about a name — it was, on
		// 2026-08-22. This is what happens when it is: the install stops instead of handing the
		// operator a node that a later build would rewrite underneath.
		const repoRoot = fakeCheckout("checkout-refuses");
		const home = path.join(os.homedir(), "node-refuses");
		const shimPath = path.join(home, ".local", "bin", "refarm");
		fs.mkdirSync(path.dirname(shimPath), { recursive: true });
		fs.writeFileSync(shimPath, "#!/bin/sh\nexec node /somewhere/old/index.js \"$@\"\n");
		const built = path.join(repoRoot, "packages", "x", "dist", "index.js");
		fs.mkdirSync(path.dirname(built), { recursive: true });
		fs.writeFileSync(built, "export const built = 1;\n");

		const tree = path.join(home, ".local", "lib", "refarm", `9.9.9-abc1234-${srcDigestOf(repoRoot)}`);
		const run = (spec: { id: string }) => {
			if (spec.id === "assemble") {
				// A shape the selection rule does not recognise — so the copying step skips it.
				const dir = path.join(tree, "node_modules", ".pnpm", "unrecognised", "node_modules", "x");
				fs.mkdirSync(dir, { recursive: true });
				fs.linkSync(built, path.join(dir, "index.js"));
			}
			if (spec.id === "git-status") return { exitCode: 0, stdout: "", stderr: "" };
			return { exitCode: 0, stdout: spec.id === "git-head" ? "abc1234\n" : "9.9.9\n", stderr: "" };
		};

		const result = await runNodeInstall({}, { repoRoot, home, shimPath, run, announce: () => {} });

		expect(result.status).toBe("refused");
		if (result.status === "refused") expect(result.because).toContain("share storage");
		// The launcher is untouched — the node keeps whatever was working before this ran.
		expect(fs.readFileSync(shimPath, "utf-8")).toContain("/somewhere/old/index.js");
	});

	it("leaves the tree carrying its own identity, dirt included (ISS-158)", async () => {
		// The label alone could not say this. A tree filed under `0.1.0-c58ae2ba` may hold anything
		// that was uncommitted when it was assembled, and months later nothing on disk remembers
		// which. This is what `refarm health` will read to say which build a node executes.
		const repoRoot = fakeCheckout("checkout-identity");
		const home = path.join(os.homedir(), "node-identity");
		const { run } = runnerFor({
			"git-head": { exitCode: 0, stdout: "abc1234\n" },
			"git-status": { exitCode: 0, stdout: " M apps/refarm/src/commands/node-install.ts\n" },
			verify: { exitCode: 0, stdout: "9.9.9\n" },
		});
		const result = await runNodeInstall(
			{},
			{ repoRoot, home, run, announce: () => {}, now: () => "2026-08-23T03:00:00.000Z" },
		);

		expect(result.status).toBe("installed");
		if (result.status !== "installed") return;
		const expectedLabel = `9.9.9-abc1234-${srcDigestOf(repoRoot)}-dirty`;
		expect(result.tree).toContain(expectedLabel);

		const identity = JSON.parse(
			fs.readFileSync(path.join(result.tree, NODE_IDENTITY_FILE), "utf-8"),
		) as InstalledNodeIdentity;
		expect(identity).toMatchObject({
			label: expectedLabel,
			version: "9.9.9",
			commit: "abc1234",
			installedAt: "2026-08-23T03:00:00.000Z",
			// WHICH checkout that commit belongs to. Without it, a `refarm health` run from a
			// different repository would compare this node's commit against THAT repository's HEAD
			// and produce a confident sentence about two unrelated histories.
			repository: repoRoot,
		});
		expect(identity.checkout.dirty).toBe(true);
		// WHICH kind of dirty, not merely that it was — "one file changed" and "git would not
		// answer" are different facts about how much this label can be trusted.
		expect(identity.checkout.because).toContain("1 uncommitted");

		// THE FULL DIGEST, not just the label's 8-hex-char prefix — two trees whose digests
		// differ only past that prefix are otherwise indistinguishable in this record.
		const fullDigest = fullSrcDigestOf(repoRoot);
		expect(identity.contentDigest).toBe(fullDigest);
		expect(identity.contentDigest?.length).toBeGreaterThan(8);
		expect(fullDigest.startsWith(srcDigestOf(repoRoot))).toBe(true);
	});

	it("records a CLEAN checkout as clean, so the label means what it says", async () => {
		const repoRoot = fakeCheckout("checkout-identity-clean");
		const home = path.join(os.homedir(), "node-identity-clean");
		const { run } = runnerFor({
			"git-head": { exitCode: 0, stdout: "abc1234\n" },
			"git-status": { exitCode: 0, stdout: "" },
			verify: { exitCode: 0, stdout: "9.9.9\n" },
		});
		const result = await runNodeInstall({}, { repoRoot, home, run, announce: () => {} });

		expect(result.status).toBe("installed");
		if (result.status !== "installed") return;
		expect(result.tree).toContain("9.9.9-abc1234");
		expect(result.tree).not.toContain("dirty");
		const identity = JSON.parse(
			fs.readFileSync(path.join(result.tree, NODE_IDENTITY_FILE), "utf-8"),
		) as InstalledNodeIdentity;
		expect(identity.checkout.dirty).toBe(false);
	});

	it("says so when it cannot put the checkout's dependency status back", async () => {
		const repoRoot = fakeCheckout("checkout-stale");
		const home = path.join(os.homedir(), "node-stale");
		const { run } = runnerFor({
			"git-head": { exitCode: 0, stdout: "abc1234\n" },
			resync: { exitCode: 1 },
			verify: { exitCode: 0, stdout: "9.9.9\n" },
		});
		const result = await runNodeInstall(
			{ verifyOnly: true },
			{ repoRoot, home, run, announce: () => {} },
		);

		// A stale checkout does not invalidate the tree that was assembled — but it is never silent,
		// because the next `pnpm run` in that checkout aborts and nothing would explain why.
		expect(result.status).toBe("verified");
		if (result.status !== "verified") return;
		expect(result.checkout.status).toBe("stale");
		if (result.checkout.status !== "stale") return;
		expect(result.checkout.because).toMatch(/pnpm install/);
	});

	it("leaves the launcher untouched when the assembled tree fails to run", async () => {
		const repoRoot = fakeCheckout("checkout-broken");
		const home = path.join(os.homedir(), "node-broken");
		const shimPath = path.join(home, ".local", "bin", "refarm");
		fs.mkdirSync(path.dirname(shimPath), { recursive: true });
		fs.writeFileSync(shimPath, "#!/bin/sh\nexec node /somewhere/old/index.js \"$@\"\n");

		const { run } = runnerFor({
			"git-head": { exitCode: 0, stdout: "abc1234\n" },
			verify: { exitCode: 1, stdout: "" },
		});
		const result = await runNodeInstall({}, { repoRoot, home, shimPath, run, announce: () => {} });

		expect(result.status).toBe("refused");
		expect(fs.readFileSync(shimPath, "utf-8")).toContain("/somewhere/old/index.js");
		expect(fs.existsSync(`${shimPath}.previous`)).toBe(false);
	});

	it("assembles and verifies without touching the launcher under --verify-only", async () => {
		const repoRoot = fakeCheckout("checkout-verify");
		const home = path.join(os.homedir(), "node-verify");
		const shimPath = path.join(home, ".local", "bin", "refarm");

		const { run } = runnerFor({
			"git-head": { exitCode: 0, stdout: "abc1234\n" },
			verify: { exitCode: 0, stdout: "9.9.9\n" },
		});
		const result = await runNodeInstall(
			{ verifyOnly: true },
			{ repoRoot, home, shimPath, run, announce: () => {} },
		);

		expect(result.status).toBe("verified");
		expect(fs.existsSync(shimPath)).toBe(false);
	});

	it("refuses a directory that is not a checkout rather than assembling something", async () => {
		const empty = path.join(os.homedir(), "not-a-checkout");
		fs.mkdirSync(empty, { recursive: true });
		const { run, seen } = runnerFor({});
		const result = await runNodeInstall({}, { repoRoot: empty, run, announce: () => {} });

		expect(result.status).toBe("refused");
		expect(seen).toEqual([]);
	});

	it("refuses through the real installer when the on-disk stamp is genuinely wrong", async () => {
		// UNLIKE `fakeCheckout`, this stamp is a LITERAL never produced by `digestTree` — not
		// self-generated by the same function the guard recomputes. Every other test in this file
		// proves digestTree is CONSISTENT with itself; this one proves the installer actually
		// REFUSES when the on-disk dist genuinely disagrees with the source, through the real
		// `runNodeInstall` path rather than the pure `readTreeFreshness`/`freshnessRefusal` units.
		const repoRoot = fakeCheckout("checkout-genuinely-stale");
		const distDir = path.join(repoRoot, "apps", "refarm", "dist");
		fs.writeFileSync(path.join(distDir, SOURCE_STAMP), "not-a-real-digest-0000000000000000");
		const home = path.join(os.homedir(), "node-genuinely-stale");
		const { run, seen } = runnerFor({});

		const result = await runNodeInstall({}, { repoRoot, home, run, announce: () => {} });

		expect(result.status).toBe("refused");
		if (result.status === "refused") expect(result.because).toMatch(/apps\/refarm/u);
		// Refused before anything was even assembled — no step ran.
		expect(seen).toEqual([]);
	});

	it("--build rebuilds and continues instead of refusing, when the on-disk dist is stale", async () => {
		// The spec pairs the staleness refusal with this escape hatch; until now the refusal
		// only NAMED the build command in prose and never offered a flag that runs it.
		const repoRoot = fakeCheckout("checkout-build-flag");
		const srcDir = path.join(repoRoot, "apps", "refarm", "src");
		const distDir = path.join(repoRoot, "apps", "refarm", "dist");
		fs.writeFileSync(path.join(distDir, SOURCE_STAMP), "not-a-real-digest-0000000000000000");
		const home = path.join(os.homedir(), "node-build-flag");
		const shimPath = path.join(home, ".local", "bin", "refarm");

		const seen: string[] = [];
		const run = (spec: { id: string }) => {
			seen.push(spec.id);
			if (spec.id === "build") {
				// Simulate a real build restamping dist to match src, the way `pnpm run build`
				// (via stamp-source-digest.mjs) actually does.
				fs.writeFileSync(path.join(distDir, SOURCE_STAMP), digestTree(srcDir) ?? "");
				return { exitCode: 0, stdout: "", stderr: "" };
			}
			if (spec.id === "git-head") return { exitCode: 0, stdout: "abc1234\n", stderr: "" };
			if (spec.id === "verify") return { exitCode: 0, stdout: "9.9.9\n", stderr: "" };
			return { exitCode: 0, stdout: "", stderr: "" };
		};

		const result = await runNodeInstall(
			{ build: true, verifyOnly: true },
			{ repoRoot, home, shimPath, run, announce: () => {} },
		);

		expect(seen[0]).toBe("build");
		expect(result.status).toBe("verified");
	});

	it("--build still refuses when the build itself fails", async () => {
		const repoRoot = fakeCheckout("checkout-build-flag-fails");
		const distDir = path.join(repoRoot, "apps", "refarm", "dist");
		fs.writeFileSync(path.join(distDir, SOURCE_STAMP), "not-a-real-digest-0000000000000000");
		const home = path.join(os.homedir(), "node-build-flag-fails");
		const { run, seen } = runnerFor({
			build: { exitCode: 1, stdout: "tsc: error TS1234" },
		});

		const result = await runNodeInstall(
			{ build: true },
			{ repoRoot, home, run, announce: () => {} },
		);

		expect(result.status).toBe("refused");
		if (result.status === "refused") expect(result.because).toMatch(/--build ran/u);
		expect(seen).toEqual(["build"]);
	});

	it("--build still refuses when the rebuilt tree is STILL stale — a deeper problem the flag cannot paper over", async () => {
		const repoRoot = fakeCheckout("checkout-build-flag-still-stale");
		const distDir = path.join(repoRoot, "apps", "refarm", "dist");
		fs.writeFileSync(path.join(distDir, SOURCE_STAMP), "not-a-real-digest-0000000000000000");
		const home = path.join(os.homedir(), "node-build-flag-still-stale");
		// The "build" step reports success but never touches the stamp — dist stays stale.
		const { run, seen } = runnerFor({ build: { exitCode: 0, stdout: "" } });

		const result = await runNodeInstall(
			{ build: true },
			{ repoRoot, home, run, announce: () => {} },
		);

		expect(result.status).toBe("refused");
		if (result.status === "refused") expect(result.because).toMatch(/apps\/refarm/u);
		expect(seen).toEqual(["build"]);
	});
});

describe("sharedWithCheckout", () => {
	it("finds coupling the materialiser MISSED, because it never asks which packages were chosen", () => {
		// THE LESSON OF 2026-08-22, encoded. `materializeWorkspacePackages` picks directories by
		// name, and the first version of that rule misread pnpm's peer suffix and skipped a package
		// — leaving 1081 files hardlinked while the install called itself independent. A verdict
		// built from the same selection cannot see its own blind spot. This measures the tree
		// against the checkout instead, so a naming bug shows up as a failure rather than a silence.
		const root = path.join(os.homedir(), "shared-independent");
		const repoRoot = path.join(root, "checkout");
		const built = path.join(repoRoot, "packages", "x", "dist", "index.js");
		const vendored = path.join(repoRoot, "node_modules", "dep", "index.js");
		fs.mkdirSync(path.dirname(built), { recursive: true });
		fs.mkdirSync(path.dirname(vendored), { recursive: true });
		fs.writeFileSync(built, "built\n");
		fs.writeFileSync(vendored, "vendored\n");

		const tree = path.join(root, "tree");
		// A directory name the selection rule does NOT recognise — the point of the test.
		const opaque = path.join(tree, "node_modules", ".pnpm", "unrecognised-shape", "node_modules", "x");
		const fromStore = path.join(tree, "node_modules", ".pnpm", "dep@1.0.0", "node_modules", "dep");
		fs.mkdirSync(opaque, { recursive: true });
		fs.mkdirSync(fromStore, { recursive: true });
		fs.linkSync(built, path.join(opaque, "index.js"));
		fs.linkSync(vendored, path.join(fromStore, "index.js"));

		const shared = sharedWithCheckout(tree, repoRoot);

		// The build output couples; the store does not. pnpm keeps its store inside the checkout
		// here (`.npmrc`, `store-dir=.pnpm-store`) and nothing ever rewrites a content-addressed
		// tarball, so counting those would condemn every install for no gain.
		expect(shared.map((entry) => entry.path)).toEqual([
			path.join("node_modules", ".pnpm", "unrecognised-shape", "node_modules", "x", "index.js"),
		]);
	});
});

describe("materializeWorkspacePackages", () => {
	/** A tree shaped like pnpm's, with one workspace package and one registry package, both
	 *  hardlinked to files OUTSIDE it — which is exactly what `pnpm deploy` produces. */
	function fakeTree(name: string): { tree: string; source: string; vendor: string } {
		const root = path.join(os.homedir(), name);
		const source = path.join(root, "checkout", "packages", "x", "dist", "index.js");
		const vendor = path.join(root, "store", "chalk-index.js");
		fs.mkdirSync(path.dirname(source), { recursive: true });
		fs.mkdirSync(path.dirname(vendor), { recursive: true });
		fs.writeFileSync(source, "export const built = 1;\n");
		fs.writeFileSync(vendor, "module.exports = {};\n");

		const tree = path.join(root, "tree");
		const workspacePkg = path.join(
			tree,
			"node_modules",
			".pnpm",
			"@s+x@file+packages+x",
			"node_modules",
			"@s",
			"x",
			"dist",
		);
		const registryPkg = path.join(tree, "node_modules", ".pnpm", "chalk@5.3.0", "node_modules", "chalk");
		fs.mkdirSync(workspacePkg, { recursive: true });
		fs.mkdirSync(registryPkg, { recursive: true });
		fs.linkSync(source, path.join(workspacePkg, "index.js"));
		fs.linkSync(vendor, path.join(registryPkg, "index.js"));
		return { tree, source, vendor };
	}

	it("gives the workspace package its own storage, so a build in the checkout cannot reach it", () => {
		// THE DEFECT, reproduced. Measured on the operator's node 2026-08-22: the installed
		// `index.js` shared an inode with the checkout, a `tsc` run rewrote it in place, and the
		// node began importing a module absent from its own tree.
		const { tree, source } = fakeTree("materialize-workspace");
		const installed = path.join(
			tree, "node_modules", ".pnpm", "@s+x@file+packages+x",
			"node_modules", "@s", "x", "dist", "index.js",
		);
		expect(fs.statSync(installed).ino).toBe(fs.statSync(source).ino);

		const stillShared = materializeWorkspacePackages(tree);

		expect(stillShared).toEqual([]);
		expect(fs.statSync(installed).ino).not.toBe(fs.statSync(source).ino);
		expect(fs.readFileSync(installed, "utf-8")).toBe("export const built = 1;\n");
	});

	it("leaves the registry alone — a content-addressed tarball is never rewritten in place", () => {
		// 366 of the operator's 443 materializations are registry packages. Copying them would buy
		// no independence and cost the whole tree in disk.
		const { tree, vendor } = fakeTree("materialize-registry");
		const installed = path.join(tree, "node_modules", ".pnpm", "chalk@5.3.0", "node_modules", "chalk", "index.js");

		materializeWorkspacePackages(tree);

		expect(fs.statSync(installed).ino).toBe(fs.statSync(vendor).ino);
	});

	it("does not disturb the checkout it copied from", () => {
		const { tree, source } = fakeTree("materialize-checkout-intact");
		const before = fs.statSync(source).ino;

		materializeWorkspacePackages(tree);

		expect(fs.readFileSync(source, "utf-8")).toBe("export const built = 1;\n");
		expect(fs.statSync(source).ino).toBe(before);
	});
});
