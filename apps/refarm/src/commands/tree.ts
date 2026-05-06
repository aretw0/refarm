import chalk from "chalk";
import { Command } from "commander";
import { listGitTree, previewGitTree, showGitTree } from "./tree-git.js";
import {
	REFARM_TREE_GIT_SCOPE,
	REFARM_TREE_SESSION_SCOPE,
	type RefarmTimelineScope,
} from "./tree-model.js";
import {
	listSessionTree,
	previewSessionTree,
	showSessionTree,
} from "./tree-session.js";

function parseScope(scope: string | undefined): RefarmTimelineScope {
	const value = scope ?? REFARM_TREE_SESSION_SCOPE;
	if (value === REFARM_TREE_SESSION_SCOPE || value === REFARM_TREE_GIT_SCOPE) {
		return value;
	}
	console.error(
		chalk.red(
			`✗  refarm tree currently supports --scope session|git; received "${value}".`,
		),
	);
	process.exit(1);
}

function validateBranchName(name: string | undefined): string | undefined {
	if (!name) return undefined;
	if (!/^[A-Za-z0-9._/-]+$/u.test(name)) {
		console.error(
			chalk.red(
				`✗  Invalid branch name "${name}". Use letters, numbers, '.', '_', '/', or '-'.`,
			),
		);
		process.exit(1);
	}
	return name;
}

function parseLimit(limit: string | undefined): number {
	const value = Number.parseInt(limit ?? "20", 10);
	if (!Number.isInteger(value) || value < 1 || value > 200) {
		console.error(chalk.red(`✗  Invalid --limit "${limit}". Use an integer from 1 to 200.`));
		process.exit(1);
	}
	return value;
}

async function listTree(opts: {
	scope?: string;
	json?: boolean;
	limit?: string;
}): Promise<void> {
	const scope = parseScope(opts.scope);
	if (scope === REFARM_TREE_GIT_SCOPE) {
		listGitTree({ json: opts.json, limit: parseLimit(opts.limit) });
		return;
	}
	await listSessionTree(opts);
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
	opts: { json?: boolean; scope?: string; at?: string; name?: string },
): Promise<void> {
	const scope = parseScope(opts.scope);
	const name = validateBranchName(opts.name);
	if (scope === REFARM_TREE_GIT_SCOPE) {
		if (opts.at) {
			console.error(
				chalk.red("✗  --at is only supported for session timelines."),
			);
			process.exit(1);
		}
		previewGitTree(prefix, { ...opts, name });
		return;
	}
	await previewSessionTree(prefix, { ...opts, name });
}

export function createTreeCommand(): Command {
	return new Command("tree")
		.description("Inspect and preview substrate-agnostic Refarm timelines")
		.addCommand(
			new Command("list")
				.description("List timeline nodes")
				.option("--scope <scope>", "Timeline scope", REFARM_TREE_SESSION_SCOPE)
				.option("--limit <count>", "Maximum git commits to list", "20")
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
				.option("--scope <scope>", "Timeline scope", REFARM_TREE_SESSION_SCOPE)
				.option("--json", "Print machine-readable JSON")
				.action(
					async (prefix: string, opts: { scope?: string; json?: boolean }) => {
						await showTree(prefix, opts);
					},
				),
		)
		.addCommand(
			new Command("preview")
				.description("Preview the safe fork plan for a timeline node")
				.argument("<id>", "Timeline node ID or unique prefix")
				.option("--scope <scope>", "Timeline scope", REFARM_TREE_SESSION_SCOPE)
				.option("--at <entry-id>", "Session entry to use as the branch point")
				.option("--name <branch-name>", "Branch/fork name to include in the dry-run plan")
				.option("--json", "Print machine-readable JSON")
				.action(
					async (
						prefix: string,
						opts: { scope?: string; at?: string; name?: string; json?: boolean },
					) => {
						await previewTree(prefix, opts);
					},
				),
		)
		.action(async () => {
			await listTree({ scope: REFARM_TREE_SESSION_SCOPE });
		});
}

export const treeCommand = createTreeCommand();
