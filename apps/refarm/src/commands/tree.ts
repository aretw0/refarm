import chalk from "chalk";
import { Command } from "commander";
import {
	forkGitTree,
	getGitTimelineNodes,
	listGitTree,
	previewGitSwitchTree,
	previewGitTree,
	showGitTree,
	switchGitTree,
} from "./tree-git.js";
import {
	outputTreeJson,
	REFARM_TREE_ALL_SCOPE,
	REFARM_TREE_GIT_SCOPE,
	REFARM_TREE_SCHEMA_VERSION,
	REFARM_TREE_SESSION_SCOPE,
	type RefarmAllTimelineListEnvelope,
	type RefarmTimelineScope,
} from "./tree-model.js";
import {
	getSessionTimelineNodes,
	listSessionTree,
	previewSessionSwitchTree,
	previewSessionTree,
	showSessionTree,
	switchSessionTree,
} from "./tree-session.js";

type RefarmTimelineListScope =
	| RefarmTimelineScope
	| typeof REFARM_TREE_ALL_SCOPE;

function parseScope(scope: string | undefined): RefarmTimelineScope {
	const value = scope ?? REFARM_TREE_SESSION_SCOPE;
	if (value === REFARM_TREE_SESSION_SCOPE || value === REFARM_TREE_GIT_SCOPE) {
		return value;
	}
	console.error(
		chalk.red(
			`✗  refarm tree currently supports --scope session|git for this operation; received "${value}".`,
		),
	);
	process.exit(1);
}

function parseListScope(scope: string | undefined): RefarmTimelineListScope {
	const value = scope ?? REFARM_TREE_SESSION_SCOPE;
	if (
		value === REFARM_TREE_SESSION_SCOPE ||
		value === REFARM_TREE_GIT_SCOPE ||
		value === REFARM_TREE_ALL_SCOPE
	) {
		return value;
	}
	console.error(
		chalk.red(
			`✗  refarm tree list currently supports --scope session|git|all; received "${value}".`,
		),
	);
	process.exit(1);
}

function requireBranchName(name: string | undefined): string {
	if (!name) {
		console.error(
			chalk.red("✗  refarm tree fork requires --name <branch-name>."),
		);
		process.exit(1);
	}
	return validateBranchName(name);
}

function validateOptionalBranchName(
	name: string | undefined,
): string | undefined {
	if (!name) return undefined;
	return validateBranchName(name);
}

function validateBranchName(name: string): string {
	const hasSafeChars = /^[A-Za-z0-9._/-]+$/u.test(name);
	const hasUnsafeShape =
		name === "HEAD" ||
		name.startsWith("-") ||
		name.startsWith("/") ||
		name.startsWith("refs/") ||
		name.endsWith("/") ||
		name.includes("..") ||
		name.includes("//") ||
		name
			.split("/")
			.some(
				(part) =>
					part === "" ||
					part.startsWith(".") ||
					part.endsWith(".") ||
					part.endsWith(".lock"),
			);
	if (!hasSafeChars || hasUnsafeShape) {
		console.error(
			chalk.red(
				`✗  Invalid branch name "${name}". Use safe git-style names with letters, numbers, '.', '_', '/', or '-' and no option-like, empty, hidden, or parent-traversal segments.`,
			),
		);
		process.exit(1);
	}
	return name;
}

function parseLimit(limit: string | undefined): number {
	const raw = limit ?? "20";
	if (!/^\d+$/u.test(raw)) {
		console.error(
			chalk.red(`✗  Invalid --limit "${limit}". Use an integer from 1 to 200.`),
		);
		process.exit(1);
	}
	const value = Number.parseInt(raw, 10);
	if (!Number.isInteger(value) || value < 1 || value > 200) {
		console.error(
			chalk.red(`✗  Invalid --limit "${limit}". Use an integer from 1 to 200.`),
		);
		process.exit(1);
	}
	return value;
}

function exitForAllListError(err: unknown): never {
	const msg = err instanceof Error ? err.message : String(err);
	if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
		console.error(chalk.red("✗  farmhand sidecar is not running."));
		console.error(chalk.dim("   Start it:  npm run farmhand:daemon"));
	} else {
		console.error(chalk.red(`✗  ${msg}`));
	}
	process.exit(1);
}

