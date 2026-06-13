export const ARTIFACT_CAPABILITY = "artifact:v1" as const;
export const TASK_ARTIFACT_MANIFEST_SCHEMA = "refarm.task-artifacts.v1" as const;

export type ArtifactStatus = "draft" | "ready" | "active" | "archived";

export const ARTIFACT_TERMINAL_STATES: ReadonlySet<ArtifactStatus> = new Set([
	"archived",
]);

const VALID_TRANSITIONS = new Map<ArtifactStatus, ReadonlySet<ArtifactStatus>>([
	["draft",    new Set(["ready", "archived"])],
	["ready",    new Set(["draft", "active", "archived"])],
	["active",   new Set(["ready", "archived"])],
	["archived", new Set()],
]);

export function canTransition(from: ArtifactStatus, to: ArtifactStatus): boolean {
	return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}

export const TASK_ARTIFACT_ROLES = [
	"dataset",
	"report",
	"audit-trail",
	"receipt",
	"log",
	"manifest",
	"other",
] as const;

export const ARTIFACT_REVIEW_STATES = [
	"unreviewed",
	"accepted",
	"rejected",
	"superseded",
] as const;

const ROLE_SET = new Set<string>(TASK_ARTIFACT_ROLES);
const REVIEW_STATE_SET = new Set<string>(ARTIFACT_REVIEW_STATES);

export interface ManagedArtifact {
	id: string;
	status: ArtifactStatus;
	tags?: string[];
	/** Adapter decides whether to increment on each update. */
	revision?: number;
	createdAt: string;  // ISO 8601
	updatedAt: string;  // ISO 8601
	archivedAt?: string; // ISO 8601, set when transitioning to archived
}

export type ArtifactReviewState =
	(typeof ARTIFACT_REVIEW_STATES)[number];

export interface ArtifactHash {
	algorithm: "sha256";
	value: string;
}

export interface ArtifactProcessReference {
	/** Executable name or absolute executable path. */
	command: string;
	/** Already-tokenized arguments. Consumers must not shell-split this field. */
	args: readonly string[];
	/** Shell-ready display string for operators and legacy handoffs. */
	display: string;
	/** Optional working directory used by the producer. */
	cwd?: string;
	/** Optional package manager label when the command came from a workspace runner. */
	packageManager?: string | null;
}

export interface ArtifactProvenance {
	/** Stable task, effort, job, notebook, or pipeline run identifier. */
	runId: string;
	/** Human or machine actor that produced the artifact. */
	producer: string;
	/** Shell-ready display command, process display, or logical operation name. */
	command?: string;
	/** Structured process reference when the producer executed a tokenized process. */
	process?: ArtifactProcessReference;
	/** Source repository, vault, dataset, or other origin label. */
	source?: string;
	/** Dataset/model/template version known to the producer, when applicable. */
	sourceVersion?: string;
	/** ISO 8601 timestamp for the production event. */
	producedAt: string;
	/** Hashes of input snapshots, prompts, manifests, or source files. */
	inputHashes?: readonly ArtifactHash[];
}

export interface TaskArtifactReference {
	id: string;
	/** Relative path, absolute local path, URL, or URI understood by the consumer. */
	uri: string;
	mediaType: string;
	role: (typeof TASK_ARTIFACT_ROLES)[number];
	hash?: ArtifactHash;
	reviewState?: ArtifactReviewState;
	provenance: ArtifactProvenance;
	labels?: readonly string[];
}

export interface TaskArtifactManifest {
	schema: typeof TASK_ARTIFACT_MANIFEST_SCHEMA;
	taskId?: string;
	effortId?: string;
	createdAt: string;
	artifacts: readonly TaskArtifactReference[];
}

export interface TaskArtifactSelection {
	ids?: readonly string[];
	roles?: readonly TaskArtifactReference["role"][];
	reviewStates?: readonly ArtifactReviewState[];
	mediaTypes?: readonly string[];
	labels?: readonly string[];
	source?: string;
	producer?: string;
}

export interface ArtifactManifestValidationIssue {
	path: string;
	message: string;
}

export interface ArtifactManifestValidationResult {
	ok: boolean;
	issues: readonly ArtifactManifestValidationIssue[];
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
	issues: ArtifactManifestValidationIssue[],
): void {
	if (!isNonEmptyString(value)) {
		issues.push({ path, message: "Expected a non-empty string." });
	}
}

function validateHash(
	value: unknown,
	path: string,
	issues: ArtifactManifestValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected an artifact hash object." });
		return;
	}
	if (value.algorithm !== "sha256") {
		issues.push({ path: `${path}.algorithm`, message: "Expected sha256." });
	}
	if (!isNonEmptyString(value.value) || !/^[a-f0-9]{64}$/.test(value.value)) {
		issues.push({ path: `${path}.value`, message: "Expected a 64-char lowercase hex digest." });
	}
}

