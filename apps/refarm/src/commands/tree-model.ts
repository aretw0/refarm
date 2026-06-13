import { refarmCommand, refarmProcess } from "./command-handoff.js";
import {
	createExecutionPlanHandoff,
	type ExecutionPlanBase,
	type ExecutionPlanHandoff,
} from "./execution-plan.js";
import { printJson } from "./json-output.js";
import { TREE_GIT_LIST_JSON_COMMAND } from "./tree-handoffs.js";

const SESSION_SCOPE = "session";
const GIT_SCOPE = "git";
const ALL_SCOPE = "all";

export const REFARM_TREE_SCHEMA_VERSION = 1;
export const REFARM_TREE_SESSION_SCOPE = SESSION_SCOPE;
export const REFARM_TREE_GIT_SCOPE = GIT_SCOPE;
export const REFARM_TREE_ALL_SCOPE = ALL_SCOPE;

export type RefarmTimelineScope = typeof SESSION_SCOPE | typeof GIT_SCOPE;
export type RefarmTimelineEnvelopeScope =
	| RefarmTimelineScope
	| typeof ALL_SCOPE;

export interface RefarmTimelineMetadata {
	shortId: string;
}

export interface RefarmSessionTimelineMetadata extends RefarmTimelineMetadata {
	leafEntryId: string | null;
	hasHistory: boolean;
}

export interface RefarmGitTimelineMetadata extends RefarmTimelineMetadata {
	refs: string[];
}

export interface RefarmTimelineNode {
	timelineId: RefarmTimelineScope;
	nodeId: string;
	parentNodeId?: string;
	branchId?: string;
	kind: RefarmTimelineScope;
	label: string;
	timestamp: string;
	metadata: RefarmTimelineMetadata;
}

export interface RefarmSessionTimelineNode extends RefarmTimelineNode {
	timelineId: typeof REFARM_TREE_SESSION_SCOPE;
	kind: typeof REFARM_TREE_SESSION_SCOPE;
	metadata: RefarmSessionTimelineMetadata;
}

export interface RefarmGitTimelineNode extends RefarmTimelineNode {
	timelineId: typeof REFARM_TREE_GIT_SCOPE;
	kind: typeof REFARM_TREE_GIT_SCOPE;
	metadata: RefarmGitTimelineMetadata;
}

export interface RefarmTimelineListEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineEnvelopeScope;
	operation: "list";
	nodes: RefarmTimelineNode[];
	nextAction: null;
	nextActions: [];
	nextCommand: null;
	nextCommands: [];
}

export interface RefarmSessionTimelineListEnvelope
	extends RefarmTimelineListEnvelope {
	scope: typeof REFARM_TREE_SESSION_SCOPE;
	nodes: RefarmSessionTimelineNode[];
}

export interface RefarmGitTimelineListEnvelope
	extends RefarmTimelineListEnvelope {
	scope: typeof REFARM_TREE_GIT_SCOPE;
	nodes: RefarmGitTimelineNode[];
}

export interface RefarmAllTimelineListEnvelope
	extends RefarmTimelineListEnvelope {
	scope: typeof REFARM_TREE_ALL_SCOPE;
	nodes: Array<RefarmSessionTimelineNode | RefarmGitTimelineNode>;
}

export interface RefarmTimelineShowEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "show";
	node: RefarmTimelineNode;
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export interface RefarmGitTimelineShowEnvelope
	extends RefarmTimelineShowEnvelope {
	scope: typeof REFARM_TREE_GIT_SCOPE;
	node: RefarmGitTimelineNode;
}

export interface RefarmSessionTimelineShowEnvelope
	extends RefarmTimelineShowEnvelope {
	scope: typeof REFARM_TREE_SESSION_SCOPE;
	node: RefarmSessionTimelineNode;
	entries: unknown[];
	total: number;
}

export type RefarmSessionTimelineForkPreviewPlan = ExecutionPlanBase<
	"fork",
	{
		activePointerChanged: true;
		branchCreated: true;
	},
	{
		kind: "session-fork";
		branchPointEntryId: string | null;
		branchName: string | null;
		activeSessionWillSwitch: true;
	}
>;

export type RefarmSessionTimelineSwitchPreviewPlan = ExecutionPlanBase<
	"switch",
	{
		activePointerChanged: true;
		branchCreated: false;
	},
	{
		kind: "session-switch";
		activeSessionIdBefore: string | null;
		targetSessionIdAfter: string;
		activeSessionWillSwitch: true;
	}
>;

