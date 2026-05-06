#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	parseJsonOutput,
	runSubprocess,
	stripAnsi,
} from "./subprocess-utils.mjs";

const LOGGER_PREFIX = "[refarm-tree-cli-smoke]";
const REPO_ROOT = process.cwd();
const REFARM_DIST_ENTRY = path.join(REPO_ROOT, "apps/refarm/dist/index.js");
const REFARM_ESM_LOADER = path.join(
	REPO_ROOT,
	"scripts/ci/esm-extension-loader.mjs",
);
const REFARM_NODE_ARGS_PREFIX = [
	"--experimental-loader",
	REFARM_ESM_LOADER,
	REFARM_DIST_ENTRY,
];

const skipBuild = process.argv.includes("--skip-build");

function buildRefarmCommandArgs(args) {
	return [...REFARM_NODE_ARGS_PREFIX, ...args];
}

async function runRefarmCommand(args, options = {}) {
	return runSubprocess(process.execPath, buildRefarmCommandArgs(args), {
		cwd: options.cwd,
		env: {
			...process.env,
			NODE_NO_WARNINGS: "1",
			...(options.env ?? {}),
		},
		captureOutput: options.captureOutput ?? true,
	});
}

function assertIncludes(output, expected) {
	if (!output.includes(expected)) {
		throw new Error(
			`Expected command output to include ${JSON.stringify(expected)}. Output:\n${output}`,
		);
	}
}

function parseCommandJsonOutput(label, runResult) {
	try {
		return parseJsonOutput(runResult.stdout);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const stderr = stripAnsi(runResult.stderr ?? "").trim();
		throw new Error(
			`Failed to parse ${label} JSON output: ${message}${stderr ? `\n--- stderr ---\n${stderr}` : ""}`,
		);
	}
}

async function assertCommandFailsWith(args, expectedSubstring, options = {}) {
	try {
		await runRefarmCommand(args, options);
		throw new Error(
			`Expected command to fail with ${JSON.stringify(expectedSubstring)}, but it exited successfully.`,
		);
	} catch (error) {
		const output = stripAnsi(
			error instanceof Error ? error.message : String(error),
		);
		assertIncludes(output, expectedSubstring);
	}
}

async function createIsolatedGitRepo(tempDir) {
	const gitRepoPath = path.join(tempDir, "refarm-tree-git-repo");
	await mkdir(gitRepoPath, { recursive: true });
	await runSubprocess("git", ["init", "--initial-branch=main"], {
		cwd: gitRepoPath,
		env: process.env,
		captureOutput: true,
	});
	await writeFile(path.join(gitRepoPath, "README.md"), "# tree smoke\n", "utf8");
	await runSubprocess("git", ["add", "README.md"], {
		cwd: gitRepoPath,
		env: process.env,
		captureOutput: true,
	});
	await runSubprocess(
		"git",
		[
			"-c",
			"user.name=Refarm Tree Smoke",
			"-c",
			"user.email=refarm-tree-smoke@example.invalid",
			"commit",
			"-m",
			"seed",
		],
		{ cwd: gitRepoPath, env: process.env, captureOutput: true },
	);
	return gitRepoPath;
}

