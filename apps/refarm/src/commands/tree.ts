import * as childProcess from "node:child_process";
import chalk from "chalk";
import { Command } from "commander";

const SIDECAR_URL = "http://127.0.0.1:42001";
const SESSION_SCOPE = "session";
const GIT_SCOPE = "git";

type RefarmTimelineScope = typeof SESSION_SCOPE | typeof GIT_SCOPE;

interface SessionNode {
	"@id": string;
	"@type": string;
	name?: string;
	created_at_ns?: number;
	leaf_entry_id?: string | null;
	parent_session_id?: string | null;
}

interface HistoryEntry {
	id: string;
	kind: string;
	content: string;
	timestamp_ns: number;
}

interface SessionHistory {
	session: SessionNode;
	entries: HistoryEntry[];
	total: number;
}

export interface RefarmTimelineNode {
	timelineId: RefarmTimelineScope;
	nodeId: string;
	parentNodeId?: string;
	branchId?: string;
	kind: RefarmTimelineScope;
	label: string;
	timestamp: string;
	metadata: {
		shortId: string;
		leafEntryId?: string | null;
		hasHistory?: boolean;
		refs?: string[];
	};
}

interface RefarmTimelinePreviewEnvelope {
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "preview";
	reason: "dry-run";
	target: RefarmTimelineNode;
	plan:
		| {
				kind: "session-fork";
				destructive: false;
				branchPointEntryId: string | null;
				recommendedCommand: string;
		  }
		| {
				kind: "git-branch";
				destructive: false;
				baseCommit: string;
				recommendedCommand: string;
		  };
}

function formatSessionId(id: string): string {
	const parts = id.split(":");
	return parts.at(-1)?.slice(-12) ?? id;
}

function nsToIso(ns: number | undefined): string {
	if (!ns) return new Date(0).toISOString();
	return new Date(Math.floor(ns / 1_000_000)).toISOString();
}

