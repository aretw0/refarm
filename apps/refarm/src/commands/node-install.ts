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
	installedTreePath,
	installVersionLabel,
	shimScript,
	verificationVerdict,
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
	const label = installVersionLabel(version, currentCommit(run, repoRoot));
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
