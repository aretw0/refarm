import * as childProcess from "node:child_process";
import chalk from "chalk";
import {
	outputTreeJson,
	REFARM_TREE_GIT_SCOPE,
	REFARM_TREE_SCHEMA_VERSION,
	type RefarmTimelineForkEnvelope,
	type RefarmTimelineListEnvelope,
	type RefarmTimelineNode,
	type RefarmTimelinePreviewEnvelope,
	type RefarmTimelineShowEnvelope,
} from "./tree-model.js";

function createGitTimelineNode(line: string): RefarmTimelineNode | null {
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

function listGitTimelineNodes(limit: number): RefarmTimelineNode[] {
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
		.filter((node): node is RefarmTimelineNode => Boolean(node));
}

function showGitTimelineNode(ref: string): RefarmTimelineNode {
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
	let nodes: RefarmTimelineNode[];
	try {
		nodes = listGitTimelineNodes(opts.limit ?? 20);
	} catch (err) {
		exitForGitError(err);
	}

	if (opts.json) {
		const envelope: RefarmTimelineListEnvelope = {
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
				"\n  refarm tree preview --scope git <commit>\n",
		),
	);
}

export function showGitTree(prefix: string, opts: { json?: boolean }): void {
	let node: RefarmTimelineNode;
	try {
		node = showGitTimelineNode(prefix);
	} catch (err) {
		exitForGitError(err);
	}

	if (opts.json) {
		const envelope: RefarmTimelineShowEnvelope = {
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
	node: RefarmTimelineNode,
	name: string | undefined,
): RefarmTimelinePreviewEnvelope {
	const branchName = name ?? "<branch-name>";
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan: {
			kind: "git-branch",
			destructive: false,
			worktreeSwitched: false,
			baseCommit: node.nodeId,
			recommendedCommand: `refarm tree fork --scope git ${node.metadata.shortId} --name ${branchName}`,
		},
	};
}

function createGitForkEnvelope(
	node: RefarmTimelineNode,
	name: string,
	currentRefBefore: string,
	currentRefAfter: string,
): RefarmTimelineForkEnvelope {
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

export function previewGitTree(
	prefix: string,
	opts: { json?: boolean; name?: string },
): void {
	let node: RefarmTimelineNode;
	try {
		node = showGitTimelineNode(prefix);
	} catch (err) {
		exitForGitError(err);
	}
	const envelope = createGitPreviewEnvelope(node, opts.name);

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

export function forkGitTree(
	prefix: string,
	opts: { json?: boolean; name: string },
): void {
	let node: RefarmTimelineNode;
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