function formatAge(createdAtNs: number | undefined): string {
	if (!createdAtNs) return "";
	const ageMs = Date.now() - createdAtNs / 1_000_000;
	const mins = Math.floor(ageMs / 60_000);
	const hours = Math.floor(mins / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (mins > 0) return `${mins}m ago`;
	return "just now";
}

function createSessionTimelineNode(session: SessionNode): RefarmTimelineNode {
	return {
		timelineId: SESSION_SCOPE,
		nodeId: session["@id"],
		parentNodeId: session.parent_session_id ?? undefined,
		branchId: session["@id"],
		kind: SESSION_SCOPE,
		label: session.name ?? "unnamed",
		timestamp: nsToIso(session.created_at_ns),
		metadata: {
			shortId: formatSessionId(session["@id"]),
			leafEntryId: session.leaf_entry_id ?? null,
			hasHistory: Boolean(session.leaf_entry_id),
		},
	};
}

function createGitTimelineNode(line: string): RefarmTimelineNode | null {
	const [hash, parents, refs, timestamp, subject] = line.split("\u001f");
	if (!hash) return null;
	const refList = refs ? refs.split(", ").filter(Boolean) : [];
	return {
		timelineId: GIT_SCOPE,
		nodeId: hash,
		parentNodeId: parents?.split(" ").filter(Boolean)[0],
		branchId: refList[0],
		kind: GIT_SCOPE,
		label: subject || hash.slice(0, 12),
		timestamp: timestamp || new Date(0).toISOString(),
		metadata: {
			shortId: hash.slice(0, 12),
			refs: refList,
		},
	};
}

function parseScope(scope: string | undefined): RefarmTimelineScope {
	const value = scope ?? SESSION_SCOPE;
	if (value === SESSION_SCOPE || value === GIT_SCOPE) return value;
	console.error(
		chalk.red(
			`✗  refarm tree currently supports --scope session|git; received "${value}".`,
		),
	);
	process.exit(1);
}

async function fetchSessions(): Promise<SessionNode[]> {
	const response = await fetch(`${SIDECAR_URL}/sessions`);
	if (!response.ok) {
		throw new Error(`sidecar HTTP ${response.status}`);
	}
	const body = (await response.json()) as { sessions?: SessionNode[] };
	return body.sessions ?? [];
}

async function fetchSessionHistory(prefix: string): Promise<SessionHistory> {
	const response = await fetch(
		`${SIDECAR_URL}/sessions/${encodeURIComponent(prefix)}/history`,
	);
	const body = (await response.json()) as SessionHistory & {
		error?: string;
		matches?: string[];
	};
	if (response.status === 404) {
		console.error(chalk.red(`✗  No timeline node matching "${prefix}"`));
		process.exit(1);
	}
	if (response.status === 409) {
		console.error(
			chalk.red(`✗  Ambiguous timeline node "${prefix}" — ${body.error}`),
		);
		for (const match of body.matches ?? []) console.error(chalk.dim(`   ${match}`));
		process.exit(1);
	}
	if (!response.ok) {
		console.error(chalk.red(`✗  ${body.error ?? `HTTP ${response.status}`}`));
		process.exit(1);
	}
	return body;
}

function runGit(args: string[]): string {
	const result = childProcess.spawnSync("git", args, {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		const detail = result.stderr || result.stdout || `git ${args.join(" ")} failed`;
		throw new Error(detail.trim());
	}
	return result.stdout.trim();
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

function exitForSidecarError(err: unknown): never {
	const msg = err instanceof Error ? err.message : String(err);
	if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
		console.error(chalk.red("✗  farmhand sidecar is not running."));
		console.error(chalk.dim("   Start it:  npm run farmhand:daemon"));
	} else {
		console.error(chalk.red(`✗  ${msg}`));
	}
	process.exit(1);
}

function exitForGitError(err: unknown): never {
	const msg = err instanceof Error ? err.message : String(err);
	console.error(chalk.red(`✗  ${msg}`));
	process.exit(1);
}

function outputJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

async function listSessionTree(opts: { json?: boolean }): Promise<void> {
	let sessions: SessionNode[];
	try {
		sessions = await fetchSessions();
	} catch (err) {
		exitForSidecarError(err);
	}

	const nodes = [...sessions]
		.sort((a, b) => (b.created_at_ns ?? 0) - (a.created_at_ns ?? 0))
		.map(createSessionTimelineNode);

	if (opts.json) {
		outputJson({ command: "tree", scope: SESSION_SCOPE, nodes });
		return;
	}

	if (nodes.length === 0) {
		console.log(
			chalk.dim("No session timeline nodes yet. Start one with: refarm ask <query>"),
		);
		return;
	}

	console.log(chalk.bold(`\n  Tree timeline  (${SESSION_SCOPE} scope)\n`));
	for (const node of nodes) {
		const createdAtNs = sessions.find(
			(session) => session["@id"] === node.nodeId,
		)?.created_at_ns;
		const history = node.metadata.hasHistory ? chalk.dim(" · has history") : "";
		console.log(
			`  ${chalk.cyan(node.metadata.shortId)}  ${chalk.white(node.label)}  ${chalk.dim(formatAge(createdAtNs))}${history}`,
		);
	}
	console.log(
		chalk.dim(
			"\n  refarm tree show <id-prefix>      inspect a node" +
				"\n  refarm tree preview <id-prefix>   preview a safe fork plan\n",
		),
	);
}

function listGitTree(opts: { json?: boolean; limit?: number }): void {
	let nodes: RefarmTimelineNode[];
	try {
		nodes = listGitTimelineNodes(opts.limit ?? 20);
	} catch (err) {
		exitForGitError(err);
	}

	if (opts.json) {
		outputJson({ command: "tree", scope: GIT_SCOPE, nodes });
		return;
	}

	if (nodes.length === 0) {
		console.log(chalk.dim("No git commits found."));
		return;
	}

	console.log(chalk.bold(`\n  Tree timeline  (${GIT_SCOPE} scope)\n`));
	for (const node of nodes) {
		const refs = node.metadata.refs?.length
			? chalk.dim(` · ${node.metadata.refs.join(", ")}`)
			: "";
		console.log(`  ${chalk.cyan(node.metadata.shortId)}  ${chalk.white(node.label)}${refs}`);
	}
	console.log(
		chalk.dim(
			"\n  refarm tree show --scope git <commit>" +
				"\n  refarm tree preview --scope git <commit>\n",
		),
	);
}

async function listTree(opts: {
	scope?: string;
	json?: boolean;
	limit?: string;
}): Promise<void> {
	const scope = parseScope(opts.scope);
	if (scope === GIT_SCOPE) {
		listGitTree({ json: opts.json, limit: Number(opts.limit ?? 20) });
		return;
	}
	await listSessionTree(opts);
}

async function showSessionTree(prefix: string, opts: { json?: boolean }): Promise<void> {
	let history: SessionHistory;
	try {
		history = await fetchSessionHistory(prefix);
	} catch (err) {
		exitForSidecarError(err);
	}
	const node = createSessionTimelineNode(history.session);

	if (opts.json) {
		outputJson({
			command: "tree",
			scope: SESSION_SCOPE,
			operation: "show",
			node,
			entries: history.entries,
			total: history.total,
		});
		return;
	}

	console.log(
		chalk.bold(
			`\n  Timeline node ${chalk.cyan(node.metadata.shortId)}  ${chalk.white(node.label)}`,
		),
	);
	console.log(
		chalk.dim(`  kind=${node.kind} timeline=${node.timelineId} total=${history.total}`),
	);
	if (node.parentNodeId) console.log(chalk.dim(`  parent=${node.parentNodeId}`));
	if (node.metadata.leafEntryId) {
		console.log(chalk.dim(`  leaf=${node.metadata.leafEntryId}`));
	}
	console.log();
}

function showGitTree(prefix: string, opts: { json?: boolean }): void {
	let node: RefarmTimelineNode;
	try {
		node = showGitTimelineNode(prefix);
	} catch (err) {
		exitForGitError(err);
	}

	if (opts.json) {
		outputJson({ command: "tree", scope: GIT_SCOPE, operation: "show", node });
		return;
	}

	console.log(
		chalk.bold(
			`\n  Timeline node ${chalk.cyan(node.metadata.shortId)}  ${chalk.white(node.label)}`,
		),
	);
	console.log(chalk.dim(`  kind=${node.kind} timeline=${node.timelineId}`));
	if (node.parentNodeId) console.log(chalk.dim(`  parent=${node.parentNodeId}`));
	if (node.metadata.refs?.length) {
		console.log(chalk.dim(`  refs=${node.metadata.refs.join(", ")}`));
	}
	console.log();
}

async function showTree(
	prefix: string,
	opts: { json?: boolean; scope?: string },
): Promise<void> {
	const scope = parseScope(opts.scope);
	if (scope === GIT_SCOPE) {
		showGitTree(prefix, opts);
		return;
	}
	await showSessionTree(prefix, opts);
}

function createSessionPreviewEnvelope(
	node: RefarmTimelineNode,
): RefarmTimelinePreviewEnvelope {
	return {
		command: "tree",
		scope: SESSION_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan: {
			kind: "session-fork",
			destructive: false,
			branchPointEntryId: node.metadata.leafEntryId ?? null,
			recommendedCommand: `refarm sessions fork ${node.metadata.shortId} --name <branch-name>`,
		},
	};
}

function createGitPreviewEnvelope(
	node: RefarmTimelineNode,
): RefarmTimelinePreviewEnvelope {
	return {
		command: "tree",
		scope: GIT_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan: {
			kind: "git-branch",
			destructive: false,
			baseCommit: node.nodeId,
			recommendedCommand: `git switch -c <branch-name> ${node.metadata.shortId}`,
		},
	};
}

async function previewSessionTree(
	prefix: string,
	opts: { json?: boolean },
): Promise<void> {
	let history: SessionHistory;
	try {
		history = await fetchSessionHistory(prefix);
	} catch (err) {
		exitForSidecarError(err);
	}
	const envelope = createSessionPreviewEnvelope(
		createSessionTimelineNode(history.session),
	);

	if (opts.json) {
		outputJson(envelope);
		return;
	}

	console.log(chalk.bold("\n  Tree preview (dry-run)\n"));
	console.log(
		`  Target: ${chalk.cyan(envelope.target.metadata.shortId)}  ${chalk.white(envelope.target.label)}`,
	);
	console.log("  Would:  create a non-destructive session fork");
	if (envelope.plan.kind === "session-fork" && envelope.plan.branchPointEntryId) {
		console.log(chalk.dim(`  Branch point: ${envelope.plan.branchPointEntryId}`));
	}
	console.log(chalk.dim(`  Command: ${envelope.plan.recommendedCommand}\n`));
}

function previewGitTree(prefix: string, opts: { json?: boolean }): void {
	let node: RefarmTimelineNode;
	try {
		node = showGitTimelineNode(prefix);
	} catch (err) {
		exitForGitError(err);
	}
	const envelope = createGitPreviewEnvelope(node);

	if (opts.json) {
		outputJson(envelope);
		return;
	}

	console.log(chalk.bold("\n  Tree preview (dry-run)\n"));
	console.log(
		`  Target: ${chalk.cyan(envelope.target.metadata.shortId)}  ${chalk.white(envelope.target.label)}`,
	);
	console.log("  Would:  create a non-destructive git branch");
	console.log(chalk.dim(`  Command: ${envelope.plan.recommendedCommand}\n`));
}

async function previewTree(
	prefix: string,
	opts: { json?: boolean; scope?: string },
): Promise<void> {
	const scope = parseScope(opts.scope);
	if (scope === GIT_SCOPE) {
		previewGitTree(prefix, opts);
		return;
	}
	await previewSessionTree(prefix, opts);
}

export function createTreeCommand(): Command {
	return new Command("tree")
		.description("Inspect and preview substrate-agnostic Refarm timelines")
		.addCommand(
			new Command("list")
				.description("List timeline nodes")
				.option("--scope <scope>", "Timeline scope", SESSION_SCOPE)
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
				.option("--scope <scope>", "Timeline scope", SESSION_SCOPE)
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
				.option("--scope <scope>", "Timeline scope", SESSION_SCOPE)
				.option("--json", "Print machine-readable JSON")
				.action(
					async (prefix: string, opts: { scope?: string; json?: boolean }) => {
						await previewTree(prefix, opts);
					},
				),
		)
		.action(async () => {
			await listTree({ scope: SESSION_SCOPE });
		});
}

export const treeCommand = createTreeCommand();
