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