function validateStringArray(
	value: unknown,
	path: string,
	issues: ArtifactManifestValidationIssue[],
): void {
	if (!Array.isArray(value)) {
		issues.push({ path, message: "Expected an array." });
		return;
	}
	value.forEach((item, index) =>
		requireString(item, `${path}.${index}`, issues),
	);
}

function validateProcessReference(
	value: unknown,
	path: string,
	issues: ArtifactManifestValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected a process reference object." });
		return;
	}
	requireString(value.command, `${path}.command`, issues);
	validateStringArray(value.args, `${path}.args`, issues);
	requireString(value.display, `${path}.display`, issues);
	if (value.cwd !== undefined) {
		requireString(value.cwd, `${path}.cwd`, issues);
	}
	if (
		value.packageManager !== undefined &&
		value.packageManager !== null &&
		!isNonEmptyString(value.packageManager)
	) {
		issues.push({
			path: `${path}.packageManager`,
			message: "Expected a non-empty string or null.",
		});
	}
}

function validateProvenance(
	value: unknown,
	path: string,
	issues: ArtifactManifestValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected an artifact provenance object." });
		return;
	}
	requireString(value.runId, `${path}.runId`, issues);
	requireString(value.producer, `${path}.producer`, issues);
	requireString(value.producedAt, `${path}.producedAt`, issues);
	if (value.process !== undefined) {
		validateProcessReference(value.process, `${path}.process`, issues);
	}
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
	issues: ArtifactManifestValidationIssue[],
): void {
	if (!isRecord(value)) {
		issues.push({ path, message: "Expected an artifact reference object." });
		return;
	}
	requireString(value.id, `${path}.id`, issues);
	requireString(value.uri, `${path}.uri`, issues);
	requireString(value.mediaType, `${path}.mediaType`, issues);
	if (!isNonEmptyString(value.role) || !ROLE_SET.has(value.role)) {
		issues.push({ path: `${path}.role`, message: "Expected a supported artifact role." });
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

export function validateTaskArtifactManifest(
	value: unknown,
): ArtifactManifestValidationResult {
	const issues: ArtifactManifestValidationIssue[] = [];
	if (!isRecord(value)) {
		return {
			ok: false,
			issues: [{ path: "$", message: "Expected a task artifact manifest object." }],
		};
	}
	if (value.schema !== TASK_ARTIFACT_MANIFEST_SCHEMA) {
		issues.push({
			path: "$.schema",
			message: `Expected ${TASK_ARTIFACT_MANIFEST_SCHEMA}.`,
		});
	}
	requireString(value.createdAt, "$.createdAt", issues);
	if (!Array.isArray(value.artifacts)) {
		issues.push({ path: "$.artifacts", message: "Expected an array." });
	} else {
		const ids = new Set<string>();
		value.artifacts.forEach((artifact, index) => {
			validateReference(artifact, `$.artifacts.${index}`, issues);
			if (!isRecord(artifact) || !isNonEmptyString(artifact.id)) return;
			if (ids.has(artifact.id)) {
				issues.push({
					path: `$.artifacts.${index}.id`,
					message: "Expected a unique artifact id.",
				});
				return;
			}
			ids.add(artifact.id);
		});
	}
	return { ok: issues.length === 0, issues };
}

export function isTaskArtifactManifest(value: unknown): value is TaskArtifactManifest {
	return validateTaskArtifactManifest(value).ok;
}

function matchesOptionalList<T extends string>(
	value: T | undefined,
	allowed: readonly T[] | undefined,
): boolean {
	return allowed === undefined || (value !== undefined && allowed.includes(value));
}

function hasRequiredLabels(
	artifact: TaskArtifactReference,
	labels: readonly string[] | undefined,
): boolean {
	return labels === undefined || labels.every((label) => artifact.labels?.includes(label));
}

export function selectTaskArtifacts(
	manifest: TaskArtifactManifest,
	selection: TaskArtifactSelection = {},
): readonly TaskArtifactReference[] {
	return manifest.artifacts.filter((artifact) =>
		matchesOptionalList(artifact.id, selection.ids) &&
		matchesOptionalList(artifact.role, selection.roles) &&
		matchesOptionalList(artifact.reviewState, selection.reviewStates) &&
		matchesOptionalList(artifact.mediaType, selection.mediaTypes) &&
		hasRequiredLabels(artifact, selection.labels) &&
		(selection.source === undefined || artifact.provenance.source === selection.source) &&
		(selection.producer === undefined || artifact.provenance.producer === selection.producer)
	);
}

export function findTaskArtifactById(
	manifest: TaskArtifactManifest,
	id: string,
): TaskArtifactReference | undefined {
	return selectTaskArtifacts(manifest, { ids: [id] })[0];
}
