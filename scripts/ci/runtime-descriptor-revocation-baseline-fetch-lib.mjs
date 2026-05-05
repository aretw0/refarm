import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	buildHistoryReportsList,
	findRevocationSummaryPath,
	listFilesRecursive,
	selectArtifactByName,
	selectPreviousSuccessfulRun,
	summarizeBaselineResolution,
} from "./runtime-descriptor-revocation-baseline-lib.mjs";

const execFileAsync = promisify(execFile);

function resolveCliString(value, fallback = "") {
	if (typeof value === "string" && value.trim().length > 0) {
		return value.trim();
	}
	return fallback;
}

function createGitHubApiClient({ token, apiBase, fetchImpl = fetch }) {
	const normalizedApiBase = resolveCliString(apiBase).replace(/\/$/, "");

	async function request(url) {
		const response = await fetchImpl(url, {
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"X-GitHub-Api-Version": "2022-11-28",
			},
			redirect: "follow",
		});
		if (!response.ok) {
			throw new Error(
				`GitHub API request failed (${response.status}) for ${url}`,
			);
		}
		return response;
	}

	return {
		async listWorkflowRuns({ repo, branch, perPage = 25 }) {
			const url = `${normalizedApiBase}/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&status=success&per_page=${perPage}`;
			const response = await request(url);
			return response.json();
		},
		async listRunArtifacts({ repo, runId }) {
			const url = `${normalizedApiBase}/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`;
			const response = await request(url);
			return response.json();
		},
		async downloadArtifactZip({ archiveUrl, destinationZip }) {
			const response = await request(archiveUrl);
			const bytes = Buffer.from(await response.arrayBuffer());
			await writeFile(destinationZip, bytes);
		},
	};
}

async function ensureExistingFile(filePath) {
	if (typeof filePath !== "string" || filePath.length === 0) return false;
	const info = await stat(filePath).catch(() => null);
	return Boolean(info?.isFile());
}

async function extractZip(zipPath, destinationDir) {
	await mkdir(destinationDir, { recursive: true });
	await execFileAsync("unzip", ["-oq", zipPath, "-d", destinationDir]);
}

async function resolvePreviousRevocationBaseline({
	repo,
	branch,
	workflowName,
	excludeRunId,
	artifactName,
	maxRuns,
	outputSummaryPath,
	tempRoot,
	apiClient,
}) {
	const runsPayload = await apiClient.listWorkflowRuns({
		repo,
		branch,
		perPage: maxRuns,
	});
	const baselineRun = selectPreviousSuccessfulRun(runsPayload.workflow_runs, {
		workflowName,
		branch,
		excludeRunId,
	});
	if (!baselineRun) {
		return {
			baselineRun: null,
			artifact: null,
			baselineSummaryPath: null,
			reason: "no previous successful workflow run found",
		};
	}

	const artifactsPayload = await apiClient.listRunArtifacts({
		repo,
		runId: baselineRun.id,
	});
	const artifact = selectArtifactByName(
		artifactsPayload.artifacts,
		artifactName,
	);
	if (!artifact) {
		return {
			baselineRun,
			artifact: null,
			baselineSummaryPath: null,
			reason: `artifact '${artifactName}' not found in run ${baselineRun.id}`,
		};
	}

	const baseTempDir = tempRoot || os.tmpdir();
	const tempDir = path.join(
		baseTempDir,
		`runtime-descriptor-revocation-baseline-${randomUUID()}`,
	);
	const zipPath = path.join(tempDir, "artifact.zip");
	const extractDir = path.join(tempDir, "extracted");
	await mkdir(tempDir, { recursive: true });

	await apiClient.downloadArtifactZip({
		archiveUrl: artifact.archive_download_url,
		destinationZip: zipPath,
	});
	await extractZip(zipPath, extractDir);

	const extractedFiles = await listFilesRecursive(extractDir);
	const resolvedSummary = findRevocationSummaryPath(extractedFiles);
	if (!resolvedSummary) {
		return {
			baselineRun,
			artifact,
			baselineSummaryPath: null,
			reason: `summary.json not found in artifact '${artifactName}' from run ${baselineRun.id}`,
		};
	}

	await copyFile(resolvedSummary, outputSummaryPath);
	return {
		baselineRun,
		artifact,
		baselineSummaryPath: outputSummaryPath,
		reason: null,
	};
}

