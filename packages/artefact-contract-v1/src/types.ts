export const ARTEFACT_CAPABILITY = "artefact:v1" as const;

export type ArtefactStatus = "draft" | "ready" | "active" | "archived";

export const ARTEFACT_TERMINAL_STATES: ReadonlySet<ArtefactStatus> = new Set([
	"archived",
]);

const VALID_TRANSITIONS = new Map<ArtefactStatus, ReadonlySet<ArtefactStatus>>([
	["draft",    new Set(["ready", "archived"])],
	["ready",    new Set(["draft", "active", "archived"])],
	["active",   new Set(["ready", "archived"])],
	["archived", new Set()],
]);

export function canTransition(from: ArtefactStatus, to: ArtefactStatus): boolean {
	return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}

export interface ManagedArtefact {
	id: string;
	status: ArtefactStatus;
	tags?: string[];
	/** Adapter decides whether to increment on each update. */
	revision?: number;
	createdAt: string;  // ISO 8601
	updatedAt: string;  // ISO 8601
	archivedAt?: string; // ISO 8601, set when transitioning to archived
}

export type ArtefactReviewState =
	| "unreviewed"
	| "accepted"
	| "rejected"
	| "superseded";

export interface ArtefactHash {
	algorithm: "sha256";
	value: string;
}

export interface ArtefactProvenance {
	/** Stable task, effort, job, notebook, or pipeline run identifier. */
	runId: string;
	/** Human or machine actor that produced the artefact. */
	producer: string;
	/** Shell-ready display command, process display, or logical operation name. */
	command?: string;
	/** Source repository, vault, dataset, or other origin label. */
	source?: string;
	/** Dataset/model/template version known to the producer, when applicable. */
	sourceVersion?: string;
	/** ISO 8601 timestamp for the production event. */
	producedAt: string;
	/** Hashes of input snapshots, prompts, manifests, or source files. */
	inputHashes?: readonly ArtefactHash[];
}

export interface TaskArtefactReference {
	id: string;
	/** Relative path, absolute local path, URL, or URI understood by the consumer. */
	uri: string;
	mediaType: string;
	role:
		| "dataset"
		| "report"
		| "audit-trail"
		| "receipt"
		| "log"
		| "manifest"
		| "other";
	hash?: ArtefactHash;
	reviewState?: ArtefactReviewState;
	provenance: ArtefactProvenance;
	labels?: readonly string[];
}

export interface TaskArtefactManifest {
	schema: "refarm.task-artefacts.v1";
	taskId?: string;
	effortId?: string;
	createdAt: string;
	artefacts: readonly TaskArtefactReference[];
}
