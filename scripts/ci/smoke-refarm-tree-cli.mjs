#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	parseJsonOutput,
	runPackageScript,
	runSubprocess,
	stripAnsi,
} from "./subprocess-utils.mjs";

const LOGGER_PREFIX = "[refarm-tree-cli-smoke]";
const REPO_ROOT = process.cwd();
const REFARM_DIST_ENTRY = path.join(REPO_ROOT, "apps/refarm/dist/index.js");
const REFARM_ESM_REGISTER = path.join(
	REPO_ROOT,
	"scripts/ci/esm-extension-register.mjs",
);
const REFARM_NODE_ARGS_PREFIX = [
	"--import",
	REFARM_ESM_REGISTER,
	REFARM_DIST_ENTRY,
];

const skipBuild = process.argv.includes("--skip-build");
const TREE_STUB_SESSION_ID = "urn:refarm:session:v1:000treecli01";
const TREE_STUB_SESSION = {
	"@id": TREE_STUB_SESSION_ID,
	"@type": "Session",
	name: "tree-cli-smoke-session",
	created_at_ns: 1_700_000_000_000_000_000,
	leaf_entry_id: "entry-cli-1",
};
const TREE_OLDER_STUB_SESSION = {
	"@id": "urn:refarm:session:v1:oldertree01",
	"@type": "Session",
	name: "older-tree-cli-smoke-session",
	created_at_ns: 1_600_000_000_000_000_000,
	leaf_entry_id: "entry-old-1",
};

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

