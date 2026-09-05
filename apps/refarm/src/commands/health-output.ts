import chalk from "chalk";
import type { HealthPolicyReport } from "./health-policy.js";
import type {
	HealthIssue,
	HealthPolicyApplicationReport,
	HealthPolicySuggestionReport,
	HealthReport,
} from "./health.js";

// Each summary is split into a pure format*(report): string (host-agnostic —
// returns the joined lines) and a thin emit* that console.logs it. The pure
// formatter is what a CapabilitySurfaceHooks.renderText returns, so the group
// projector owns the single console.log; the emit* keeps the legacy call sites
// (and any direct caller) printing exactly as before.

/** The reason `id`'s auditor was skipped, or undefined when it ran (or does not exist). */
function skipReason(report: HealthReport, id: string): string | undefined {
	return report.skippedAuditors.find((auditor) => auditor.id === id)?.reason;
}

export function formatHealthSummary(report: HealthReport): string {
	const lines: string[] = [];
	lines.push(chalk.blue("🔍 Running health audit...\n"));

	// 0. Resolution status
	lines.push(chalk.bold("Package Resolution"));
	report.resolution.forEach((item) => {
		const modeColor = item.mode.includes("LOCAL (src)") ? chalk.yellow : chalk.green;
		lines.push(`   - ${chalk.bold(item.package.padEnd(25))} : ${modeColor(item.mode)}`);
	});
	lines.push("");

	// generic_fs (git visibility) and project (build/alignment/automations/
	// namespaces) are project-shaped: at a node base (no git repo, no
	// package.json) they do not run at all, and "0 findings" would otherwise
	// read as "checked, all clear" rather than "nothing here was checkable".
	const gitSkip = skipReason(report, "generic_fs");
	const projectSkip = skipReason(report, "project");

	// 1. Git visibility
	lines.push(chalk.bold("1. Git Source Visibility"));
	if (gitSkip) {
		lines.push(chalk.gray(`   ⏭️  Not applicable: ${gitSkip}`));
	} else if (report.results.git.length === 0) {
		lines.push(chalk.green("   ✅ All source files are tracked by Git."));
	} else {
		report.results.git.forEach((issue: HealthIssue) => {
			lines.push(chalk.yellow(`   ⚠️  ${issue.file} is a source file but is git-ignored.`));
		});
	}

	// 2. Build config
	lines.push(chalk.bold("\n2. Build Pipeline"));
	if (projectSkip) {
		lines.push(chalk.gray(`   ⏭️  Not applicable: ${projectSkip}`));
	} else if (report.results.builds.length === 0) {
		lines.push(chalk.green("   ✅ All TypeScript packages have tsconfig.build.json."));
	} else {
		report.results.builds.forEach((issue: HealthIssue) => {
			lines.push(chalk.yellow(`   ⚠️  ${issue.package} is missing tsconfig.build.json.`));
		});
	}

	// 3. Entrypoints
	lines.push(chalk.bold("\n3. Package Entrypoints"));
	if (projectSkip) {
		lines.push(chalk.gray(`   ⏭️  Not applicable: ${projectSkip}`));
	} else if (report.results.alignment.length === 0) {
		lines.push(chalk.green("   ✅ All TypeScript package entrypoints point to dist/."));
	} else {
		report.results.alignment.forEach((issue: HealthIssue) => {
			lines.push(
				chalk.yellow(`   ⚠️  ${issue.package} main points to ${issue.entry} instead of dist/.`),
			);
		});
	}

	lines.push(chalk.bold("\n4. Project Automations"));
	if (projectSkip) {
		lines.push(chalk.gray(`   ⏭️  Not applicable: ${projectSkip}`));
	} else if (!report.results.automations || report.results.automations.length === 0) {
		lines.push(chalk.green("   ✅ Project automation manifest is valid or absent."));
	} else {
		report.results.automations.forEach((issue: HealthIssue) => {
			lines.push(
				chalk.yellow(`   ⚠️  ${issue.file} ${issue.note ?? "has an invalid automation entry."}`),
			);
		});
	}

	lines.push(chalk.bold("\n5. Complexity Pressure"));
	if (!report.results.complexity) {
		lines.push(chalk.gray("   Not enabled in health policy."));
	} else if (report.results.complexity.length === 0) {
		lines.push(chalk.green("   ✅ No blocking large files found."));
	} else {
		report.results.complexity.forEach((issue: HealthIssue) => {
			lines.push(chalk.yellow(`   ⚠️  ${issue.file} has ${issue.lines} lines.`));
		});
	}

	lines.push(chalk.bold("\n6. Workspace Namespaces"));
	if (projectSkip) {
		lines.push(chalk.gray(`   ⏭️  Not applicable: ${projectSkip}`));
	} else if (!report.results.namespaceWarnings || report.results.namespaceWarnings.length === 0) {
		lines.push(
			chalk.green("   ✅ Versioned root namespaces are declared or conventional infrastructure."),
		);
	} else {
		report.results.namespaceWarnings.forEach((issue: HealthIssue) => {
			lines.push(chalk.yellow(`   ⚠️  ${issue.path} ${issue.note ?? "is undeclared."}`));
		});
	}

	// ADVISORIES PRINT EITHER WAY. They are `info` so they never lead a handoff — a prediction must
	// not displace a fault — but an advisory that appears only in `--json` reached nobody. Measured
	// 2026-08-19: `health` said "All checks passed" while carrying an unread note that the node
	// executes a git working tree.
	const advisories = report.recommendations.filter((r) => r.severity === "info");
	const faults = report.recommendations.filter((r) => r.severity !== "info");

	if (report.ok) {
		lines.push(chalk.bold.green("\n✨ All checks passed."));
		if (advisories.length > 0) {
			lines.push(chalk.bold("\nWorth knowing"));
			for (const advisory of advisories) {
				lines.push(chalk.dim(`   · ${advisory.summary}`));
				lines.push(chalk.dim(`     ${advisory.action}`));
			}
		}
	} else {
		lines.push(
			chalk.bold.yellow(
				`\n⚠️  ${report.issueCount} issue${report.issueCount === 1 ? "" : "s"} found. Review and reconcile.`,
			),
		);
		lines.push(chalk.bold("\nRecommendations"));
		[...faults, ...advisories].forEach((recommendation) => {
			const target = recommendation.target ? ` (${recommendation.target})` : "";
			lines.push(chalk.gray(`   - ${recommendation.summary}${target}`));
			lines.push(chalk.gray(`     ${recommendation.action}`));
			if (recommendation.command) {
				lines.push(chalk.gray(`     ${recommendation.command}`));
			}
		});
	}
	return lines.join("\n");
}