function compareAllTimelineNodes(
	a: RefarmAllTimelineListEnvelope["nodes"][number],
	b: RefarmAllTimelineListEnvelope["nodes"][number],
): number {
	return (
		b.timestamp.localeCompare(a.timestamp) ||
		a.kind.localeCompare(b.kind) ||
		a.metadata.shortId.localeCompare(b.metadata.shortId) ||
		a.nodeId.localeCompare(b.nodeId)
	);
}

async function listAllTree(opts: {
	json?: boolean;
	limit?: string;
}): Promise<void> {
	const limit = parseLimit(opts.limit);
	let nodes: RefarmAllTimelineListEnvelope["nodes"];
	try {
		const [sessionNodes, gitNodes] = await Promise.all([
			getSessionTimelineNodes(limit),
			Promise.resolve(getGitTimelineNodes(limit)),
		]);
		nodes = [...sessionNodes, ...gitNodes]
			.sort(compareAllTimelineNodes)
			.slice(0, limit);
	} catch (err) {
		exitForAllListError(err);
	}

	if (opts.json) {
		const envelope: RefarmAllTimelineListEnvelope = {
			schemaVersion: REFARM_TREE_SCHEMA_VERSION,
			command: "tree",
			scope: REFARM_TREE_ALL_SCOPE,
			operation: "list",
			nodes,
		};
		outputTreeJson(envelope);
		return;
	}

	if (nodes.length === 0) {
		console.log(chalk.dim("No session or git timeline nodes found."));
		return;
	}
	console.log(
		chalk.bold(`\n  Tree timeline  (${REFARM_TREE_ALL_SCOPE} scope)\n`),
	);
	for (const node of nodes) {
		console.log(
			`  ${chalk.cyan(node.metadata.shortId)}  ${chalk.dim(`[${node.kind}]`)}  ${chalk.white(node.label)}`,
		);
	}
	console.log(
		chalk.dim(
			"\n  refarm tree show <id-prefix>              inspect a session node" +
				"\n  refarm tree show --scope git <commit>     inspect a git node" +
				"\n  refarm tree preview <id-prefix>           preview a session plan" +
				"\n  refarm tree preview --scope git <commit>  preview a git plan\n",
		),
	);
}

async function listTree(opts: {
	scope?: string;
	json?: boolean;
	limit?: string;
}): Promise<void> {
	const scope = parseListScope(opts.scope);
	if (scope === REFARM_TREE_ALL_SCOPE) {
		await listAllTree(opts);
		return;
	}
	if (scope === REFARM_TREE_GIT_SCOPE) {
		listGitTree({ json: opts.json, limit: parseLimit(opts.limit) });
		return;
	}
	await listSessionTree({ json: opts.json, limit: parseLimit(opts.limit) });
}

async function showTree(
	prefix: string,
	opts: { json?: boolean; scope?: string },
): Promise<void> {
	const scope = parseScope(opts.scope);
	if (scope === REFARM_TREE_GIT_SCOPE) {
		showGitTree(prefix, opts);
		return;
	}
	await showSessionTree(prefix, opts);
}

async function previewTree(
	prefix: string,
	opts: {
		json?: boolean;
		scope?: string;
		at?: string;
		name?: string;
		switch?: boolean;
	},
): Promise<void> {
	const scope = parseScope(opts.scope);
	if (scope === REFARM_TREE_GIT_SCOPE) {
		if (opts.at) {
			console.error(
				chalk.red("✗  --at is only supported for session timelines."),
			);
			process.exit(1);
		}
		if (opts.switch) {
			if (opts.name) {
				console.error(
					chalk.red(
						"✗  --name is only supported for fork previews; omit it when previewing a tree switch.",
					),
				);
				process.exit(1);
			}
			previewGitSwitchTree(validateBranchName(prefix), opts);
			return;
		}
		const name = validateOptionalBranchName(opts.name);
		previewGitTree(prefix, { ...opts, name });
		return;
	}
	if (opts.switch) {
		if (opts.name) {
			console.error(
				chalk.red(
					"✗  --name is only supported for fork previews; omit it when previewing a tree switch.",
				),
			);
			process.exit(1);
		}
		if (opts.at) {
			console.error(
				chalk.red(
					"✗  --at is only supported for session fork previews; omit it when previewing a tree switch.",
				),
			);
			process.exit(1);
		}
		await previewSessionSwitchTree(prefix, opts);
		return;
	}
	const name = validateOptionalBranchName(opts.name);
	await previewSessionTree(prefix, { ...opts, name });
}

