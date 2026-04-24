import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
	hasAlertAtOrAbove,
	normalizeRuntimeDescriptorRevocationReport,
	toPositiveInteger,
} from "./runtime-descriptor-revocation-report-lib.mjs";

export async function collectJsonFilesRecursive(rootDir) {
	const files = [];
	const stack = [rootDir];
	while (stack.length > 0) {
		const current = stack.pop();
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			const nextPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(nextPath);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".json")) {
				files.push(nextPath);
			}
		}
	}
	return files.sort((a, b) => a.localeCompare(b));
}

export function parseReportsArg(value) {
	if (!value || typeof value !== "string") return [];
	return value
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean);
}

export async function readReportsFile(filePath) {
	const content = await readFile(filePath, "utf8");
	return content
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

export async function resolveReportPaths({
	root,
	reports,
	reportsFile,
	historyDir,
}) {
	const reportPaths = new Set();
	for (const report of parseReportsArg(reports)) {
		reportPaths.add(path.resolve(root, report));
	}

	if (typeof reportsFile === "string") {
		for (const report of await readReportsFile(
			path.resolve(root, reportsFile),
		)) {
			reportPaths.add(path.resolve(root, report));
		}
	}

	if (typeof historyDir === "string") {
		const resolvedHistoryDir = path.resolve(root, historyDir);
		const info = await stat(resolvedHistoryDir).catch(() => null);
		if (info?.isDirectory()) {
			for (const candidate of await collectJsonFilesRecursive(
				resolvedHistoryDir,
			)) {
				reportPaths.add(candidate);
			}
		}
	}

	return Array.from(reportPaths).sort((a, b) => a.localeCompare(b));
}

export async function loadNormalizedReports(paths) {
	const reports = [];
	for (const sourcePath of paths) {
		const raw = JSON.parse(await readFile(sourcePath, "utf8"));
		reports.push(normalizeRuntimeDescriptorRevocationReport(raw, sourcePath));
	}
	return reports;
}

function resolveFailThreshold(args, key, fallback = Number.POSITIVE_INFINITY) {
	const resolved = toPositiveInteger(args[key]);
	if (resolved == null) return fallback;
	return resolved;
}

export function evaluateHistoryFailurePolicy(snapshot, args) {
	if (!snapshot.delta) return;

	const failOnTotalIncrease = resolveFailThreshold(
		args,
		"fail-on-total-increase",
	);
	const failOnUnavailableIncrease = resolveFailThreshold(
		args,
		"fail-on-unavailable-increase",
	);
	const failOnCriticalAlertIncrease = resolveFailThreshold(
		args,
		"fail-on-critical-alert-increase",
	);
	const failOnSeverity =
		typeof args["fail-on-severity"] === "string"
			? args["fail-on-severity"]
			: "";

	const reasons = [];
	if (snapshot.delta.totalEventsDelta >= failOnTotalIncrease) {
		reasons.push(
			`totalEvents delta ${snapshot.delta.totalEventsDelta} >= threshold ${failOnTotalIncrease}`,
		);
	}

	const unavailableDelta =
		snapshot.delta.byEventDelta["system:descriptor_revocation_unavailable"] ??
		0;
	if (unavailableDelta >= failOnUnavailableIncrease) {
		reasons.push(
			`unavailable delta ${unavailableDelta} >= threshold ${failOnUnavailableIncrease}`,
		);
	}

	const criticalAlertDelta = snapshot.delta.alertSeverityDelta.critical ?? 0;
	if (criticalAlertDelta >= failOnCriticalAlertIncrease) {
		reasons.push(
			`critical alert delta ${criticalAlertDelta} >= threshold ${failOnCriticalAlertIncrease}`,
		);
	}

	if (failOnSeverity && snapshot.latest) {
		if (hasAlertAtOrAbove(snapshot.latest.alerts, failOnSeverity)) {
			reasons.push(
				`latest report has alert at/above severity '${failOnSeverity}'`,
			);
		}
	}

	if (reasons.length > 0) {
		throw new Error(`failure policy triggered: ${reasons.join("; ")}`);
	}
}
