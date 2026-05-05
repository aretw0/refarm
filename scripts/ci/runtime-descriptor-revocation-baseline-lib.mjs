import { collectJsonFilesRecursive } from "./runtime-descriptor-revocation-history-lib.mjs";

function toRunId(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function compareByCreatedAtDesc(left, right) {
	const leftTime = Date.parse(left?.created_at ?? "") || 0;
	const rightTime = Date.parse(right?.created_at ?? "") || 0;
	if (leftTime !== rightTime) return rightTime - leftTime;
	return (toRunId(right?.id) ?? 0) - (toRunId(left?.id) ?? 0);
}

export function selectPreviousSuccessfulRun(runs, options = {}) {
	const workflowName =
		typeof options.workflowName === "string" ? options.workflowName : "";
	const branch = typeof options.branch === "string" ? options.branch : "";
	const excludeRunId = toRunId(options.excludeRunId);

	const candidates = (Array.isArray(runs) ? runs : []).filter((run) => {
		if (!run || typeof run !== "object") return false;
		if (workflowName && run.name !== workflowName) return false;
		if (branch && run.head_branch !== branch) return false;
		if (run.status && run.status !== "completed") return false;
		if (run.conclusion && run.conclusion !== "success") return false;
		const runId = toRunId(run.id);
		if (excludeRunId != null && runId === excludeRunId) return false;
		return true;
	});

	candidates.sort(compareByCreatedAtDesc);
	return candidates[0] ?? null;
}

export function selectArtifactByName(artifacts, artifactName) {
	if (!artifactName || typeof artifactName !== "string") return null;
	const normalized = artifactName.trim();
	if (!normalized) return null;

	const candidates = (Array.isArray(artifacts) ? artifacts : []).filter(
		(artifact) =>
			artifact &&
			typeof artifact === "object" &&
			artifact.name === normalized &&
			artifact.expired !== true,
	);

	candidates.sort(compareByCreatedAtDesc);

	return candidates[0] ?? null;
}

export function findRevocationSummaryPath(files) {
	const candidates = (Array.isArray(files) ? files : [])
		.filter((filePath) => typeof filePath === "string")
		.sort((left, right) => left.localeCompare(right));

	const canonical = candidates.find((filePath) =>
		filePath.endsWith("runtime-descriptor-revocation-report/summary.json"),
	);
	if (canonical) return canonical;

	const fallback = candidates.find((filePath) =>
		filePath.endsWith("summary.json"),
	);
	return fallback ?? null;
}

export async function listFilesRecursive(rootDir) {
	return collectJsonFilesRecursive(rootDir);
}

export function buildHistoryReportsList({
	currentReport,
	baselineReport,
} = {}) {
	const entries = [currentReport, baselineReport]
		.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
		.map((entry) => entry.trim());

	return Array.from(new Set(entries));
}

export function summarizeBaselineResolution({
	repo,
	branch,
	workflowName,
	excludeRunId,
	artifactName,
	baselineRun,
	artifact,
	baselineSummaryPath,
	reason,
}) {
	return {
		generatedAt: new Date().toISOString(),
		repo: repo ?? null,
		branch: branch ?? null,
		workflowName: workflowName ?? null,
		excludeRunId: excludeRunId ?? null,
		artifactName: artifactName ?? null,
		status: baselineSummaryPath ? "resolved" : "missing",
		reason: reason ?? null,
		baselineRun: baselineRun
			? {
					id: baselineRun.id ?? null,
					name: baselineRun.name ?? null,
					headBranch: baselineRun.head_branch ?? null,
					headSha: baselineRun.head_sha ?? null,
					createdAt: baselineRun.created_at ?? null,
					updatedAt: baselineRun.updated_at ?? null,
				}
			: null,
		artifact: artifact
			? {
					id: artifact.id ?? null,
					name: artifact.name ?? null,
					sizeInBytes: artifact.size_in_bytes ?? null,
					expired: Boolean(artifact.expired),
					createdAt: artifact.created_at ?? null,
					updatedAt: artifact.updated_at ?? null,
				}
			: null,
		baselineSummaryPath: baselineSummaryPath ?? null,
	};
}
