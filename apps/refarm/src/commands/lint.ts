import { execFileSync } from "node:child_process";

import { printJson } from "@refarm.dev/capabilities/envelope";
import { lintFiles, summarizeLintReport, type LintFilesReport } from "@refarm.dev/quality-contract-v1/node";
import { Command } from "commander";

/**
 * `refarm lint` — the runnable AI-tells gate over files. Runs text-tells over prose (.md/.txt) and
 * design-tells over CSS (.css/.astro/.html), reporting the AI-writing/AI-slop tells and a per-file
 * verdict. The anti-regression check for the project's own writing + faces: run it in CI, or by
 * hand before a commit, and a new tell is caught the moment it lands.
 *
 * With no paths it lints the repo's tracked prose + stylesheets (git ls-files); pass paths to scope
 * it. `--fail-on <verdict>` exits non-zero when any prose file reaches that verdict (a CI gate).
 */

const VERDICT_RANK: Record<string, number> = {
	human: 0,
	"likely-human": 1,
	uncertain: 2,
	"likely-ai": 3,
	ai: 4,
};

/** The default file set: tracked markdown + stylesheets, via git (so it respects .gitignore). */
function defaultFiles(cwd: string): string[] {
	try {
		const out = execFileSync(
			"git",
			["ls-files", "*.md", "*.markdown", "*.txt", "*.css", "*.astro", "*.html"],
			{ cwd, encoding: "utf8" },
		);
		return out.split("\n").map((f) => f.trim()).filter(Boolean);
	} catch {
		return [];
	}
}

interface LintDeps {
	run?: (files: string[]) => LintFilesReport;
	listDefault?: (cwd: string) => string[];
}

export function createLintCommand(deps: LintDeps = {}): Command {
	const run = deps.run ?? ((files) => lintFiles(files));
	const listDefault = deps.listDefault ?? defaultFiles;
	return new Command("lint")
		.description("Run the AI-tells gate over prose + CSS (anti-regression for writing & faces)")
		.argument("[paths...]", "Files to lint (default: the repo's tracked .md + .css/.astro)")
		.option("--json", "Output the machine-readable lint report")
		.option("--fail-on <verdict>", "Exit non-zero if any file reaches this verdict (uncertain|likely-ai|ai)")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm lint                       # lint all tracked prose + stylesheets
  $ refarm lint docs/**/*.md          # lint specific files
  $ refarm lint --json
  $ refarm lint --fail-on likely-ai   # CI gate

Notes:
  Prose (.md/.txt) runs text-tells (banned words, hedges, AI transitions, em-dash
  density, sentence cadence) with a verdict; CSS/markup runs design-tells (AI-slop:
  side stripes, gradient text, glassmorphism, bounce easing, magic z-index, …).`,
		)
		.action((paths: string[], options: { json?: boolean; failOn?: string }) => {
			const files = paths.length > 0 ? paths : listDefault(process.cwd());
			const report = run(files);

			if (options.json) {
				printJson({ ok: true, command: "lint", operation: "lint", ...report });
			} else {
				process.stdout.write(`${summarizeLintReport(report)}\n`);
				const flagged = report.files
					.filter((f) => (f.kind === "prose" ? (VERDICT_RANK[f.verdict ?? "human"] ?? 0) >= 2 : f.findings.length > 0))
					.sort((a, b) => b.findings.length - a.findings.length);
				for (const f of flagged) {
					const tag = f.kind === "prose" ? f.verdict : `${f.findings.length} tells`;
					process.stdout.write(`  ${String(tag).padEnd(13)} ${f.path}\n`);
				}
			}

			if (options.failOn) {
				const threshold = VERDICT_RANK[options.failOn] ?? Number.POSITIVE_INFINITY;
				const worst = VERDICT_RANK[report.worstVerdict] ?? 0;
				if (worst >= threshold) process.exitCode = 1;
			}
		});
}

export const lintCommand = createLintCommand();