async function main() {
	const keepArtifacts =
		process.env.REFARM_TREE_SMOKE_KEEP_ARTIFACTS === "1" ||
		process.env.REFARM_TREE_SMOKE_KEEP_ARTIFACTS === "true";
	const tempDir = await mkdtemp(path.join(tmpdir(), "refarm-tree-cli-smoke-"));

	try {
		if (!skipBuild) {
			console.log(`${LOGGER_PREFIX} building apps/refarm dist...`);
			await runSubprocess("npm", ["--prefix", "apps/refarm", "run", "build"], {
				env: process.env,
			});
		}

		const isolatedGitRepoPath = await createIsolatedGitRepo(tempDir);

		console.log(`${LOGGER_PREFIX} smoke: tree git list JSON`);
		const listRun = await runRefarmCommand(
			["tree", "list", "--scope", "git", "--limit", "1", "--json"],
			{ cwd: isolatedGitRepoPath },
		);
		const listJson = parseCommandJsonOutput("tree list --scope git", listRun);
		if (
			listJson?.schemaVersion !== 1 ||
			listJson?.operation !== "list" ||
			listJson?.scope !== "git"
		) {
			throw new Error(`Expected git list envelope, got: ${JSON.stringify(listJson)}`);
		}

		console.log(`${LOGGER_PREFIX} smoke: tree git show JSON`);
		const showRun = await runRefarmCommand(
			["tree", "show", "HEAD", "--scope", "git", "--json"],
			{ cwd: isolatedGitRepoPath },
		);
		const showJson = parseCommandJsonOutput("tree show --scope git", showRun);
		if (showJson?.operation !== "show" || showJson?.node?.kind !== "git") {
			throw new Error(`Expected git show envelope, got: ${JSON.stringify(showJson)}`);
		}

		console.log(`${LOGGER_PREFIX} smoke: tree git preview JSON`);
		const previewRun = await runRefarmCommand(
			[
				"tree",
				"preview",
				"HEAD",
				"--scope",
				"git",
				"--name",
				"smoke/tree-preview",
				"--json",
			],
			{ cwd: isolatedGitRepoPath },
		);
		const previewJson = parseCommandJsonOutput("tree preview --scope git", previewRun);
		if (
			previewJson?.operation !== "preview" ||
			previewJson?.reason !== "dry-run" ||
			previewJson?.plan?.action !== "fork" ||
			previewJson?.plan?.effects?.activePointerChanged !== false ||
			previewJson?.plan?.effects?.branchCreated !== true ||
			previewJson?.plan?.readyToExecute !== true ||
			previewJson?.plan?.substrate?.kind !== "git-branch" ||
			previewJson?.plan?.substrate?.worktreeSwitched !== false ||
			!previewJson?.plan?.recommendedCommand?.startsWith(
				"refarm tree fork --scope git ",
			)
		) {
			throw new Error(
				`Expected git preview dry-run envelope, got: ${JSON.stringify(previewJson)}`,
			);
		}

		console.log(`${LOGGER_PREFIX} smoke: tree git fork creates non-switching branch`);
		const forkRun = await runRefarmCommand(
			[
				"tree",
				"fork",
				"HEAD",
				"--scope",
				"git",
				"--name",
				"smoke/tree-fork",
				"--json",
			],
			{ cwd: isolatedGitRepoPath },
		);
		const forkJson = parseCommandJsonOutput("tree fork --scope git", forkRun);
		if (
			forkJson?.operation !== "fork" ||
			forkJson?.reason !== "executed" ||
			forkJson?.result?.worktreeSwitched !== false ||
			forkJson?.result?.currentRefBefore !== "main" ||
			forkJson?.result?.currentRefAfter !== "main"
		) {
			throw new Error(`Expected git fork envelope, got: ${JSON.stringify(forkJson)}`);
		}

		console.log(`${LOGGER_PREFIX} smoke: tree git switch preview stays dry-run`);
		const switchPreviewRun = await runRefarmCommand(
			[
				"tree",
				"preview",
				"smoke/tree-fork",
				"--scope",
				"git",
				"--switch",
				"--json",
			],
			{ cwd: isolatedGitRepoPath },
		);
		const switchPreviewJson = parseCommandJsonOutput(
			"tree preview --scope git --switch",
			switchPreviewRun,
		);
		if (
			switchPreviewJson?.operation !== "preview" ||
			switchPreviewJson?.reason !== "dry-run" ||
			switchPreviewJson?.plan?.action !== "switch" ||
			switchPreviewJson?.plan?.substrate?.kind !== "git-switch" ||
			switchPreviewJson?.plan?.substrate?.worktreeClean !== true ||
			switchPreviewJson?.plan?.substrate?.worktreeSwitched !== true ||
			switchPreviewJson?.plan?.readyToExecute !== true ||
			switchPreviewJson?.plan?.substrate?.currentRefBefore !== "main" ||
			switchPreviewJson?.plan?.substrate?.targetRefAfter !== "smoke/tree-fork"
		) {
			throw new Error(
				`Expected git switch preview envelope, got: ${JSON.stringify(switchPreviewJson)}`,
			);
		}

		console.log(
			`${LOGGER_PREFIX} smoke: tree git switch preview reports dirty worktree`,
		);
		await writeFile(
			path.join(isolatedGitRepoPath, "README.md"),
			"# dirty tree smoke\n",
			"utf8",
		);
		const dirtySwitchPreviewRun = await runRefarmCommand(
			[
				"tree",
				"preview",
				"smoke/tree-fork",
				"--scope",
				"git",
				"--switch",
				"--json",
			],
			{ cwd: isolatedGitRepoPath },
		);
		const dirtySwitchPreviewJson = parseCommandJsonOutput(
			"tree preview --scope git --switch dirty",
			dirtySwitchPreviewRun,
		);
		if (
			dirtySwitchPreviewJson?.operation !== "preview" ||
			dirtySwitchPreviewJson?.reason !== "dry-run" ||
			dirtySwitchPreviewJson?.plan?.action !== "switch" ||
			dirtySwitchPreviewJson?.plan?.readyToExecute !== false ||
			dirtySwitchPreviewJson?.plan?.blockedReason !==
				"Git worktree must be clean before tree switch execution." ||
			dirtySwitchPreviewJson?.plan?.substrate?.kind !== "git-switch" ||
			dirtySwitchPreviewJson?.plan?.substrate?.worktreeClean !== false ||
			dirtySwitchPreviewJson?.plan?.substrate?.currentRefBefore !== "main" ||
			dirtySwitchPreviewJson?.plan?.substrate?.targetRefAfter !==
				"smoke/tree-fork"
		) {
			throw new Error(
				`Expected dirty git switch preview envelope, got: ${JSON.stringify(dirtySwitchPreviewJson)}`,
			);
		}
		await runSubprocess("git", ["checkout", "--", "README.md"], {
			cwd: isolatedGitRepoPath,
			env: process.env,
			captureOutput: true,
		});

		console.log(`${LOGGER_PREFIX} smoke: tree git switch moves isolated repo branch`);
		const switchRun = await runRefarmCommand(
			["tree", "switch", "smoke/tree-fork", "--scope", "git", "--json"],
			{ cwd: isolatedGitRepoPath },
		);
		const switchJson = parseCommandJsonOutput("tree switch --scope git", switchRun);
		if (
			switchJson?.operation !== "switch" ||
			switchJson?.reason !== "executed" ||
			switchJson?.result?.worktreeSwitched !== true ||
			switchJson?.result?.currentRefBefore !== "main" ||
			switchJson?.result?.currentRefAfter !== "smoke/tree-fork"
		) {
			throw new Error(
				`Expected git switch envelope, got: ${JSON.stringify(switchJson)}`,
			);
		}

		await assertCommandFailsWith(
			["tree", "switch", "smoke/tree-fork", "--scope", "git"],
			'Git branch "smoke/tree-fork" is already active.',
			{ cwd: isolatedGitRepoPath },
		);
		await assertCommandFailsWith(
			["tree", "fork", "HEAD", "--scope", "git", "--name", "unsafe..name"],
			'Invalid branch name "unsafe..name"',
			{ cwd: isolatedGitRepoPath },
		);
		await assertCommandFailsWith(
			["tree", "fork", "HEAD", "--scope", "git", "--name", "smoke/tree-fork"],
			'Git branch "smoke/tree-fork" already exists.',
			{ cwd: isolatedGitRepoPath },
		);

		console.log(`${LOGGER_PREFIX} passed`);
	} finally {
		if (keepArtifacts) {
			console.log(`${LOGGER_PREFIX} artifacts kept at ${tempDir}`);
		} else {
			await rm(tempDir, { recursive: true, force: true });
		}
	}
}

main().catch((error) => {
	console.error(
		`${LOGGER_PREFIX} failed: ${error instanceof Error ? error.stack || error.message : String(error)}`,
	);
	process.exit(1);
});
