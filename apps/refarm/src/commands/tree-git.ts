import * as childProcess from "node:child_process";
import chalk from "chalk";
import {
	outputTreeJson,
	REFARM_TREE_GIT_SCOPE,
	REFARM_TREE_SCHEMA_VERSION,
	type RefarmGitTimelineForkEnvelope,
	type RefarmGitTimelineListEnvelope,
	type RefarmGitTimelinePreviewEnvelope,
	type RefarmGitTimelineNode,
	type RefarmGitTimelineShowEnvelope,
	type RefarmGitTimelineSwitchEnvelope,
} from "./tree-model.js";

function createGitTimelineNode(line: string): RefarmGitTimelineNode | null {
	const [hash, parents, refs, timestamp, subject] = line.split("\u001f");
	if (!hash) return null;
	const refList = refs ? refs.split(", ").filter(Boolean) : [];
	return {
		timelineId: REFARM_TREE_GIT_SCOPE,
		nodeId: hash,
		parentNodeId: parents?.split(" ").filter(Boolean)[0],
		branchId: refList[0],
		kind: REFARM_TREE_GIT_SCOPE,
		label: subject || hash.slice(0, 12),
		timestamp: timestamp || new Date(0).toISOString(),
		metadata: {
			shortId: hash.slice(0, 12),
			refs: refList,
		},
	};
}

function runGit(args: string[]): string {
	const result = childProcess.spawnSync("git", args, {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		const detail =
			result.stderr || result.stdout || `git ${args.join(" ")} failed`;
		throw new Error(detail.trim());
	}
	return result.stdout.trim();
}

function gitBranchExists(name: string): boolean {
	const result = childProcess.spawnSync(
		"git",
		["show-ref", "--verify", "--quiet", `refs/heads/${name}`],
		{ encoding: "utf8" },
	);
	if (result.status === 0) return true;
	if (result.status === 1) return false;
	const detail =
		result.stderr || result.stdout || `git show-ref failed for ${name}`;
	throw new Error(detail.trim());
}

function currentGitRef(): string {
	return runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
}

function gitWorktreeIsClean(): boolean {
	return runGit(["status", "--porcelain"]) === "";
}

function assertCleanGitWorktree(): void {
	if (!gitWorktreeIsClean()) {
		throw new Error(
			"Git worktree must be clean before tree switch. Commit, stash, or remove pending changes first.",
		);
	}
}

function listGitTimelineNodes(limit: number): RefarmGitTimelineNode[] {
	const output = runGit([
		"log",
		`--max-count=${limit}`,
		"--date=iso-strict",
		"--format=%H%x1f%P%x1f%D%x1f%aI%x1f%s",
	]);
	if (!output) return [];
	return output
		.split("\n")
		.map(createGitTimelineNode)
		.filter((node): node is RefarmGitTimelineNode => Boolean(node));
}

function showGitTimelineNode(ref: string): RefarmGitTimelineNode {
	const output = runGit([
		"show",
		"--no-patch",
		"--date=iso-strict",
		"--format=%H%x1f%P%x1f%D%x1f%aI%x1f%s",
		ref,
	]);
	const node = createGitTimelineNode(output);
	if (!node) throw new Error(`No git commit matching "${ref}"`);
	return node;
}

function exitForGitError(err: unknown): never {
	const msg = err instanceof Error ? err.message : String(err);
	console.error(chalk.red(`✗  ${msg}`));
	process.exit(1);
}

export function listGitTree(opts: { json?: boolean; limit?: number }): void {
	let nodes: RefarmGitTimelineNode[];
	try {
		nodes = listGitTimelineNodes(opts.limit ?? 20);
	} catch (err) {
		exitForGitError(err);
	}

	if (opts.json) {
		const envelope: RefarmGitTimelineListEnvelope = {
			schemaVersion: REFARM_TREE_SCHEMA_VERSION,
			command: "tree",
			scope: REFARM_TREE_GIT_SCOPE,
			operation: "list",
			nodes,
		};
		outputTreeJson(envelope);
		return;
	}

	if (nodes.length === 0) {
		console.log(chalk.dim("No git commits found."));
		return;
	}

	console.log(
		chalk.bold(`\n  Tree timeline  (${REFARM_TREE_GIT_SCOPE} scope)\n`),
	);
	for (const node of nodes) {
		const refs = node.metadata.refs?.length
			? chalk.dim(` · ${node.metadata.refs.join(", ")}`)
			: "";
		console.log(
			`  ${chalk.cyan(node.metadata.shortId)}  ${chalk.white(node.label)}${refs}`,
		);
	}
	console.log(
		chalk.dim(
			"\n  refarm tree show --scope git <commit>" +
				"\n  refarm tree preview --scope git <commit> --name <branch>" +
				"\n  refarm tree fork --scope git <commit> --name <branch>" +
				"\n  refarm tree preview --scope git <branch> --switch" +
				"\n  refarm tree switch --scope git <branch>\n",
		),
	);
}

export function showGitTree(prefix: string, opts: { json?: boolean }): void {
	let node: RefarmGitTimelineNode;
	try {
		node = showGitTimelineNode(prefix);
	} catch (err) {
		exitForGitError(err);
	}

	if (opts.json) {
		const envelope: RefarmGitTimelineShowEnvelope = {
			schemaVersion: REFARM_TREE_SCHEMA_VERSION,
			command: "tree",
			scope: REFARM_TREE_GIT_SCOPE,
			operation: "show",
			node,
		};
		outputTreeJson(envelope);
		return;
	}

	console.log(
		chalk.bold(
			`\n  Timeline node ${chalk.cyan(node.metadata.shortId)}  ${chalk.white(node.label)}`,
		),
	);
	console.log(chalk.dim(`  kind=${node.kind} timeline=${node.timelineId}`));
	if (node.parentNodeId)
		console.log(chalk.dim(`  parent=${node.parentNodeId}`));
	if (node.metadata.refs?.length) {
		console.log(chalk.dim(`  refs=${node.metadata.refs.join(", ")}`));
	}
	console.log();
}

function createGitPreviewEnvelope(
	node: RefarmGitTimelineNode,
	name: string | undefined,
	branchAlreadyExists: boolean | undefined,
): RefarmGitTimelinePreviewEnvelope {
	const branchName = name ?? "<branch-name>";
	const readyToExecute = Boolean(name) && branchAlreadyExists === false;
	const blockedReason = !name
		? "Provide --name <branch-name> before executing tree fork."
		: branchAlreadyExists
			? `Git branch "${name}" already exists.`
			: undefined;
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan: {
			action: "fork",
			destructive: false,
			readyToExecute,
			...(blockedReason ? { blockedReason } : {}),
			recommendedCommand: `refarm tree fork --scope git ${node.metadata.shortId} --name ${branchName}`,
			effects: {
				activePointerChanged: false,
				branchCreated: true,
			},
			substrate: {
				kind: "git-branch",
				baseCommit: node.nodeId,
				branchName,
				worktreeSwitched: false,
			},
		},
	};
}

