const SESSION_SCOPE = "session";
const GIT_SCOPE = "git";

export const REFARM_TREE_SCHEMA_VERSION = 1;
export const REFARM_TREE_SESSION_SCOPE = SESSION_SCOPE;
export const REFARM_TREE_GIT_SCOPE = GIT_SCOPE;

export type RefarmTimelineScope = typeof SESSION_SCOPE | typeof GIT_SCOPE;

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
	scope: RefarmTimelineScope;
	operation: "list";
	nodes: RefarmTimelineNode[];
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

export interface RefarmTimelineShowEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "show";
	node: RefarmTimelineNode;
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

export interface RefarmSessionTimelinePreviewPlan {
	kind: "session-fork";
	destructive: false;
	branchPointEntryId: string | null;
	recommendedCommand: string;
}

export interface RefarmGitTimelinePreviewPlan {
	kind: "git-branch";
	destructive: false;
	worktreeSwitched: false;
	baseCommit: string;
	recommendedCommand: string;
}

export interface RefarmTimelinePreviewEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "preview";
	reason: "dry-run";
	target: RefarmTimelineNode;
	plan: RefarmSessionTimelinePreviewPlan | RefarmGitTimelinePreviewPlan;
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

export interface RefarmTimelineForkEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "fork";
	reason: "executed";
	target: RefarmTimelineNode;
	result: RefarmGitTimelineForkResult;
}

export interface RefarmGitTimelineForkEnvelope
	extends RefarmTimelineForkEnvelope {
	scope: typeof REFARM_TREE_GIT_SCOPE;
	target: RefarmGitTimelineNode;
	result: RefarmGitTimelineForkResult;
}

export type RefarmTreeJsonEnvelope =
	| RefarmSessionTimelineListEnvelope
	| RefarmGitTimelineListEnvelope
	| RefarmSessionTimelineShowEnvelope
	| RefarmGitTimelineShowEnvelope
	| RefarmSessionTimelinePreviewEnvelope
	| RefarmGitTimelinePreviewEnvelope
	| RefarmGitTimelineForkEnvelope;

export function outputTreeJson(value: RefarmTreeJsonEnvelope): void {
	console.log(JSON.stringify(value, null, 2));
}
