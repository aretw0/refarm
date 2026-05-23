import chalk from "chalk";
import { formatExecutionPlanReadinessLine } from "./execution-plan.js";
import { formatSessionId } from "./session-ids.js";
import {
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";
import { reportSidecarError } from "./sidecar-error.js";
import { sidecarUrl } from "./sidecar-url.js";
import {
	buildSessionForkPreviewEnvelope,
	buildSessionSwitchEnvelope,
	buildSessionSwitchPreviewEnvelope,
	buildSessionTimelineListEnvelope,
	buildSessionTimelineShowEnvelope,
	outputTreeJson,
	REFARM_TREE_SESSION_SCOPE,
	type RefarmSessionTimelineNode,
} from "./tree-model.js";

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

function createSessionTimelineNode(
	session: SessionNode,
): RefarmSessionTimelineNode {
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

async function fetchSessions(limit?: number): Promise<SessionNode[]> {
	const suffix = typeof limit === "number" ? `?limit=${limit}` : "";
	const response = await fetch(sidecarUrl(`/sessions${suffix}`));
	if (!response.ok) {
		throw new Error(`sidecar HTTP ${response.status}`);
	}
	const body = (await response.json()) as { sessions?: SessionNode[] };
	return body.sessions ?? [];
}

async function fetchSessionHistory(prefix: string): Promise<SessionHistory | null> {
	const response = await fetch(
		sidecarUrl(`/sessions/${encodeURIComponent(prefix)}/history`),
	);
	const body = (await response.json()) as SessionHistory & {
		error?: string;
		matches?: string[];
	};
	if (response.status === 404) {
		console.error(chalk.red(`✗  No timeline node matching "${prefix}"`));
		process.exitCode = 1;
		return null;
	}
	if (response.status === 409) {
		console.error(
			chalk.red(`✗  Ambiguous timeline node "${prefix}" — ${body.error}`),
		);
		for (const match of body.matches ?? [])
			console.error(chalk.dim(`   ${match}`));
		process.exitCode = 1;
		return null;
	}
	if (!response.ok) {
		console.error(chalk.red(`✗  ${body.error ?? `HTTP ${response.status}`}`));
		process.exitCode = 1;
		return null;
	}
	return body;
}

export async function getSessionTimelineNodes(
	limit?: number,
): Promise<RefarmSessionTimelineNode[]> {
	const sessions = await fetchSessions(limit);
	const nodes = [...sessions]
		.sort((a, b) => (b.created_at_ns ?? 0) - (a.created_at_ns ?? 0))
		.map(createSessionTimelineNode);
	return typeof limit === "number" ? nodes.slice(0, limit) : nodes;
}

export async function listSessionTree(opts: {
	json?: boolean;
	limit?: number;
}): Promise<void> {
	let sessions: SessionNode[];
	try {
		sessions = await fetchSessions(opts.limit);
	} catch (err) {
		reportSidecarError(err);
		return;
	}

	const nodes = [...sessions]
		.sort((a, b) => (b.created_at_ns ?? 0) - (a.created_at_ns ?? 0))
		.map(createSessionTimelineNode);
	const visibleNodes =
		typeof opts.limit === "number" ? nodes.slice(0, opts.limit) : nodes;

	if (opts.json) {
		outputTreeJson(buildSessionTimelineListEnvelope(visibleNodes));
		return;
	}

	if (visibleNodes.length === 0) {
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
	for (const node of visibleNodes) {
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
			"\n  refarm tree show <id-prefix>              inspect a node" +
				"\n  refarm tree preview <id-prefix>           preview a safe fork plan" +
				"\n  refarm tree preview <id-prefix> --switch  preview active-session switch" +
				"\n  refarm tree switch <id-prefix>            switch active session\n",
		),
	);
}

export async function showSessionTree(
	prefix: string,
	opts: { json?: boolean },
): Promise<void> {
	let history: SessionHistory | null;
	try {
		history = await fetchSessionHistory(prefix);
	} catch (err) {
		reportSidecarError(err);
		return;
	}
	if (!history) return;
	const node = createSessionTimelineNode(history.session);

	if (opts.json) {
		outputTreeJson(
			buildSessionTimelineShowEnvelope({
				node,
				entries: history.entries,
				total: history.total,
			}),
		);
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

export async function previewSessionTree(
	prefix: string,
	opts: { json?: boolean; at?: string; name?: string },
): Promise<void> {
	let history: SessionHistory | null;
	try {
		history = await fetchSessionHistory(prefix);
	} catch (err) {
		reportSidecarError(err);
		return;
	}
	if (!history) return;
	const branchPointEntryId = opts.at ?? history.session.leaf_entry_id ?? null;
	if (opts.at && !history.entries.some((entry) => entry.id === opts.at)) {
		console.error(
			chalk.red(
				`✗  No entry "${opts.at}" in session ${formatSessionId(history.session["@id"])}.`,
			),
		);
		process.exit(1);
	}
	const envelope = buildSessionForkPreviewEnvelope({
		node: createSessionTimelineNode(history.session),
		branchPointEntryId,
		name: opts.name,
	});

	if (opts.json) {
		outputTreeJson(envelope);
		return;
	}

	console.log(chalk.bold("\n  Tree preview (dry-run)\n"));
	console.log(
		`  Target: ${chalk.cyan(envelope.target.metadata.shortId)}  ${chalk.white(envelope.target.label)}`,
	);
	console.log("  Would:  create a non-destructive session fork");
	const substrate = envelope.plan.substrate;
	if (substrate.kind === "session-fork" && substrate.branchPointEntryId) {
		console.log(chalk.dim(`  Branch point: ${substrate.branchPointEntryId}`));
	}
	const readiness = formatExecutionPlanReadinessLine(envelope.plan);
	console.log(
		readiness.status === "blocked"
			? chalk.yellow(`  ${readiness.label}`)
			: chalk.dim(`  ${readiness.label}`),
	);
	console.log(chalk.dim(`  Command: ${envelope.plan.recommendedCommand}\n`));
}

export async function switchSessionTree(
	prefix: string,
	opts: { json?: boolean },
): Promise<void> {
	let history: SessionHistory | null;
	try {
		history = await fetchSessionHistory(prefix);
	} catch (err) {
		reportSidecarError(err);
		return;
	}
	if (!history) return;
	const node = createSessionTimelineNode(history.session);
	const currentSessionIdBefore = readActiveSessionId();
	if (currentSessionIdBefore === node.nodeId) {
		console.error(
			chalk.red(`✗  Session "${node.metadata.shortId}" is already active.`),
		);
		process.exit(1);
	}
	let currentSessionIdAfter: string;
	try {
		currentSessionIdAfter = writeActiveSessionIdAndVerify(
			node.nodeId,
			currentSessionIdBefore,
		).currentSessionIdAfter;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(chalk.red(`✗  ${message}`));
		process.exit(1);
	}
	const envelope = buildSessionSwitchEnvelope({
		node,
		currentSessionIdBefore,
		currentSessionIdAfter,
	});

	if (opts.json) {
		outputTreeJson(envelope);
		return;
	}

	console.log(
		chalk.green(
			`✓  Switched active session to ${chalk.cyan.bold(node.metadata.shortId)}.`,
		),
	);
}

export async function previewSessionSwitchTree(
	prefix: string,
	opts: { json?: boolean },
): Promise<void> {
	let history: SessionHistory | null;
	try {
		history = await fetchSessionHistory(prefix);
	} catch (err) {
		reportSidecarError(err);
		return;
	}
	if (!history) return;
	const envelope = buildSessionSwitchPreviewEnvelope({
		node: createSessionTimelineNode(history.session),
		activeSessionIdBefore: readActiveSessionId(),
	});

	if (opts.json) {
		outputTreeJson(envelope);
		return;
	}

	const substrate = envelope.plan.substrate;
	if (substrate.kind !== "session-switch") {
		throw new Error("Unexpected session switch preview plan shape.");
	}
	console.log(chalk.bold("\n  Tree switch preview (dry-run)\n"));
	console.log(
		`  Target: ${chalk.cyan(envelope.target.metadata.shortId)}  ${chalk.white(envelope.target.label)}`,
	);
	console.log("  Would:  switch active session pointer");
	if (substrate.activeSessionIdBefore) {
		console.log(
			chalk.dim(
				`  Current: ${formatSessionId(substrate.activeSessionIdBefore)}`,
			),
		);
	}
	const readiness = formatExecutionPlanReadinessLine(envelope.plan);
	console.log(
		readiness.status === "blocked"
			? chalk.yellow(`  ${readiness.label}`)
			: chalk.dim(`  ${readiness.label}`),
	);
	console.log(chalk.dim(`  Command: ${envelope.plan.recommendedCommand}\n`));
}
