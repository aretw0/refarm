#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SEARCH_ROOTS = ["apps", "packages", "validations", "templates"];
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	".turbo",
	"dist",
	"build",
	"target",
	".astro",
	"coverage",
]);

function toPosix(p) {
	return p.split(path.sep).join("/");
}

function formatDurationMs(ms) {
	if (!Number.isFinite(ms) || ms <= 0) {
		return "0ms";
	}
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(2)}s`;
}

function mdEscape(value) {
	return String(value).replace(/\|/g, "\\|");
}

async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function collectVitestReportFiles() {
	const reportFiles = [];

	async function walk(dir) {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (SKIP_DIRS.has(entry.name)) continue;

			const full = path.join(dir, entry.name);

			if (entry.name === ".artifacts") {
				const vitestDir = path.join(full, "vitest");
				if (await fileExists(vitestDir)) {
					const files = await fs.readdir(vitestDir, { withFileTypes: true });
					for (const f of files) {
						if (!f.isFile()) continue;
						if (!/^report-.*\.json$/.test(f.name) && f.name !== "report.json")
							continue;
						reportFiles.push(path.join(vitestDir, f.name));
					}
				}
				continue;
			}

			await walk(full);
		}
	}

	for (const root of SEARCH_ROOTS) {
		const full = path.join(ROOT, root);
		if (await fileExists(full)) {
			await walk(full);
		}
	}

	reportFiles.sort();
	return reportFiles;
}

function inferWorkspace(reportPath) {
	const marker = `${path.sep}.artifacts${path.sep}vitest${path.sep}`;
	const idx = reportPath.indexOf(marker);
	if (idx === -1) return toPosix(path.relative(ROOT, path.dirname(reportPath)));
	return toPosix(path.relative(ROOT, reportPath.slice(0, idx)));
}

async function parseReports(reportFiles) {
	const records = [];

	for (const file of reportFiles) {
		try {
			const raw = await fs.readFile(file, "utf8");
			const data = JSON.parse(raw);
			records.push({
				file,
				workspace: inferWorkspace(file),
				data,
			});
		} catch (error) {
			records.push({
				file,
				workspace: inferWorkspace(file),
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return records;
}

function aggregate(records) {
	const okRecords = records.filter((r) => !r.error);
	const failedParse = records.filter((r) => r.error);

	const totals = {
		reportFiles: records.length,
		parsedFiles: okRecords.length,
		parseFailures: failedParse.length,
		files: {
			total: 0,
			passed: 0,
			failed: 0,
		},
		tests: {
			total: 0,
			passed: 0,
			failed: 0,
			pending: 0,
			todo: 0,
		},
		durationMs: 0,
	};

	const workspaceMap = new Map();
	const slowFiles = [];
	const slowTests = [];
	const failures = [];

	for (const record of okRecords) {
		const { workspace, file, data } = record;
		const ws = workspaceMap.get(workspace) || {
			workspace,
			reportFiles: 0,
			files: { total: 0, passed: 0, failed: 0 },
			tests: { total: 0, passed: 0, failed: 0, pending: 0, todo: 0 },
			durationMs: 0,
		};

		ws.reportFiles += 1;

		const testResults = Array.isArray(data.testResults) ? data.testResults : [];
		const fileTotal = testResults.length;
		const fileFailed = testResults.filter((result) => result.status === "failed").length;
		const filePassed = Math.max(0, fileTotal - fileFailed);

		ws.files.total += fileTotal;
		ws.files.passed += filePassed;
		ws.files.failed += fileFailed;

		totals.files.total += fileTotal;
		totals.files.passed += filePassed;
		totals.files.failed += fileFailed;

		const testTotal = Number(data.numTotalTests || 0);
		const testPassed = Number(data.numPassedTests || 0);
		const testFailed = Number(data.numFailedTests || 0);
		const testPending = Number(data.numPendingTests || 0);
		const testTodo = Number(data.numTodoTests || 0);

		ws.tests.total += testTotal;
		ws.tests.passed += testPassed;
		ws.tests.failed += testFailed;
		ws.tests.pending += testPending;
		ws.tests.todo += testTodo;

		totals.tests.total += testTotal;
		totals.tests.passed += testPassed;
		totals.tests.failed += testFailed;
		totals.tests.pending += testPending;
		totals.tests.todo += testTodo;

		for (const result of testResults) {
			const fileDuration = Math.max(
				0,
				Number(result.endTime || 0) - Number(result.startTime || 0),
			);
			ws.durationMs += fileDuration;
			totals.durationMs += fileDuration;

			slowFiles.push({
				workspace,
				reportFile: toPosix(path.relative(ROOT, file)),
				testFile: toPosix(path.relative(ROOT, result.name || "")),
				durationMs: fileDuration,
			});

			const assertions = Array.isArray(result.assertionResults)
				? result.assertionResults
				: [];
			for (const assertion of assertions) {
				const assertionDuration = Number(assertion.duration || 0);
				if (assertionDuration > 0) {
					slowTests.push({
						workspace,
						testFile: toPosix(path.relative(ROOT, result.name || "")),
						testName: assertion.fullName || assertion.title || "(unnamed)",
						durationMs: assertionDuration,
					});
				}

				if (assertion.status === "failed") {
					failures.push({
						workspace,
						testFile: toPosix(path.relative(ROOT, result.name || "")),
						testName: assertion.fullName || assertion.title || "(unnamed)",
						message:
							Array.isArray(assertion.failureMessages) &&
							assertion.failureMessages[0]
								? String(assertion.failureMessages[0]).split("\n")[0]
								: "(no failure message)",
					});
				}
			}
		}

		workspaceMap.set(workspace, ws);
	}

	const workspaces = [...workspaceMap.values()].sort((a, b) =>
		a.workspace.localeCompare(b.workspace),
	);
	slowFiles.sort((a, b) => b.durationMs - a.durationMs);
	slowTests.sort((a, b) => b.durationMs - a.durationMs);

	return {
		generatedAt: new Date().toISOString(),
		totals,
		workspaces,
		slowFiles,
		slowTests,
		failures,
		parseFailures: failedParse,
	};
}

function renderMarkdown(summary) {
	const lines = [];
	lines.push("## Vitest Detailed Report");
	lines.push("");

	lines.push("### Summary");
	lines.push("");
	lines.push(
		`- **Report Files**: ${summary.totals.parsedFiles}/${summary.totals.reportFiles} parsed`,
	);
	if (summary.totals.parseFailures > 0) {
		lines.push(`- ⚠️ **Parse Failures**: ${summary.totals.parseFailures}`);
	}
	lines.push(
		`- **Test Files**: ✅ **${summary.totals.files.passed} passes** · ❌ **${summary.totals.files.failed} failures** · ${summary.totals.files.total} total`,
	);
	lines.push(
		`- **Test Results**: ✅ **${summary.totals.tests.passed} passes** · ❌ **${summary.totals.tests.failed} failures** · ${summary.totals.tests.total} total`,
	);
	if (summary.totals.tests.pending > 0 || summary.totals.tests.todo > 0) {
		lines.push(
			`- **Other**: ${summary.totals.tests.pending} pending · ${summary.totals.tests.todo} todo`,
		);
	}
	lines.push(
		`- **Reported duration (tests only)**: ${formatDurationMs(summary.totals.durationMs)}`,
	);
	lines.push("");

	if (summary.workspaces.length > 0) {
		lines.push("### Workspace Breakdown");
		lines.push("");
		lines.push(
			"| Workspace | Reports | Test Files (pass/fail) | Test Results (pass/fail/pending/todo) | Duration |",
		);
		lines.push("|---|---:|---:|---:|---:|");
		for (const ws of summary.workspaces) {
			lines.push(
				`| ${mdEscape(ws.workspace)} | ${ws.reportFiles} | ${ws.files.passed}/${ws.files.failed} | ${ws.tests.passed}/${ws.tests.failed}/${ws.tests.pending}/${ws.tests.todo} | ${formatDurationMs(ws.durationMs)} |`,
			);
		}
		lines.push("");
	}

	const topSlowFiles = summary.slowFiles.slice(0, 10);
	if (topSlowFiles.length > 0) {
		lines.push("### Slowest Test Files");
		lines.push("");
		lines.push("| Workspace | Test File | Duration |");
		lines.push("|---|---|---:|");
		for (const item of topSlowFiles) {
			lines.push(
				`| ${mdEscape(item.workspace)} | ${mdEscape(item.testFile)} | ${formatDurationMs(item.durationMs)} |`,
			);
		}
		lines.push("");
	}

	const topSlowTests = summary.slowTests.slice(0, 15);
	if (topSlowTests.length > 0) {
		lines.push("### Slowest Test Cases");
		lines.push("");
		lines.push("| Workspace | Test File | Test Name | Duration |");
		lines.push("|---|---|---|---:|");
		for (const item of topSlowTests) {
			lines.push(
				`| ${mdEscape(item.workspace)} | ${mdEscape(item.testFile)} | ${mdEscape(item.testName)} | ${formatDurationMs(item.durationMs)} |`,
			);
		}
		lines.push("");
	}

	const topFailures = summary.failures.slice(0, 20);
	if (topFailures.length > 0) {
		lines.push("### Failed Assertions (Top 20)");
		lines.push("");
		for (const failure of topFailures) {
			lines.push(
				`- **${mdEscape(failure.workspace)}** · ${mdEscape(failure.testFile)} · \`${mdEscape(failure.testName)}\``,
			);
			lines.push(`  - ${mdEscape(failure.message)}`);
		}
		lines.push("");
	}

	if (summary.parseFailures.length > 0) {
		lines.push("### Report Parse Failures");
		lines.push("");
		for (const item of summary.parseFailures.slice(0, 20)) {
			lines.push(
				`- ${mdEscape(toPosix(path.relative(ROOT, item.file)))}: ${mdEscape(item.error || "unknown error")}`,
			);
		}
		lines.push("");
	}

	if (summary.totals.reportFiles === 0) {
		lines.push(
			"_No Vitest JSON reports found under workspace `.artifacts/vitest/` paths._",
		);
		lines.push("");
	}

	return `${lines.join("\n")}\n`;
}

async function main() {
	const reportFiles = await collectVitestReportFiles();
	const records = await parseReports(reportFiles);
	const summary = aggregate(records);
	const markdown = renderMarkdown(summary);

	const outDir = path.join(ROOT, ".artifacts", "vitest");
	await fs.mkdir(outDir, { recursive: true });
	await fs.writeFile(path.join(outDir, "summary.md"), markdown, "utf8");
	await fs.writeFile(
		path.join(outDir, "summary.json"),
		`${JSON.stringify(summary, null, 2)}\n`,
		"utf8",
	);

	if (process.env.GITHUB_STEP_SUMMARY) {
		await fs.appendFile(
			process.env.GITHUB_STEP_SUMMARY,
			`\n${markdown}`,
			"utf8",
		);
	}

	console.log(
		`[vitest-summary] reports=${summary.totals.reportFiles} parsed=${summary.totals.parsedFiles} failures=${summary.totals.tests.failed}`,
	);
}

main().catch((error) => {
	console.error("[vitest-summary] failed:", error);
	process.exit(1);
});
