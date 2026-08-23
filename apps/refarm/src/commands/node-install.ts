/**
 * `refarm node install` — assemble, verify, repoint, and keep a rollback.
 *
 * The impure half. It owns no decisions: every one lives in `node-install-plan.ts`, pure and
 * tested. This spawns the assembler, runs the assembled tree, and asks before touching the
 * operator's launcher.
 *
 * THE ORDER IS THE POINT. Assemble, then RUN what was assembled, and only then repoint. An
 * install that reports success without running what it installed is the shape of backup that
 * fails on the day it is needed — and this session met that failure twice while proving the node
 * could leave the working tree behind (ISS-154).
 *
 * REPOINTING IS RECORDED, NOT ASKED. `operation-consent-v1` splits on one question: is the change
 * proposed *on the operator's behalf*, or is it the change they typed? Repointing the launcher is
 * not beyond `node install` — it IS `node install`, and `--verify-only` is there for whoever wants
 * the tree without it. Asking to confirm what was just typed is the prompt that block deliberately
 * refuses to grow a `--yes` for. So the record is written in full — before/after, who, when, and
 * an undo that executes — and nothing is asked. That also means a new release installs with nobody
 * at the keyboard, which is the loop this exists to serve.
 *
 * The previous launcher is kept beside the new one as `<shim>.previous`, named in the script
 * itself, because an operator reads that file at the moment something is wrong.
 */
import { runCommandPlanProcessStep } from "@refarm.dev/cli";
import {
	createFileOperationTrail,
	createNodeOperationFileSystem,
	recordOperation,
	renderOperationRequest,
} from "@refarm.dev/operation-consent-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { refarmCommand } from "../brand.js";
import {
	checkoutDirtiness,
	independenceVerdict,
	type InstalledNodeIdentity,
	installedTreePath,
	installVersionLabel,
	NODE_IDENTITY_FILE,
	type SharedFile,
	shimScript,
	verificationVerdict,
	workspaceMaterializations,
} from "./node-install-plan.js";
import { createWorkspaceDeployCommand } from "./package-manager.js";

export const NODE_INSTALL_COMMAND = refarmCommand(["node", "install"]);

export interface NodeInstallOptions {
	/** Assemble and verify, then stop — never touch the launcher. */
	readonly verifyOnly?: boolean;
	readonly json?: boolean;
}

export interface NodeInstallDeps {
	readonly repoRoot?: string;
	readonly home?: string;
	readonly shimPath?: string;
	readonly now?: () => string;
	readonly announce?: (line: string) => void;
	/** The process runner. Injected only by tests, which must not assemble a 400MB tree to prove
	 *  what happens to the launcher afterwards. */
	readonly run?: RunStep;
}

