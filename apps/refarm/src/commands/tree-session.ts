import chalk from "chalk";
import {
	outputTreeJson,
	REFARM_TREE_SCHEMA_VERSION,
	REFARM_TREE_SESSION_SCOPE,
	type RefarmTimelineNode,
	type RefarmTimelinePreviewEnvelope,
} from "./tree-model.js";

const SIDECAR_URL = "http://127.0.0.1:42001";

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
		timelineId: REFARM_TREE_SESSION_SCOPE,
		nodeId: session["@id"],
		parentNodeId: session.parent_session_id ?? undefined,
		branchId: session["@id"],
		kind: REFARM_TREE_SESSION_SCOPE,
		label: session.name ?? "unnamed",
		timestamp: nsToIso(session.created_at_ns),
		metadata: {
			shortId: formatSessionId(session["@id"]),
			leafEntryId: session.leaf_entry_id ?? null,
			hasHistory: Boolean(session.leaf_entry_id),
		},
	};
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
		for (const match of body.matches ?? [])
			console.error(chalk.dim(`   ${match}`));
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

export async function listSessionTree(opts: { json?: boolean }): Promise<void> {
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
		outputTreeJson({
			command: "tree",
			scope: REFARM_TREE_SESSION_SCOPE,
			nodes,
		});
		return;
	}

	if (nodes.length === 0) {
		console.log(
			chalk.dim(
				"No session timeline nodes yet. Start one with: refarm ask <query>",
			),
		);
		return;
	}

	console.log(
		chalk.bold(`\n  Tree timeline  (${REFARM_TREE_SESSION_SCOPE} scope)\n`),
	);
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

export async function showSessionTree(
	prefix: string,
	opts: { json?: boolean },
): Promise<void> {
	let history: SessionHistory;
	try {
		history = await fetchSessionHistory(prefix);
	} catch (err) {
		exitForSidecarError(err);
	}
	const node = createSessionTimelineNode(history.session);

	if (opts.json) {
		outputTreeJson({
			command: "tree",
			scope: REFARM_TREE_SESSION_SCOPE,
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
		chalk.dim(
			`  kind=${node.kind} timeline=${node.timelineId} total=${history.total}`,
		),
	);
	if (node.parentNodeId)
		console.log(chalk.dim(`  parent=${node.parentNodeId}`));
	if (node.metadata.leafEntryId) {
		console.log(chalk.dim(`  leaf=${node.metadata.leafEntryId}`));
	}
	console.log();
}

function createSessionPreviewEnvelope(
	node: RefarmTimelineNode,
	branchPointEntryId: string | null,
	name: string | undefined,
): RefarmTimelinePreviewEnvelope {
	const atArg = branchPointEntryId ? ` --at ${branchPointEntryId}` : "";
	const branchName = name ?? "<branch-name>";
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_SESSION_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan: {
			kind: "session-fork",
			destructive: false,
			branchPointEntryId,
			recommendedCommand: `refarm sessions fork ${node.metadata.shortId}${atArg} --name ${branchName}`,
		},
	};
}

export async function previewSessionTree(
	prefix: string,
	opts: { json?: boolean; at?: string; name?: string },
): Promise<void> {
	let history: SessionHistory;
	try {
		history = await fetchSessionHistory(prefix);
	} catch (err) {
		exitForSidecarError(err);
	}
	const branchPointEntryId = opts.at ?? history.session.leaf_entry_id ?? null;
	if (opts.at && !history.entries.some((entry) => entry.id === opts.at)) {
		console.error(
			chalk.red(
				`✗  No entry "${opts.at}" in session ${formatSessionId(history.session["@id"])}.`,
			),
		);
		process.exit(1);
	}
	const envelope = createSessionPreviewEnvelope(
		createSessionTimelineNode(history.session),
		branchPointEntryId,
		opts.name,
	);

	if (opts.json) {
		outputTreeJson(envelope);
		return;
	}

	console.log(chalk.bold("\n  Tree preview (dry-run)\n"));
	console.log(
		`  Target: ${chalk.cyan(envelope.target.metadata.shortId)}  ${chalk.white(envelope.target.label)}`,
	);
	console.log("  Would:  create a non-destructive session fork");
	if (
		envelope.plan.kind === "session-fork" &&
		envelope.plan.branchPointEntryId
	) {
		console.log(
			chalk.dim(`  Branch point: ${envelope.plan.branchPointEntryId}`),
		);
	}
	console.log(chalk.dim(`  Command: ${envelope.plan.recommendedCommand}\n`));
}