function createGitSwitchPreviewEnvelope(
	node: RefarmGitTimelineNode,
	name: string,
	currentRefBefore: string,
	worktreeClean: boolean,
): RefarmGitTimelinePreviewEnvelope {
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan: {
			action: "switch",
			destructive: false,
			readyToExecute: worktreeClean,
			...(worktreeClean
				? {}
				: {
						blockedReason:
							"Git worktree must be clean before tree switch execution.",
					}),
			recommendedCommand: `refarm tree switch --scope git ${name}`,
			effects: {
				activePointerChanged: true,
				branchCreated: false,
			},
			substrate: {
				kind: "git-switch",
				currentRefBefore,
				targetRefAfter: name,
				targetCommit: node.nodeId,
				worktreeClean,
				worktreeSwitched: true,
			},
		},
	};
}

function createGitForkEnvelope(
	node: RefarmGitTimelineNode,
	name: string,
	currentRefBefore: string,
	currentRefAfter: string,
): RefarmGitTimelineForkEnvelope {
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "fork",
		reason: "executed",
		target: node,
		result: {
			kind: "git-branch",
			destructive: false,
			worktreeSwitched: false,
			currentRefBefore,
			currentRefAfter,
			branchName: name,
			baseCommit: node.nodeId,
			command: `git branch ${name} ${node.metadata.shortId}`,
		},
	};
}

function createGitSwitchEnvelope(
	node: RefarmGitTimelineNode,
	name: string,
	currentRefBefore: string,
	currentRefAfter: string,
): RefarmGitTimelineSwitchEnvelope {
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "switch",
		reason: "executed",
		target: node,
		result: {
			kind: "git-switch",
			destructive: false,
			worktreeSwitched: true,
			currentRefBefore,
			currentRefAfter,
			branchName: name,
			targetCommit: node.nodeId,
			command: `git switch ${name}`,
		},
	};
}