export type RefarmSessionTimelinePreviewPlan =
	| RefarmSessionTimelineForkPreviewPlan
	| RefarmSessionTimelineSwitchPreviewPlan;

export type RefarmGitTimelineBranchPreviewPlan = ExecutionPlanBase<
	"fork",
	{
		activePointerChanged: false;
		branchCreated: true;
	},
	{
		kind: "git-branch";
		baseCommit: string;
		branchName: string | null;
		worktreeSwitched: false;
	}
>;

export type RefarmGitTimelineSwitchPreviewPlan = ExecutionPlanBase<
	"switch",
	{
		activePointerChanged: true;
		branchCreated: false;
	},
	{
		kind: "git-switch";
		currentRefBefore: string;
		targetRefAfter: string;
		targetCommit: string;
		worktreeClean: boolean;
		worktreeSwitched: true;
	}
>;

export type RefarmGitTimelinePreviewPlan =
	| RefarmGitTimelineBranchPreviewPlan
	| RefarmGitTimelineSwitchPreviewPlan;

export interface RefarmTimelinePreviewEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "preview";
	reason: "dry-run";
	target: RefarmTimelineNode;
	plan: RefarmSessionTimelinePreviewPlan | RefarmGitTimelinePreviewPlan;
	nextAction: ExecutionPlanHandoff["nextAction"];
	nextActions: ExecutionPlanHandoff["nextActions"];
	nextCommand: ExecutionPlanHandoff["nextCommand"];
	nextCommands: ExecutionPlanHandoff["nextCommands"];
	templates: ExecutionPlanHandoff["templates"];
}

export interface RefarmSessionTimelinePreviewEnvelope
	extends RefarmTimelinePreviewEnvelope {
	scope: typeof REFARM_TREE_SESSION_SCOPE;
	target: RefarmSessionTimelineNode;
	plan: RefarmSessionTimelinePreviewPlan;
}

export interface RefarmGitTimelinePreviewEnvelope
	extends RefarmTimelinePreviewEnvelope {
	scope: typeof REFARM_TREE_GIT_SCOPE;
	target: RefarmGitTimelineNode;
	plan: RefarmGitTimelinePreviewPlan;
}

export interface RefarmGitTimelineForkResult {
	kind: "git-branch";
	destructive: false;
	worktreeSwitched: false;
	currentRefBefore: string;
	currentRefAfter: string;
	branchName: string;
	baseCommit: string;
	command: string;
}

export interface RefarmGitTimelineSwitchResult {
	kind: "git-switch";
	destructive: false;
	worktreeSwitched: true;
	currentRefBefore: string;
	currentRefAfter: string;
	branchName: string;
	targetCommit: string;
	command: string;
}

export interface RefarmSessionTimelineSwitchResult {
	kind: "session-switch";
	destructive: false;
	activePointerChanged: true;
	currentSessionIdBefore: string | null;
	currentSessionIdAfter: string;
	targetSessionId: string;
	command: string;
}

export interface RefarmTimelineForkEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "fork";
	reason: "executed";
	target: RefarmTimelineNode;
	result: RefarmGitTimelineForkResult;
	nextAction: string;
	nextActions: string[];
	nextCommand: string;
	nextCommands: string[];
}

export interface RefarmGitTimelineForkEnvelope
	extends RefarmTimelineForkEnvelope {
	scope: typeof REFARM_TREE_GIT_SCOPE;
	target: RefarmGitTimelineNode;
	result: RefarmGitTimelineForkResult;
}

export interface RefarmGitTimelineSwitchEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: typeof REFARM_TREE_GIT_SCOPE;
	operation: "switch";
	reason: "executed";
	target: RefarmGitTimelineNode;
	result: RefarmGitTimelineSwitchResult;
	nextAction: string;
	nextActions: string[];
	nextCommand: string;
	nextCommands: string[];
}

export interface RefarmSessionTimelineSwitchEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: typeof REFARM_TREE_SESSION_SCOPE;
	operation: "switch";
	reason: "executed";
	target: RefarmSessionTimelineNode;
	result: RefarmSessionTimelineSwitchResult;
	nextAction: string;
	nextActions: string[];
	nextCommand: string;
	nextCommands: string[];
}

export type RefarmTreeJsonEnvelope =
	| RefarmSessionTimelineListEnvelope
	| RefarmGitTimelineListEnvelope
	| RefarmAllTimelineListEnvelope
	| RefarmSessionTimelineShowEnvelope
	| RefarmGitTimelineShowEnvelope
	| RefarmSessionTimelinePreviewEnvelope
	| RefarmGitTimelinePreviewEnvelope
	| RefarmGitTimelineForkEnvelope
	| RefarmSessionTimelineSwitchEnvelope
	| RefarmGitTimelineSwitchEnvelope;