type RunStep = (spec: Parameters<typeof runCommandPlanProcessStep>[0]) => {
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

export type NodeInstallResult =
	| {
			readonly status: "installed";
			readonly tree: string;
			readonly recordId: string;
			readonly checkout: CheckoutState;
	  }
	| {
			readonly status: "verified";
			readonly tree: string;
			readonly because: string;
			readonly checkout: CheckoutState;
	  }
	| { readonly status: "refused"; readonly because: string };

/** What assembling did to the checkout it was assembled FROM. `pnpm deploy --legacy` leaves its
 *  recorded dependency status stale, and this says whether that was put back. */
export type CheckoutState =
	| { readonly status: "restored" }
	| { readonly status: "stale"; readonly because: string };

/**
 * Run one command and report what it said.
 *
 * THROUGH `packages/cli`'s runner, never `child_process` — app source may not import it
 * (process-boundary.test.ts), and the runner already distinguishes a kill at a ceiling from a
 * failure, which this session taught it to do.
 */
const defaultRun: RunStep = (spec) => runCommandPlanProcessStep(spec);

/** A step for one program on PATH. Not routed through the package manager: `git` and `node` are
 *  not workspace binaries, and wrapping them in `pnpm exec` buys a dependency-status check that
 *  aborts with no TTY — measured, not guessed. */
function step(id: string, command: string, args: string[], cwd: string, timeoutMs: number) {
	const display = `${command} ${args.join(" ")}`;
	return {
		id,
		command: display,
		args: [command, ...args],
		description: id,
		process: { command, args, display, cwd, timeoutMs },
	};
}

/** The commit an assembled tree was built from, or nothing. Never throws: a checkout with no git
 *  is a legitimate place to install from, and it simply has no commit to name. */
function currentCommit(run: RunStep, repoRoot: string): string | null {
	const probe = run(
		step("git-head", "git", ["-C", repoRoot, "rev-parse", "--short", "HEAD"], repoRoot, 30_000),
	);
	return probe.exitCode === 0 ? probe.stdout.trim() || null : null;
}

/** Run a read-only probe and hand back only what a verdict needs. Never throws: a checkout with no
 *  git is a legitimate place to install from, and the verdict decides what that means. */
function probeStep(run: RunStep, spec: ReturnType<typeof step>): { status: number | null; stdout: string } {
	const result = run(spec);
	return { status: result.exitCode, stdout: result.stdout };
}

function readVersion(repoRoot: string): string | null {
	try {
		const manifest = JSON.parse(
			fs.readFileSync(path.join(repoRoot, "apps", "refarm", "package.json"), "utf-8"),
		) as { version?: string };
		return typeof manifest.version === "string" ? manifest.version : null;
	} catch {
		return null;
	}
}

export async function runNodeInstall(
	options: NodeInstallOptions = {},
	deps: NodeInstallDeps = {},
): Promise<NodeInstallResult> {
	const repoRoot = deps.repoRoot ?? process.cwd();
	const home = deps.home ?? os.homedir();
	const shimPath = deps.shimPath ?? path.join(home, ".local", "bin", "refarm");
	const say = deps.announce ?? ((line: string) => console.log(line));
	const run = deps.run ?? defaultRun;

	const version = readVersion(repoRoot);
	if (!version) {
		return {
			status: "refused",
			because:
				`no version could be read at ${repoRoot} — an install assembles a workspace, and this ` +
				"is not one. Run it from a checkout.",
		};
	}
	const commit = currentCommit(run, repoRoot);
	// ISS-158. The label is read from `git HEAD` and the TREE is assembled from the working tree's
	// `dist/`, so without this the two disagree the moment anything is uncommitted — and the label
	// promises a traceability it does not have.
	const dirtiness = checkoutDirtiness(
		probeStep(run, step("git-status", "git", ["-C", repoRoot, "status", "--porcelain"], repoRoot, 30_000)),
	);
	const label = installVersionLabel(version, commit, dirtiness.dirty);
	const tree = installedTreePath(home, label);

	// ── 1. Assemble ──────────────────────────────────────────────────────────
	say(`Assembling ${label} into ${tree} …`);
	fs.rmSync(tree, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(tree), { recursive: true });
	const deploy = createWorkspaceDeployCommand("@refarm.dev/refarm", tree, { cwd: repoRoot });
	const assemble = run({
		id: "assemble",
		command: deploy.display,
		args: [deploy.command, ...deploy.args],
		description: "assemble",
		process: { ...deploy, cwd: repoRoot, timeoutMs: 900_000 },
	});
	if (assemble.exitCode !== 0) {
		return {
			status: "refused",
			because: `assembling failed: ${(assemble.stderr || assemble.stdout).trim().slice(0, 300)}`,
		};
	}

	// ── 1b. Put the checkout back ────────────────────────────────────────────
	// `deploy --legacy` runs its own production install and the workspace's recorded dependency
	// status does not survive it: every later `pnpm run`/`pnpm exec` there aborts with
	// ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY, the repo's own gates included. The same binary
	// that made the mess cleans it up — no second detection, no chance of using a different one.
	// Immediately, so that even a FAILED verification below leaves a working checkout.
	const resync = run({
		id: "resync",
		command: `${deploy.packageManager ?? "pnpm"} install`,
		args: [deploy.command, "install"],
		description: "resync",
		process: {
			command: deploy.command,
			args: ["install"],
			display: `${deploy.packageManager ?? "pnpm"} install`,
			cwd: repoRoot,
			timeoutMs: 900_000,
		},
	});
	const checkout: CheckoutState =
		resync.exitCode === 0
			? { status: "restored" }
			: {
					status: "stale",
					because:
						`assembling left ${repoRoot} with a stale dependency status and restoring it failed. ` +
						"Run `pnpm install` there — `pnpm run` and `pnpm exec` abort until you do. " +
						(resync.stderr || resync.stdout).trim().slice(0, 200),
				};
	if (checkout.status === "stale") say(checkout.because);

	// ── 1c. Make it its OWN tree ─────────────────────────────────────────────
	// BEFORE the verification below, deliberately: a tree still hardlinked to the checkout would
	// be verified as one thing and later become another, which is precisely how this defect went
	// unseen for 33 hours. Assembling produces the files; this makes them the tree's own.
	materializeWorkspacePackages(tree);
	// MEASURED AGAINST THE CHECKOUT, not against the materialiser's own selection — see
	// `sharedWithCheckout`. A verdict derived from the selection cannot report a selection bug,
	// and on 2026-08-22 that is exactly what it failed to do.
	const independence = independenceVerdict({ shared: sharedWithCheckout(tree, repoRoot) });
	if (!independence.ok) {
		// LEFT ON DISK, like a failed verification: whoever debugs this needs the tree that failed.
		return { status: "refused", because: `${independence.because} The tree is at ${tree}.` };
	}
	say(`Independent: ${independence.because}`);

	// ── 1d. The tree says who it is ──────────────────────────────────────────
	// Written BEFORE the verification below, so what is proven to run is the finished tree — the
	// same reason materialisation comes first.
	const identity: InstalledNodeIdentity = {
		label,
		version,
		commit,
		checkout: dirtiness,
		installedAt: (deps.now ?? (() => new Date().toISOString()))(),
	};
	fs.mkdirSync(tree, { recursive: true });
	fs.writeFileSync(
		path.join(tree, NODE_IDENTITY_FILE),
		`${JSON.stringify(identity, null, "\t")}\n`,
	);
	if (dirtiness.dirty) say(`Recorded as dirty: ${dirtiness.because}`);

	// ── 2. Verify, by RUNNING it ─────────────────────────────────────────────
	const entrypoint = path.join(tree, "dist", "index.js");
	const probe = run({
		id: "verify",
		command: `${process.execPath} ${entrypoint} --version`,
		args: [process.execPath, entrypoint, "--version"],
		description: "verify",
		process: {
			command: process.execPath,
			args: [entrypoint, "--version"],
			display: `${entrypoint} --version`,
			timeoutMs: 120_000,
		},
	});
	const verdict = verificationVerdict({
		status: probe.exitCode,
		stdout: probe.stdout,
		...(probe.stderr ? { stderr: probe.stderr } : {}),
	});
	if (!verdict.ok) {
		// LEFT ON DISK on purpose: an operator debugging a failed install needs the tree that
		// failed, and deleting it would leave them only this sentence.
		return { status: "refused", because: `${verdict.because} The tree is at ${tree}.` };
	}
	say(`Verified: ${verdict.because}`);
	if (options.verifyOnly) return { status: "verified", tree, because: verdict.because, checkout };

	// ── 3. Repoint, and remember it ──────────────────────────────────────────
	const before = fs.existsSync(shimPath) ? fs.readFileSync(shimPath, "utf-8") : null;
	const after = shimScript({ node: process.execPath, entrypoint, shimPath });
	const request = {
		id: `node-install:${label}`,
		kind: "node-install",
		title: `${NODE_INSTALL_COMMAND} ${label}`,
		purpose:
			`Point this node's launcher at the installed tree ${tree}, so it stops executing whatever ` +
			"a repository happens to hold. The previous launcher is kept beside it.",
		requester: NODE_INSTALL_COMMAND,
		requestedAt: (deps.now ?? (() => new Date().toISOString()))(),
		changes: [{ path: shimPath, before, after }],
		notes: [
			verdict.because,
			`The launcher this replaces is kept at ${shimPath}.previous.`,
		],
		undo: {
			kind: "restore-snapshot" as const,
			// Read LATER, out of context. "as it is now" would name the new launcher by the time
			// anyone needs this sentence, so it names the tree instead.
			summary:
				before === null
					? `Remove ${shimPath} (it did not exist before this).`
					: `Point ${shimPath} back at the tree it named before this install — the whole file is ` +
						`in this record's before-snapshot, and a copy is at ${shimPath}.previous.`,
		},
	};

	for (const line of renderOperationRequest(request, { contextLines: 12 })) say(line);

	// The previous launcher goes to disk FIRST. `recordOperation` puts the shim back if the record
	// cannot be written, but an operator reaching for `.previous` by hand should find it there
	// whichever way that goes.
	if (before !== null) fs.writeFileSync(`${shimPath}.previous`, before, { mode: 0o755 });

	const record = await recordOperation({
		request,
		trail: createFileOperationTrail(
			path.join(home, ".refarm", "node", "operations.json"),
			createNodeOperationFileSystem(),
		),
		decidedBy: os.userInfo().username,
		host: os.hostname(),
	});
	fs.chmodSync(shimPath, 0o755);
	return { status: "installed", tree, recordId: record.id, checkout };
}

/**
 * IMPURE. Give every workspace-sourced package in the assembled tree its own storage, and report
 * whatever is STILL shared afterwards.
 *
 * WHY THIS EXISTS AND NO FLAG DOES. `pnpm deploy` hardlinks; that is the store's design, not an
 * oversight. Measured 2026-08-22, each of these produced a hardlink anyway:
 * `--config.package-import-method=copy`, `npm_config_package_import_method=copy`, and
 * `--config.inject-workspace-packages=true` (the non-legacy deploy refuses without the last).
 * So independence is taken after assembly rather than asked for during it.
 *
 * SCOPED TO THE WORKSPACE ON PURPOSE. The registry half of the tree is hardlinked to pnpm's store,
 * which this repository keeps inside the checkout (`.npmrc`, `store-dir=.pnpm-store`) — so a blunt
 * "share nothing with the checkout" would condemn 366 of 443 materializations. Those are
 * content-addressed: nothing ever rewrites one, and copying them would buy no independence while
 * costing the whole tree in disk. The 77 that came from a path are the only ones a `tsc` run can
 * reach.
 *
 * Symlinks are skipped rather than copied: pnpm's top level is made of them, and turning them into
 * files would give the tree a second copy of everything it already has.
 */
export function materializeWorkspacePackages(tree: string): SharedFile[] {
	const store = path.join(tree, "node_modules", ".pnpm");
	let entries: string[];
	try {
		entries = fs.readdirSync(store);
	} catch {
		return [];
	}
	const stillShared: SharedFile[] = [];
	for (const materialization of workspaceMaterializations(entries)) {
		for (const file of walkFiles(path.join(store, materialization))) {
			if (fs.statSync(file).nlink <= 1) continue;
			giveItsOwnStorage(file);
			// Re-measured, not assumed. This function's whole claim is the one thing it must not
			// take on faith about itself.
			if (fs.statSync(file).nlink > 1) stillShared.push({ path: path.relative(tree, file) });
		}
	}
	return stillShared;
}

/** Regular files only — a symlink is pnpm's own structure, not content to copy, and following one
 *  would also walk out of the tree being measured. */
function* walkFiles(dir: string, skip?: ReadonlySet<string>): Generator<string> {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (skip?.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walkFiles(full, skip);
		else if (entry.isFile()) yield full;
	}
}

/** Copy beside, then rename over: the file is never absent, and the link is broken by the rename
 *  rather than by a truncation that would have written through to the checkout. */
function giveItsOwnStorage(file: string): void {
	const mode = fs.statSync(file).mode;
	const scratch = `${file}.materializing`;
	fs.copyFileSync(file, scratch);
	fs.chmodSync(scratch, mode);
	fs.renameSync(scratch, file);
}

/**
 * Directories that are not the checkout's own work: pnpm's store lives inside this repository
 * (`.npmrc`, `store-dir=.pnpm-store`) and its installed copies hang off `node_modules`. Both are
 * content-addressed and neither is ever rewritten in place, so sharing storage with them is free.
 */
const NOT_THE_CHECKOUT_S_OWN = new Set([".git", "node_modules", ".pnpm-store"]);

/**
 * IMPURE. Every file in the assembled tree that shares storage with the CHECKOUT'S OWN work.
 *
 * WHY THIS DOES NOT REUSE THE MATERIALISER'S SELECTION, which would be the obvious economy: on
 * 2026-08-22 the selection rule misread pnpm's peer suffix, skipped `@refarm.dev/cli`, and left
 * 1081 files hardlinked — while a verdict computed from that same selection reported the tree
 * independent. A check that inherits the blind spot of the thing it checks is the shape this
 * repository keeps finding and removing: correct, and unable to fail.
 *
 * So it measures the two trees against each other. Costs ~0.15s on the operator's node (66k files
 * in the checkout, 16.5k in the tree) — the price of a claim that can be wrong out loud.
 */
export function sharedWithCheckout(tree: string, repoRoot: string): SharedFile[] {
	const ownWork = new Set<number>();
	for (const file of walkFiles(repoRoot, NOT_THE_CHECKOUT_S_OWN)) {
		ownWork.add(fs.statSync(file).ino);
	}
	const shared: SharedFile[] = [];
	for (const file of walkFiles(tree)) {
		if (ownWork.has(fs.statSync(file).ino)) shared.push({ path: path.relative(tree, file) });
	}
	return shared;
}