export function previewGitTree(
	prefix: string,
	opts: { json?: boolean; name?: string },
): void {
	let node: RefarmGitTimelineNode;
	let branchAlreadyExists: boolean | undefined;
	try {
		node = showGitTimelineNode(prefix);
		branchAlreadyExists = opts.name ? gitBranchExists(opts.name) : undefined;
	} catch (err) {
		exitForGitError(err);
	}
	const envelope = createGitPreviewEnvelope(
		node,
		opts.name,
		branchAlreadyExists,
	);

	if (opts.json) {
		outputTreeJson(envelope);
		return;
	}

	console.log(chalk.bold("\n  Tree preview (dry-run)\n"));
	console.log(
		`  Target: ${chalk.cyan(envelope.target.metadata.shortId)}  ${chalk.white(envelope.target.label)}`,
	);
	console.log("  Would:  create a non-destructive git branch");
	console.log(chalk.dim(`  Command: ${envelope.plan.recommendedCommand}\n`));
}

export function previewGitSwitchTree(
	name: string,
	opts: { json?: boolean },
): void {
	let node: RefarmGitTimelineNode;
	let currentRefBefore: string;
	let worktreeClean: boolean;
	try {
		if (!gitBranchExists(name)) {
			throw new Error(`Git branch "${name}" does not exist.`);
		}
		currentRefBefore = currentGitRef();
		if (currentRefBefore === name) {
			throw new Error(`Git branch "${name}" is already active.`);
		}
		worktreeClean = gitWorktreeIsClean();
		node = showGitTimelineNode(name);
	} catch (err) {
		exitForGitError(err);
	}
	const envelope = createGitSwitchPreviewEnvelope(
		node,
		name,
		currentRefBefore,
		worktreeClean,
	);

	if (opts.json) {
		outputTreeJson(envelope);
		return;
	}

	const plan = envelope.plan;
	if (plan.action !== "switch") {
		throw new Error("Unexpected git switch preview plan shape.");
	}
	const substrate = plan.substrate;
	console.log(chalk.bold("\n  Tree switch preview (dry-run)\n"));
	console.log(
		`  Target: ${chalk.cyan(envelope.target.metadata.shortId)}  ${chalk.white(envelope.target.label)}`,
	);
	console.log(
		`  Would:  switch git worktree from ${chalk.cyan(substrate.currentRefBefore)} to ${chalk.cyan(substrate.targetRefAfter)}`,
	);
	console.log(
		chalk.dim(`  Worktree clean: ${substrate.worktreeClean ? "yes" : "no"}`),
	);
	console.log(chalk.dim(`  Command: ${plan.recommendedCommand}\n`));
}

export function forkGitTree(
	prefix: string,
	opts: { json?: boolean; name: string },
): void {
	let node: RefarmGitTimelineNode;
	let currentRefBefore: string;
	let currentRefAfter: string;
	try {
		node = showGitTimelineNode(prefix);
		if (gitBranchExists(opts.name)) {
			throw new Error(`Git branch "${opts.name}" already exists.`);
		}
		currentRefBefore = currentGitRef();
		runGit(["branch", opts.name, node.nodeId]);
		currentRefAfter = currentGitRef();
		if (currentRefBefore !== currentRefAfter) {
			throw new Error(
				`Git worktree changed from "${currentRefBefore}" to "${currentRefAfter}" during tree fork.`,
			);
		}
	} catch (err) {
		exitForGitError(err);
	}
	const envelope = createGitForkEnvelope(
		node,
		opts.name,
		currentRefBefore,
		currentRefAfter,
	);

	if (opts.json) {
		outputTreeJson(envelope);
		return;
	}

	console.log(
		chalk.green(
			`✓  Created git branch ${chalk.cyan(opts.name)} at ${chalk.cyan(node.metadata.shortId)}.`,
		),
	);
	console.log(chalk.dim("   Active worktree was not switched."));
}

export function switchGitTree(name: string, opts: { json?: boolean }): void {
	let node: RefarmGitTimelineNode;
	let currentRefBefore: string;
	let currentRefAfter: string;
	try {
		if (!gitBranchExists(name)) {
			throw new Error(`Git branch "${name}" does not exist.`);
		}
		currentRefBefore = currentGitRef();
		if (currentRefBefore === name) {
			throw new Error(`Git branch "${name}" is already active.`);
		}
		assertCleanGitWorktree();
		node = showGitTimelineNode(name);
		runGit(["switch", name]);
		currentRefAfter = currentGitRef();
		if (currentRefAfter !== name) {
			throw new Error(
				`Git switch expected current ref "${name}", got "${currentRefAfter}".`,
			);
		}
	} catch (err) {
		exitForGitError(err);
	}
	const envelope = createGitSwitchEnvelope(
		node,
		name,
		currentRefBefore,
		currentRefAfter,
	);

	if (opts.json) {
		outputTreeJson(envelope);
		return;
	}

	console.log(
		chalk.green(
			`✓  Switched git worktree from ${chalk.cyan(currentRefBefore)} to ${chalk.cyan(currentRefAfter)}.`,
		),
	);
	console.log(chalk.dim(`   Target commit ${node.metadata.shortId}.`));
}