async function startTreeSidecarStub() {
	const sessionListRequests = [];
	const server = createServer((request, response) => {
		if (request.url === "/sessions" || request.url?.startsWith("/sessions?")) {
			sessionListRequests.push(request.url);
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					sessions: [TREE_OLDER_STUB_SESSION, TREE_STUB_SESSION],
				}),
			);
			return;
		}
		if (request.url?.startsWith("/sessions/") && request.url.endsWith("/history")) {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					session: TREE_STUB_SESSION,
					entries: [
						{
							id: "entry-cli-1",
							kind: "assistant",
							content: "tree cli smoke",
							timestamp_ns: 1_700_000_000_000_000_000,
						},
					],
					total: 1,
				}),
			);
			return;
		}
		response.writeHead(404, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: "not found" }));
	});

	return new Promise((resolve, reject) => {
		server.once("error", (error) => {
			if (error && error.code === "EADDRINUSE") {
				resolve({
					started: false,
					sessionListRequests,
					close: async () => {},
				});
				return;
			}
			reject(error);
		});
		server.listen(42001, "127.0.0.1", () => {
			resolve({
				started: true,
				sessionListRequests,
				close: () => new Promise((closeResolve) => server.close(closeResolve)),
			});
		});
	});
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
	let sidecarStub;

	try {
		if (!skipBuild) {
			console.log(`${LOGGER_PREFIX} building apps/refarm dist...`);
			await runPackageScript("apps/refarm", "build", {
				env: process.env,
			});
		}

		const isolatedGitRepoPath = await createIsolatedGitRepo(tempDir);
		sidecarStub = await startTreeSidecarStub();
		if (sidecarStub.started) {
			console.log(`${LOGGER_PREFIX} using local session sidecar stub on :42001`);
		} else {
			console.log(
				`${LOGGER_PREFIX} using existing session sidecar on :42001 for all-scope smoke`,
			);
		}

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

		console.log(`${LOGGER_PREFIX} smoke: tree all list JSON`);
		const allListRun = await runRefarmCommand(
			["tree", "list", "--scope", "all", "--limit", "1", "--json"],
			{ cwd: isolatedGitRepoPath },
		);
		const allListJson = parseCommandJsonOutput("tree list --scope all", allListRun);
		if (
			allListJson?.schemaVersion !== 1 ||
			allListJson?.operation !== "list" ||
			allListJson?.scope !== "all" ||
			!Array.isArray(allListJson?.nodes) ||
			allListJson.nodes.length !== 1 ||
			allListJson.nodes[0]?.kind !== "git"
		) {
			throw new Error(
				`Expected all-scope list envelope capped to one git node, got: ${JSON.stringify(allListJson)}`,
			);
		}
		const allListTwoRun = await runRefarmCommand(
			["tree", "list", "--scope", "all", "--limit", "2", "--json"],
			{ cwd: isolatedGitRepoPath },
		);
		const allListTwoJson = parseCommandJsonOutput(
			"tree list --scope all limit 2",
			allListTwoRun,
		);
		if (
			!Array.isArray(allListTwoJson?.nodes) ||
			allListTwoJson.nodes.length !== 2 ||
			!allListTwoJson.nodes.some((node) => node?.kind === "git") ||
			!allListTwoJson.nodes.some((node) => node?.kind === "session")
		) {
			throw new Error(
				`Expected all-scope list envelope with git and session nodes, got: ${JSON.stringify(allListTwoJson)}`,
			);
		}

		console.log(`${LOGGER_PREFIX} smoke: tree all scope remains read-only`);
		await assertCommandFailsWith(
			["tree", "switch", "HEAD", "--scope", "all"],
			"--scope session|git for this operation",
			{ cwd: isolatedGitRepoPath },
		);

		if (sidecarStub.started) {
			console.log(`${LOGGER_PREFIX} smoke: tree session list limit JSON`);
			const sessionListRun = await runRefarmCommand(
				["tree", "list", "--limit", "1", "--json"],
				{ cwd: isolatedGitRepoPath },
			);
			const sessionListJson = parseCommandJsonOutput(
				"tree list --limit session",
				sessionListRun,
			);
			if (
				sessionListJson?.scope !== "session" ||
				!Array.isArray(sessionListJson?.nodes) ||
				sessionListJson.nodes.length !== 1 ||
				sessionListJson.nodes[0]?.nodeId !== TREE_STUB_SESSION_ID
			) {
				throw new Error(
					`Expected session list envelope capped to newest session, got: ${JSON.stringify(sessionListJson)}`,
				);
			}
			for (const expectedRequest of [
				"/sessions?limit=1",
				"/sessions?limit=2",
			]) {
				if (!sidecarStub.sessionListRequests.includes(expectedRequest)) {
					throw new Error(
						`Expected bounded session sidecar request ${expectedRequest}, got: ${JSON.stringify(sidecarStub.sessionListRequests)}`,
					);
				}
			}

			console.log(`${LOGGER_PREFIX} smoke: tree session switch isolated HOME`);
			const sessionEnv = { HOME: tempDir };
			const sessionPrefix = "000treecli01";
			const sessionPreviewRun = await runRefarmCommand(
				["tree", "preview", sessionPrefix, "--switch", "--json"],
				{ cwd: isolatedGitRepoPath, env: sessionEnv },
			);
			const sessionPreviewJson = parseCommandJsonOutput(
				"tree preview --switch session",
				sessionPreviewRun,
			);
			if (
				sessionPreviewJson?.operation !== "preview" ||
				sessionPreviewJson?.reason !== "dry-run" ||
				sessionPreviewJson?.scope !== "session" ||
				sessionPreviewJson?.plan?.action !== "switch" ||
				sessionPreviewJson?.plan?.readyToExecute !== true ||
				sessionPreviewJson?.plan?.substrate?.kind !== "session-switch" ||
				sessionPreviewJson?.plan?.recommendedCommand !==
					"refarm tree switch 000treecli01" ||
				sessionPreviewJson?.plan?.substrate?.targetSessionIdAfter !==
					TREE_STUB_SESSION_ID
			) {
				throw new Error(
					`Expected session switch preview envelope, got: ${JSON.stringify(sessionPreviewJson)}`,
				);
			}

			const sessionSwitchRun = await runRefarmCommand(
				["tree", "switch", sessionPrefix, "--json"],
				{ cwd: isolatedGitRepoPath, env: sessionEnv },
			);
			const sessionSwitchJson = parseCommandJsonOutput(
				"tree switch session",
				sessionSwitchRun,
			);
			if (
				sessionSwitchJson?.operation !== "switch" ||
				sessionSwitchJson?.reason !== "executed" ||
				sessionSwitchJson?.scope !== "session" ||
				sessionSwitchJson?.result?.kind !== "session-switch" ||
				sessionSwitchJson?.result?.command !==
					"refarm tree switch 000treecli01" ||
				sessionSwitchJson?.result?.currentSessionIdAfter !==
					TREE_STUB_SESSION_ID
			) {
				throw new Error(
					`Expected session switch envelope, got: ${JSON.stringify(sessionSwitchJson)}`,
				);
			}
			const lockContent = await readFile(
				path.join(tempDir, ".refarm", "session.lock"),
				"utf8",
			);
			if (lockContent !== TREE_STUB_SESSION_ID) {
				throw new Error(
					`Expected isolated session lock ${TREE_STUB_SESSION_ID}, got ${lockContent}`,
				);
			}

			const activeSessionPreviewRun = await runRefarmCommand(
				["tree", "preview", sessionPrefix, "--switch", "--json"],
				{ cwd: isolatedGitRepoPath, env: sessionEnv },
			);
			const activeSessionPreviewJson = parseCommandJsonOutput(
				"tree preview --switch active session",
				activeSessionPreviewRun,
			);
			if (
				activeSessionPreviewJson?.operation !== "preview" ||
				activeSessionPreviewJson?.reason !== "dry-run" ||
				activeSessionPreviewJson?.plan?.action !== "switch" ||
				activeSessionPreviewJson?.plan?.readyToExecute !== false ||
				activeSessionPreviewJson?.plan?.blockedReason !==
					'Session "000treecli01" is already active.'
			) {
				throw new Error(
					`Expected active session switch preview envelope, got: ${JSON.stringify(activeSessionPreviewJson)}`,
				);
			}
			await assertCommandFailsWith(
				["tree", "switch", sessionPrefix],
				'Session "000treecli01" is already active.',
				{ cwd: isolatedGitRepoPath, env: sessionEnv },
			);
		} else {
			console.log(
				`${LOGGER_PREFIX} skipping session switch smoke because :42001 is already owned`,
			);
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

		console.log(`${LOGGER_PREFIX} smoke: tree git fork preview blocks existing branch`);
		const existingForkPreviewRun = await runRefarmCommand(
			[
				"tree",
				"preview",
				"HEAD",
				"--scope",
				"git",
				"--name",
				"smoke/tree-fork",
				"--json",
			],
			{ cwd: isolatedGitRepoPath },
		);
		const existingForkPreviewJson = parseCommandJsonOutput(
			"tree preview --scope git existing branch",
			existingForkPreviewRun,
		);
		if (
			existingForkPreviewJson?.operation !== "preview" ||
			existingForkPreviewJson?.reason !== "dry-run" ||
			existingForkPreviewJson?.plan?.action !== "fork" ||
			existingForkPreviewJson?.plan?.readyToExecute !== false ||
			existingForkPreviewJson?.plan?.blockedReason !==
				'Git branch "smoke/tree-fork" already exists.' ||
			existingForkPreviewJson?.plan?.effects?.activePointerChanged !== false ||
			existingForkPreviewJson?.plan?.effects?.branchCreated !== true ||
			existingForkPreviewJson?.plan?.substrate?.kind !== "git-branch" ||
			existingForkPreviewJson?.plan?.substrate?.branchName !== "smoke/tree-fork" ||
			existingForkPreviewJson?.plan?.substrate?.worktreeSwitched !== false
		) {
			throw new Error(
				`Expected existing-branch git fork preview envelope, got: ${JSON.stringify(existingForkPreviewJson)}`,
			);
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
		const refAfterDirtyPreview = await runSubprocess(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			{
				cwd: isolatedGitRepoPath,
				env: process.env,
				captureOutput: true,
			},
		);
		if (refAfterDirtyPreview.stdout.trim() !== "main") {
			throw new Error(
				`Expected dirty switch preview to leave active ref on main, got: ${refAfterDirtyPreview.stdout}`,
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

		console.log(`${LOGGER_PREFIX} smoke: tree git active switch preview is blocked`);
		const activeSwitchPreviewRun = await runRefarmCommand(
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
		const activeSwitchPreviewJson = parseCommandJsonOutput(
			"tree preview --scope git --switch active",
			activeSwitchPreviewRun,
		);
		if (
			activeSwitchPreviewJson?.operation !== "preview" ||
			activeSwitchPreviewJson?.reason !== "dry-run" ||
			activeSwitchPreviewJson?.plan?.action !== "switch" ||
			activeSwitchPreviewJson?.plan?.readyToExecute !== false ||
			activeSwitchPreviewJson?.plan?.blockedReason !==
				'Git branch "smoke/tree-fork" is already active.' ||
			activeSwitchPreviewJson?.plan?.substrate?.currentRefBefore !==
				"smoke/tree-fork" ||
			activeSwitchPreviewJson?.plan?.substrate?.targetRefAfter !==
				"smoke/tree-fork"
		) {
			throw new Error(
				`Expected active git switch preview envelope, got: ${JSON.stringify(activeSwitchPreviewJson)}`,
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
		if (sidecarStub) {
			await sidecarStub.close();
		}
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