export function emitHealthSummary(report: HealthReport): void {
	console.log(formatHealthSummary(report));
}

export function formatHealthPolicySummary(report: HealthPolicyReport): string {
	const lines: string[] = [];
	lines.push(chalk.bold("Health Policy"));
	lines.push(`   Source: ${report.source}`);
	lines.push(`   Config: ${report.configFound ? report.configPath : "not found"}`);
	lines.push(`   Preset: ${report.policy.preset}`);
	if (report.policy.workspaceRoots?.length) {
		lines.push(`   Workspace roots: ${report.policy.workspaceRoots.join(", ")}`);
	}
	if (report.policy.exemptPackageIds?.length) {
		lines.push(`   Exempt packages: ${report.policy.exemptPackageIds.join(", ")}`);
	}
	if (report.policy.ignoredGitVisibilityPatterns.length) {
		lines.push(
			`   Ignored git visibility patterns: ${report.policy.ignoredGitVisibilityPatterns.join(", ")}`,
		);
	}
	if (report.policy.workspaceNamespaces?.length) {
		lines.push(
			`   Workspace namespaces: ${report.policy.workspaceNamespaces.map((namespace) => namespace.path).join(", ")}`,
		);
	}
	if (report.policy.complexity?.enabled) {
		lines.push(`   Complexity max lines: ${report.policy.complexity.maxLines}`);
		if (report.policy.complexity.paths?.length) {
			lines.push(`   Complexity paths: ${report.policy.complexity.paths.join(", ")}`);
		}
		if (report.policy.complexity.allowedPatterns.length) {
			lines.push(
				`   Complexity allowed patterns: ${report.policy.complexity.allowedPatterns.join(", ")}`,
			);
		}
	}
	return lines.join("\n");
}

export function emitHealthPolicySummary(report: HealthPolicyReport): void {
	console.log(formatHealthPolicySummary(report));
}

export function formatHealthPolicySuggestionSummary(report: HealthPolicySuggestionReport): string {
	return [
		chalk.bold("Health Policy Suggestion"),
		`   Source issues: ${report.sourceIssueCount}`,
		JSON.stringify({ health: report.suggestedHealth }, null, 2),
	].join("\n");
}

export function emitHealthPolicySuggestionSummary(report: HealthPolicySuggestionReport): void {
	console.log(formatHealthPolicySuggestionSummary(report));
}

export function formatHealthPolicyApplicationSummary(
	report: HealthPolicyApplicationReport,
): string {
	return [
		chalk.green("Health policy applied"),
		chalk.dim(`   ${report.configPath}`),
		JSON.stringify({ health: report.appliedHealth }, null, 2),
	].join("\n");
}

export function emitHealthPolicyApplicationSummary(report: HealthPolicyApplicationReport): void {
	console.log(formatHealthPolicyApplicationSummary(report));
}
