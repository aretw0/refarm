import {
	readGitCommand,
	runGitCommand,
} from "@refarm.dev/cli/git-command";
import chalk from "chalk";
import { formatExecutionPlanReadinessLine } from "./execution-plan.js";
import { buildJsonErrorEnvelope, printJson } from "./json-output.js";
import {
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
} from "./runtime-recovery.js";
import {
	buildGitBranchPreviewEnvelope,
	buildGitForkEnvelope,
	buildGitSwitchEnvelope,
	buildGitSwitchPreviewEnvelope,
	buildGitTimelineListEnvelope,
	buildGitTimelineShowEnvelope,
	outputTreeJson,
	REFARM_TREE_GIT_SCOPE,
	type RefarmGitTimelineNode,
} from "./tree-model.js";

const TREE_GIT_LIST_JSON_COMMAND = "refarm tree list --scope git --json";

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
	return readGitCommand(args);
}

function gitBranchExists(name: string): boolean {
	const result = runGitCommand([
		"show-ref",
		"--verify",
		"--quiet",
		`refs/heads/${name}`,
	]);
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

export function getGitTimelineNodes(limit: number): RefarmGitTimelineNode[] {
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

function reportGitError(
	err: unknown,
	opts: { json?: boolean; operation: "list" | "show" | "preview" | "fork" | "switch"; target?: string },
): void {
	const msg = err instanceof Error ? err.message : String(err);
	if (opts.json) {
		const nextCommand =
			opts.operation === "list"
				? RUNTIME_DOCTOR_NEXT_COMMAND
				: TREE_GIT_LIST_JSON_COMMAND;
		printJson(
			buildJsonErrorEnvelope({
				command: "tree",
				operation: opts.operation,
				error: `git-tree-${opts.operation}-failed`,
				message: msg,
				nextAction:
					opts.operation === "list"
						? RUNTIME_DOCTOR_NEXT_ACTION_COMMAND
						: TREE_GIT_LIST_JSON_COMMAND,
				nextActions: [
					opts.operation === "list"
						? RUNTIME_DOCTOR_NEXT_ACTION_COMMAND
						: TREE_GIT_LIST_JSON_COMMAND,
				],
				nextCommand,
				nextCommands:
					opts.operation === "list"
						? [RUNTIME_DOCTOR_NEXT_COMMAND]
						: [TREE_GIT_LIST_JSON_COMMAND, RUNTIME_DOCTOR_NEXT_COMMAND],
				extra: {
					scope: REFARM_TREE_GIT_SCOPE,
					...(opts.target ? { target: opts.target } : {}),
				},
			}),
		);
		process.exitCode = 1;
		return;
	}
	console.error(chalk.red(`✗  ${msg}`));
	process.exitCode = 1;
}

export function listGitTree(opts: { json?: boolean; limit?: number }): void {
	let nodes: RefarmGitTimelineNode[];
	try {
		nodes = getGitTimelineNodes(opts.limit ?? 20);
	} catch (err) {
		reportGitError(err, { ...opts, operation: "list" });
		return;
	}

	if (opts.json) {
		outputTreeJson(buildGitTimelineListEnvelope(nodes));
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
		reportGitError(err, { ...opts, operation: "show", target: prefix });
		return;
	}

	if (opts.json) {
		outputTreeJson(buildGitTimelineShowEnvelope(node));
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
		reportGitError(err, { ...opts, operation: "preview", target: prefix });
		return;
	}
	const envelope = buildGitBranchPreviewEnvelope({
		node,
		name: opts.name,
		branchAlreadyExists,
	});

	if (opts.json) {
		outputTreeJson(envelope);
		return;
	}

	console.log(chalk.bold("\n  Tree preview (dry-run)\n"));
	console.log(
		`  Target: ${chalk.cyan(envelope.target.metadata.shortId)}  ${chalk.white(envelope.target.label)}`,
	);
	console.log("  Would:  create a non-destructive git branch");
	const readiness = formatExecutionPlanReadinessLine(envelope.plan);
	console.log(
		readiness.status === "blocked"
			? chalk.yellow(`  ${readiness.label}`)
			: chalk.dim(`  ${readiness.label}`),
	);
	console.log(
		chalk.dim(
			`  Command: ${envelope.plan.recommendedCommand ?? envelope.templates[0]?.command ?? "(blocked)"}\n`,
		),
	);
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
		worktreeClean = gitWorktreeIsClean();
		node = showGitTimelineNode(name);
	} catch (err) {
		reportGitError(err, { ...opts, operation: "preview", target: name });
		return;
	}
	const envelope = buildGitSwitchPreviewEnvelope({
		node,
		name,
		currentRefBefore,
		worktreeClean,
		blockedReason:
			currentRefBefore === name
				? `Git branch "${name}" is already active.`
				: undefined,
	});

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
	const readiness = formatExecutionPlanReadinessLine(plan);
	console.log(
		readiness.status === "blocked"
			? chalk.yellow(`  ${readiness.label}`)
			: chalk.dim(`  ${readiness.label}`),
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
		reportGitError(err, { ...opts, operation: "fork", target: prefix });
		return;
	}
	const envelope = buildGitForkEnvelope({
		node,
		name: opts.name,
		currentRefBefore,
		currentRefAfter,
	});

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
		reportGitError(err, { ...opts, operation: "switch", target: name });
		return;
	}
	const envelope = buildGitSwitchEnvelope({
		node,
		name,
		currentRefBefore,
		currentRefAfter,
	});

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