export function buildSessionTimelineListEnvelope(
	nodes: RefarmSessionTimelineNode[],
): RefarmSessionTimelineListEnvelope {
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_SESSION_SCOPE,
		operation: "list",
		nodes,
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
	};
}

export function buildGitTimelineListEnvelope(
	nodes: RefarmGitTimelineNode[],
): RefarmGitTimelineListEnvelope {
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "list",
		nodes,
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
	};
}

export function buildAllTimelineListEnvelope(
	nodes: RefarmAllTimelineListEnvelope["nodes"],
): RefarmAllTimelineListEnvelope {
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_ALL_SCOPE,
		operation: "list",
		nodes,
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
	};
}

export function buildSessionTimelineShowEnvelope(
	args: Pick<RefarmSessionTimelineShowEnvelope, "node" | "entries" | "total"> & {
		nextCommand?: string;
	},
): RefarmSessionTimelineShowEnvelope {
	const nextCommands = args.nextCommand ? [args.nextCommand] : [];
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_SESSION_SCOPE,
		operation: "show",
		node: args.node,
		entries: args.entries,
		total: args.total,
		nextAction: args.nextCommand ?? null,
		nextActions: nextCommands,
		nextCommand: args.nextCommand ?? null,
		nextCommands,
	};
}

export function buildGitTimelineShowEnvelope(
	node: RefarmGitTimelineNode,
): RefarmGitTimelineShowEnvelope {
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "show",
		node,
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
	};
}

export function buildSessionForkPreviewEnvelope(args: {
	node: RefarmSessionTimelineNode;
	branchPointEntryId: string | null;
	name?: string;
}): RefarmSessionTimelinePreviewEnvelope {
	const { node, branchPointEntryId, name } = args;
	const branchName = name ?? "<branch-name>";
	const commandArgs = [
		"sessions",
		"fork",
		node.metadata.shortId,
		...(branchPointEntryId ? ["--at", branchPointEntryId] : []),
		"--name",
		branchName,
	];
	const command = refarmCommand(commandArgs);
	const plan: RefarmSessionTimelineForkPreviewPlan = {
		action: "fork",
		destructive: false,
		readyToExecute: Boolean(name),
		...(name
			? {}
			: {
					blockedReason:
						"Provide a branch name with --name before executing session fork.",
				}),
		recommendedCommand: name ? command : null,
		effects: {
			activePointerChanged: true,
			branchCreated: true,
		},
		substrate: {
			kind: "session-fork",
			branchPointEntryId,
			branchName: name ?? null,
			activeSessionWillSwitch: true,
		},
	};
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_SESSION_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan,
		...createExecutionPlanHandoff({
			...plan,
			commandTemplate: command,
			processTemplate: refarmProcess(commandArgs),
		}),
	};
}

export function buildSessionSwitchPreviewEnvelope(args: {
	node: RefarmSessionTimelineNode;
	activeSessionIdBefore: string | null;
}): RefarmSessionTimelinePreviewEnvelope {
	const { node, activeSessionIdBefore } = args;
	const alreadyActive = activeSessionIdBefore === node.nodeId;
	const plan: RefarmSessionTimelineSwitchPreviewPlan = {
		action: "switch",
		destructive: false,
		readyToExecute: !alreadyActive,
		...(alreadyActive
			? {
					blockedReason: `Session "${node.metadata.shortId}" is already active.`,
				}
			: {}),
		recommendedCommand: refarmCommand(["tree", "switch", node.metadata.shortId]),
		effects: {
			activePointerChanged: true,
			branchCreated: false,
		},
		substrate: {
			kind: "session-switch",
			activeSessionIdBefore,
			targetSessionIdAfter: node.nodeId,
			activeSessionWillSwitch: true,
		},
	};
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_SESSION_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan,
		...createExecutionPlanHandoff(plan),
	};
}

export function buildSessionSwitchEnvelope(args: {
	node: RefarmSessionTimelineNode;
	currentSessionIdBefore: string | null;
	currentSessionIdAfter: string;
}): RefarmSessionTimelineSwitchEnvelope {
	const { node, currentSessionIdBefore, currentSessionIdAfter } = args;
	const nextCommand = refarmCommand(["tree", "show", node.metadata.shortId, "--json"]);
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_SESSION_SCOPE,
		operation: "switch",
		reason: "executed",
		target: node,
		nextAction: nextCommand,
		nextActions: [nextCommand],
		nextCommand,
		nextCommands: [
			nextCommand,
			refarmCommand(["tree", "list", "--scope", "session", "--json"]),
		],
		result: {
			kind: "session-switch",
			destructive: false,
			activePointerChanged: true,
			currentSessionIdBefore,
			currentSessionIdAfter,
			targetSessionId: node.nodeId,
			command: refarmCommand(["tree", "switch", node.metadata.shortId]),
		},
	};
}

