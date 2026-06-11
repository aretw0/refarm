export const ARTEFACT_CAPABILITY = "artefact:v1" as const;
export const TASK_ARTEFACT_MANIFEST_SCHEMA = "refarm.task-artefacts.v1" as const;

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

export const TASK_ARTEFACT_ROLES = [
	"dataset",
	"report",
	"audit-trail",
	"receipt",
	"log",
	"manifest",
	"other",
] as const;

export const ARTEFACT_REVIEW_STATES = [
	"unreviewed",
	"accepted",
	"rejected",
	"superseded",
] as const;

const ROLE_SET = new Set<string>(TASK_ARTEFACT_ROLES);
const REVIEW_STATE_SET = new Set<string>(ARTEFACT_REVIEW_STATES);

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
	(typeof ARTEFACT_REVIEW_STATES)[number];

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
	role: (typeof TASK_ARTEFACT_ROLES)[number];
	hash?: ArtefactHash;
	reviewState?: ArtefactReviewState;
	provenance: ArtefactProvenance;
	labels?: readonly string[];
}

export interface TaskArtefactManifest {
	schema: typeof TASK_ARTEFACT_MANIFEST_SCHEMA;
	taskId?: string;
	effortId?: string;
	createdAt: string;
	artefacts: readonly TaskArtefactReference[];
}

export interface ArtefactManifestValidationIssue {
	path: string;
	message: string;
}

export interface ArtefactManifestValidationResult {
	ok: boolean;
	issues: readonly ArtefactManifestValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function requireString(
	value: unknown,
	path: string,
	issues: ArtefactManifestValidationIssue[],
): void {
	if (!isNonEmptyString(value)) {
		issues.push({ path, message: "Expected a non-empty string." });
	}
}

function validateHash(
	value: unknown,
	path: string,
	issues: ArtefactManifestValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected an artefact hash object." });
		return;
	}
	if (value.algorithm !== "sha256") {
		issues.push({ path: `${path}.algorithm`, message: "Expected sha256." });
	}
	if (!isNonEmptyString(value.value) || !/^[a-f0-9]{64}$/.test(value.value)) {
		issues.push({ path: `${path}.value`, message: "Expected a 64-char lowercase hex digest." });
	}
}

function validateProvenance(
	value: unknown,
	path: string,
	issues: ArtefactManifestValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected an artefact provenance object." });
		return;
	}
	requireString(value.runId, `${path}.runId`, issues);
	requireString(value.producer, `${path}.producer`, issues);
	requireString(value.producedAt, `${path}.producedAt`, issues);
	if (value.inputHashes !== undefined) {
		if (!Array.isArray(value.inputHashes)) {
			issues.push({ path: `${path}.inputHashes`, message: "Expected an array." });
		} else {
			value.inputHashes.forEach((hash, index) =>
				validateHash(hash, `${path}.inputHashes.${index}`, issues),
			);
		}
	}
}

function validateReference(
	value: unknown,
	path: string,
	issues: ArtefactManifestValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected an artefact reference object." });
		return;
	}
	requireString(value.id, `${path}.id`, issues);
	requireString(value.uri, `${path}.uri`, issues);
	requireString(value.mediaType, `${path}.mediaType`, issues);
	if (!isNonEmptyString(value.role) || !ROLE_SET.has(value.role)) {
		issues.push({ path: `${path}.role`, message: "Expected a supported artefact role." });
	}
	if (value.hash !== undefined) {
		validateHash(value.hash, `${path}.hash`, issues);
	}
	if (
		value.reviewState !== undefined &&
		(!isNonEmptyString(value.reviewState) || !REVIEW_STATE_SET.has(value.reviewState))
	) {
		issues.push({
			path: `${path}.reviewState`,
			message: "Expected a supported review state.",
		});
	}
	validateProvenance(value.provenance, `${path}.provenance`, issues);
	if (value.labels !== undefined) {
		if (!Array.isArray(value.labels)) {
			issues.push({ path: `${path}.labels`, message: "Expected an array." });
		} else {
			value.labels.forEach((label, index) =>
				requireString(label, `${path}.labels.${index}`, issues),
			);
		}
	}
}

export function validateTaskArtefactManifest(
	value: unknown,
): ArtefactManifestValidationResult {
	const issues: ArtefactManifestValidationIssue[] = [];
	if (!isRecord(value)) {
		return {
			ok: false,
			issues: [{ path: "$", message: "Expected a task artefact manifest object." }],
		};
	}
	if (value.schema !== TASK_ARTEFACT_MANIFEST_SCHEMA) {
		issues.push({
			path: "$.schema",
			message: `Expected ${TASK_ARTEFACT_MANIFEST_SCHEMA}.`,
		});
	}
	requireString(value.createdAt, "$.createdAt", issues);
	if (!Array.isArray(value.artefacts)) {
		issues.push({ path: "$.artefacts", message: "Expected an array." });
	} else {
		value.artefacts.forEach((artefact, index) =>
			validateReference(artefact, `$.artefacts.${index}`, issues),
		);
	}
	return { ok: issues.length === 0, issues };
}

export function isTaskArtefactManifest(value: unknown): value is TaskArtefactManifest {
	return validateTaskArtefactManifest(value).ok;
}