function resolveBaselineCliConfig({ args, root, env }) {
	const repo = resolveCliString(args.repo, env.GITHUB_REPOSITORY || "");
	const branch = resolveCliString(args.branch, env.GITHUB_REF_NAME || "");
	const workflowName = resolveCliString(
		args["workflow-name"],
		env.GITHUB_WORKFLOW || "Test & Quality",
	);
	const excludeRunId = resolveCliString(
		args["exclude-run-id"],
		env.GITHUB_RUN_ID || "",
	);
	const artifactName = resolveCliString(
		args["artifact-name"],
		"runtime-descriptor-revocation-report",
	);
	const token = resolveCliString(args.token, env.GITHUB_TOKEN || "");
	const apiBase = resolveCliString(
		args["api-base"],
		env.GITHUB_API_URL || "https://api.github.com",
	).replace(/\/$/, "");
	const parsedMaxRuns = Number.parseInt(
		resolveCliString(args["max-runs"], "25"),
		10,
	);

	const outDir = path.resolve(
		root,
		args["out-dir"] || ".artifacts/runtime-descriptor-revocation-baseline",
	);
	const outputJson = path.resolve(
		outDir,
		args["output-json"] || "baseline.json",
	);
	const outputSummary = path.resolve(
		outDir,
		args["output-summary"] || "previous-summary.json",
	);
	const reportsFile = args["reports-file"]
		? path.resolve(root, args["reports-file"])
		: null;
	const currentReport = args["current-report"]
		? path.resolve(root, args["current-report"])
		: null;

	return {
		repo,
		branch,
		workflowName,
		excludeRunId,
		artifactName,
		token,
		apiBase,
		maxRuns:
			Number.isFinite(parsedMaxRuns) && parsedMaxRuns > 0 ? parsedMaxRuns : 25,
		required: args.required === true || args.required === "true",
		outDir,
		outputJson,
		outputSummary,
		reportsFile,
		currentReport,
	};
}

export async function runRevocationBaselineResolution({
	args,
	root,
	env = process.env,
}) {
	const config = resolveBaselineCliConfig({ args, root, env });
	await mkdir(config.outDir, { recursive: true });
	if (config.reportsFile) {
		await mkdir(path.dirname(config.reportsFile), { recursive: true });
	}

	let baselineRun = null;
	let artifact = null;
	let baselineSummaryPath = null;
	let reason = null;

	if (!config.repo || !config.branch || !config.token) {
		reason = "missing repo/branch/token context; baseline lookup skipped";
	} else {
		const apiClient = createGitHubApiClient({
			token: config.token,
			apiBase: config.apiBase,
		});
		const result = await resolvePreviousRevocationBaseline({
			repo: config.repo,
			branch: config.branch,
			workflowName: config.workflowName,
			excludeRunId: config.excludeRunId,
			artifactName: config.artifactName,
			maxRuns: config.maxRuns,
			outputSummaryPath: config.outputSummary,
			apiClient,
		});
		baselineRun = result.baselineRun;
		artifact = result.artifact;
		baselineSummaryPath = result.baselineSummaryPath;
		reason = result.reason;
	}

	const metadata = summarizeBaselineResolution({
		repo: config.repo,
		branch: config.branch,
		workflowName: config.workflowName,
		excludeRunId: config.excludeRunId,
		artifactName: config.artifactName,
		baselineRun,
		artifact,
		baselineSummaryPath,
		reason,
	});

	await writeFile(
		config.outputJson,
		`${JSON.stringify(metadata, null, 2)}\n`,
		"utf8",
	);

	const reportEntries = buildHistoryReportsList({
		currentReport: (await ensureExistingFile(config.currentReport))
			? config.currentReport
			: null,
		baselineReport: baselineSummaryPath,
	});

	if (config.reportsFile) {
		await writeFile(
			config.reportsFile,
			`${reportEntries.join("\n")}\n`,
			"utf8",
		);
	}

	return {
		config,
		metadata,
		reportEntries,
		baselineSummaryPath,
	};
}