async function forkTree(
	prefix: string,
	opts: { json?: boolean; scope?: string; at?: string; name?: string },
): Promise<void> {
	const scope = parseScope(opts.scope);
	if (scope !== REFARM_TREE_GIT_SCOPE) {
		console.error(
			chalk.red(
				"✗  refarm tree fork currently supports --scope git only; use refarm sessions fork for session timelines.",
			),
		);
		process.exit(1);
	}
	if (opts.at) {
		console.error(
			chalk.red("✗  --at is only supported for session timelines."),
		);
		process.exit(1);
	}
	const name = requireBranchName(opts.name);
	forkGitTree(prefix, { ...opts, name });
}

async function switchTree(
	target: string,
	opts: { json?: boolean; scope?: string },
): Promise<void> {
	const scope = parseScope(opts.scope);
	if (scope === REFARM_TREE_GIT_SCOPE) {
		const branchName = validateBranchName(target);
		switchGitTree(branchName, opts);
		return;
	}
	await switchSessionTree(target, opts);
}

export function createTreeCommand(): Command {
	return new Command("tree")
		.description("Inspect and preview substrate-agnostic Refarm timelines")
		.addCommand(
			new Command("list")
				.description("List timeline nodes")
				.option(
					"--scope <scope>",
					"Timeline scope: session, git, or all",
					REFARM_TREE_SESSION_SCOPE,
				)
				.option("--limit <count>", "Maximum timeline nodes to list", "20")
				.option("--json", "Print machine-readable JSON")
				.action(
					async (opts: { scope?: string; limit?: string; json?: boolean }) => {
						await listTree(opts);
					},
				),
		)
		.addCommand(
			new Command("show")
				.description("Show a timeline node by ID prefix")
				.argument("<id>", "Timeline node ID or unique prefix")
				.option(
					"--scope <scope>",
					"Timeline scope: session or git",
					REFARM_TREE_SESSION_SCOPE,
				)
				.option("--json", "Print machine-readable JSON")
				.action(
					async (prefix: string, opts: { scope?: string; json?: boolean }) => {
						await showTree(prefix, opts);
					},
				),
		)
		.addCommand(
			new Command("preview")
				.description("Preview a safe fork or switch plan for a timeline node")
				.argument("<target>", "Session ID/prefix, git commit, or git branch")
				.option(
					"--scope <scope>",
					"Timeline scope: session or git",
					REFARM_TREE_SESSION_SCOPE,
				)
				.option("--at <entry-id>", "Session entry to use as the branch point")
				.option(
					"--name <branch-name>",
					"Branch/fork name to include in the dry-run plan",
				)
				.option(
					"--switch",
					"Preview switching to an existing session or git branch",
				)
				.option("--json", "Print machine-readable JSON")
				.action(
					async (
						prefix: string,
						opts: {
							scope?: string;
							at?: string;
							name?: string;
							switch?: boolean;
							json?: boolean;
						},
					) => {
						await previewTree(prefix, opts);
					},
				),
		)
		.addCommand(
			new Command("fork")
				.description(
					"Create an explicit non-switching git fork from a timeline node",
				)
				.argument("<commit>", "Git commit-ish to fork from")
				.option(
					"--scope <scope>",
					"Timeline scope: git for tree fork; use refarm sessions fork for sessions",
					REFARM_TREE_SESSION_SCOPE,
				)
				.option("--at <entry-id>", "Session entry to use as the branch point")
				.requiredOption("--name <branch-name>", "Branch/fork name to create")
				.option("--json", "Print machine-readable JSON")
				.action(
					async (
						prefix: string,
						opts: {
							scope?: string;
							at?: string;
							name?: string;
							json?: boolean;
						},
					) => {
						await forkTree(prefix, opts);
					},
				),
		)
		.addCommand(
			new Command("switch")
				.description("Switch the active timeline pointer")
				.argument("<target>", "Session ID/prefix or existing git branch")
				.option(
					"--scope <scope>",
					"Timeline scope: session or git",
					REFARM_TREE_SESSION_SCOPE,
				)
				.option("--json", "Print machine-readable JSON")
				.action(
					async (target: string, opts: { scope?: string; json?: boolean }) => {
						await switchTree(target, opts);
					},
				),
		)
		.action(async () => {
			await listTree({ scope: REFARM_TREE_SESSION_SCOPE });
		});
}

export const treeCommand = createTreeCommand();
