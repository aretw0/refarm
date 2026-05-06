import chalk from "chalk";
import { Command } from "commander";

const SIDECAR_URL = "http://127.0.0.1:42001";
const SESSION_SCOPE = "session";

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
	timelineId: string;
	nodeId: string;
	parentNodeId?: string;
	branchId?: string;
	kind: "session";
	label: string;
	timestamp: string;
	metadata: {
		shortId: string;
		leafEntryId: string | null;
		hasHistory: boolean;
	};
}

interface RefarmTimelinePreviewEnvelope {
	command: "tree";
	scope: "session";
	operation: "preview";
	reason: "dry-run";
	target: RefarmTimelineNode;
	plan: {
		kind: "session-fork";
		destructive: false;
		branchPointEntryId: string | null;
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

function createTimelineNode(session: SessionNode): RefarmTimelineNode {
	return {
		timelineId: SESSION_SCOPE,
		nodeId: session["@id"],
		parentNodeId: session.parent_session_id ?? undefined,
		branchId: session["@id"],
		kind: "session",
		label: session.name ?? "unnamed",
		timestamp: nsToIso(session.created_at_ns),
		metadata: {
			shortId: formatSessionId(session["@id"]),
			leafEntryId: session.leaf_entry_id ?? null,
			hasHistory: Boolean(session.leaf_entry_id),
		},
	};
}

function assertSessionScope(scope: string): void {
	if (scope !== SESSION_SCOPE) {
		console.error(
			chalk.red(
				`✗  refarm tree currently supports --scope session only; received "${scope}".`,
			),
		);
		process.exit(1);
	}
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
		console.error(chalk.red(`✗  Ambiguous timeline node "${prefix}" — ${body.error}`));
		for (const match of body.matches ?? []) console.error(chalk.dim(`   ${match}`));
		process.exit(1);
	}
	if (!response.ok) {
		console.error(chalk.red(`✗  ${body.error ?? `HTTP ${response.status}`}`));
		process.exit(1);
	}
	return body;
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

function outputJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

async function listTree(opts: { scope?: string; json?: boolean }): Promise<void> {
	assertSessionScope(opts.scope ?? SESSION_SCOPE);
	let sessions: SessionNode[];
	try {
		sessions = await fetchSessions();
	} catch (err) {
		exitForSidecarError(err);
	}

	const nodes = [...sessions]
		.sort((a, b) => (b.created_at_ns ?? 0) - (a.created_at_ns ?? 0))
		.map(createTimelineNode);

	if (opts.json) {
		outputJson({ command: "tree", scope: SESSION_SCOPE, nodes });
		return;
	}

	if (nodes.length === 0) {
		console.log(chalk.dim("No session timeline nodes yet. Start one with: refarm ask <query>"));
		return;
	}

	console.log(chalk.bold(`\n  Tree timeline  (${SESSION_SCOPE} scope)\n`));
	for (const node of nodes) {
		const history = node.metadata.hasHistory ? chalk.dim(" · has history") : "";
		console.log(
			`  ${chalk.cyan(node.metadata.shortId)}  ${chalk.white(node.label)}  ${chalk.dim(formatAge(sessions.find((session) => session["@id"] === node.nodeId)?.created_at_ns))}${history}`,
		);
	}
	console.log(
		chalk.dim(
			"\n  refarm tree show <id-prefix>      inspect a node" +
				"\n  refarm tree preview <id-prefix>   preview a safe fork plan\n",
		),
	);
}

async function showTree(prefix: string, opts: { json?: boolean }): Promise<void> {
	let history: SessionHistory;
	try {
		history = await fetchSessionHistory(prefix);
	} catch (err) {
		exitForSidecarError(err);
	}
	const node = createTimelineNode(history.session);

	if (opts.json) {
		outputJson({ command: "tree", scope: SESSION_SCOPE, operation: "show", node, entries: history.entries, total: history.total });
		return;
	}

	console.log(chalk.bold(`\n  Timeline node ${chalk.cyan(node.metadata.shortId)}  ${chalk.white(node.label)}`));
	console.log(chalk.dim(`  kind=${node.kind} timeline=${node.timelineId} total=${history.total}`));
	if (node.parentNodeId) console.log(chalk.dim(`  parent=${node.parentNodeId}`));
	if (node.metadata.leafEntryId) console.log(chalk.dim(`  leaf=${node.metadata.leafEntryId}`));
	console.log();
}

function createPreviewEnvelope(node: RefarmTimelineNode): RefarmTimelinePreviewEnvelope {
	return {
		command: "tree",
		scope: SESSION_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan: {
			kind: "session-fork",
			destructive: false,
			branchPointEntryId: node.metadata.leafEntryId,
			recommendedCommand: `refarm sessions fork ${node.metadata.shortId} --name <branch-name>`,
		},
	};
}

async function previewTree(prefix: string, opts: { json?: boolean }): Promise<void> {
	let history: SessionHistory;
	try {
		history = await fetchSessionHistory(prefix);
	} catch (err) {
		exitForSidecarError(err);
	}
	const envelope = createPreviewEnvelope(createTimelineNode(history.session));

	if (opts.json) {
		outputJson(envelope);
		return;
	}

	console.log(chalk.bold("\n  Tree preview (dry-run)\n"));
	console.log(`  Target: ${chalk.cyan(envelope.target.metadata.shortId)}  ${chalk.white(envelope.target.label)}`);
	console.log("  Would:  create a non-destructive session fork");
	if (envelope.plan.branchPointEntryId) {
		console.log(chalk.dim(`  Branch point: ${envelope.plan.branchPointEntryId}`));
	}
	console.log(chalk.dim(`  Command: ${envelope.plan.recommendedCommand}\n`));
}

export function createTreeCommand(): Command {
	return new Command("tree")
		.description("Inspect and preview substrate-agnostic Refarm timelines")
		.addCommand(
			new Command("list")
				.description("List timeline nodes")
				.option("--scope <scope>", "Timeline scope", SESSION_SCOPE)
				.option("--json", "Print machine-readable JSON")
				.action(async (opts: { scope?: string; json?: boolean }) => {
					await listTree(opts);
				}),
		)
		.addCommand(
			new Command("show")
				.description("Show a timeline node by ID prefix")
				.argument("<id>", "Timeline node ID or unique prefix")
				.option("--json", "Print machine-readable JSON")
				.action(async (prefix: string, opts: { json?: boolean }) => {
					await showTree(prefix, opts);
				}),
		)
		.addCommand(
			new Command("preview")
				.description("Preview the safe fork plan for a timeline node")
				.argument("<id>", "Timeline node ID or unique prefix")
				.option("--json", "Print machine-readable JSON")
				.action(async (prefix: string, opts: { json?: boolean }) => {
					await previewTree(prefix, opts);
				}),
		)
		.action(async () => {
			await listTree({ scope: SESSION_SCOPE });
		});
}

export const treeCommand = createTreeCommand();
