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

import { runNodeInstall } from "./node-install.js";

/** A checkout shaped enough for the install to read a version and resolve pnpm. */
function fakeCheckout(name: string): string {
	const root = path.join(os.homedir(), name);
	fs.mkdirSync(path.join(root, "apps", "refarm"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({ name: "root", packageManager: "pnpm@10.0.0" }),
	);
	fs.writeFileSync(
		path.join(root, "apps", "refarm", "package.json"),
		JSON.stringify({ name: "@refarm.dev/refarm", version: "9.9.9" }),
	);
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
		expect(seen).toEqual(["git-head", "assemble", "resync", "verify"]);
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
});