export function buildGitBranchPreviewEnvelope(args: {
	node: RefarmGitTimelineNode;
	name?: string;
	branchAlreadyExists?: boolean;
}): RefarmGitTimelinePreviewEnvelope {
	const { node, name, branchAlreadyExists } = args;
	const branchName = name ?? "<branch-name>";
	const commandArgs = [
		"tree",
		"fork",
		"--scope",
		"git",
		node.metadata.shortId,
		"--name",
		branchName,
	];
	const command = refarmCommand(commandArgs);
	const readyToExecute = Boolean(name) && branchAlreadyExists === false;
	const blockedReason = !name
		? "Provide a branch name with --name before executing tree fork."
		: branchAlreadyExists
			? `Git branch "${name}" already exists.`
			: undefined;
	const plan: RefarmGitTimelineBranchPreviewPlan = {
		action: "fork",
		destructive: false,
		readyToExecute,
		...(blockedReason ? { blockedReason } : {}),
		recommendedCommand: name ? command : null,
		effects: {
			activePointerChanged: false,
			branchCreated: true,
		},
		substrate: {
			kind: "git-branch",
			baseCommit: node.nodeId,
			branchName: name ?? null,
			worktreeSwitched: false,
		},
	};
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan,
		...createExecutionPlanHandoff({
			...plan,
			commandTemplate: command,
			processTemplate: refarmProcess(commandArgs),
		}),
	};
}

export function buildGitSwitchPreviewEnvelope(args: {
	node: RefarmGitTimelineNode;
	name: string;
	currentRefBefore: string;
	worktreeClean: boolean;
	blockedReason?: string;
}): RefarmGitTimelinePreviewEnvelope {
	const { node, name, currentRefBefore, worktreeClean, blockedReason } = args;
	const plan: RefarmGitTimelineSwitchPreviewPlan = {
		action: "switch",
		destructive: false,
		readyToExecute: !blockedReason && worktreeClean,
		...(blockedReason
			? { blockedReason }
			: worktreeClean
				? {}
				: {
						blockedReason:
							"Git worktree must be clean before tree switch execution.",
					}),
		recommendedCommand: refarmCommand([
			"tree",
			"switch",
			"--scope",
			"git",
			name,
		]),
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
	};
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "preview",
		reason: "dry-run",
		target: node,
		plan,
		...createExecutionPlanHandoff(plan),
	};
}

export function buildGitForkEnvelope(args: {
	node: RefarmGitTimelineNode;
	name: string;
	currentRefBefore: string;
	currentRefAfter: string;
}): RefarmGitTimelineForkEnvelope {
	const { node, name, currentRefBefore, currentRefAfter } = args;
	const previewSwitchCommand = refarmCommand([
		"tree",
		"preview",
		"--scope",
		"git",
		name,
		"--switch",
		"--json",
	]);
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "fork",
		reason: "executed",
		target: node,
		nextAction: previewSwitchCommand,
		nextActions: [previewSwitchCommand],
		nextCommand: previewSwitchCommand,
		nextCommands: [
			previewSwitchCommand,
			refarmCommand(["tree", "show", "--scope", "git", node.metadata.shortId, "--json"]),
			TREE_GIT_LIST_JSON_COMMAND,
		],
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

export function buildGitSwitchEnvelope(args: {
	node: RefarmGitTimelineNode;
	name: string;
	currentRefBefore: string;
	currentRefAfter: string;
}): RefarmGitTimelineSwitchEnvelope {
	const { node, name, currentRefBefore, currentRefAfter } = args;
	const nextCommand = refarmCommand([
		"tree",
		"show",
		"--scope",
		"git",
		name,
		"--json",
	]);
	return {
		schemaVersion: REFARM_TREE_SCHEMA_VERSION,
		command: "tree",
		scope: REFARM_TREE_GIT_SCOPE,
		operation: "switch",
		reason: "executed",
		target: node,
		nextAction: nextCommand,
		nextActions: [nextCommand],
		nextCommand,
		nextCommands: [
			nextCommand,
			TREE_GIT_LIST_JSON_COMMAND,
		],
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

export function outputTreeJson(value: RefarmTreeJsonEnvelope): void {
	printJson(value);
}
