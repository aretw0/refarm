import { readFileSync } from "node:fs";
import path from "node:path";

import { HUMANIZER_TELLS_PROFILE } from "./humanizer-profile.js";
import { IMPECCABLE_TELLS_PROFILE } from "./impeccable-profile.js";
import { runDesignTellsRules } from "./design-tells.js";
import { countFindings } from "./report.js";
import { runTextTellsRules, scoreTextTells, type TextVerdict } from "./text-tells.js";
import type { QualityFinding, QualityProfile } from "./types.js";

/**
 * The FILE LINT runner — the runnable gate that closes the tells loop: point it at prose/CSS files
 * (the trabalhos' docs, a face's stylesheet) and it runs text-tells over the prose and design-tells
 * over the CSS, returning findings + a per-file verdict + an aggregate. This is the anti-regression
 * check the tells were built for — not a library call, a gate you run. Node-flavored (reads files),
 * so it lives in the `/node` subpath; the matchers it drives are pure.
 */

/** One file's lint result. */
export interface FileLintResult {
	path: string;
	kind: "prose" | "design";
	findings: QualityFinding[];
	/** Prose only: the AI-tell verdict tier (from scoreTextTells). */
	verdict?: TextVerdict;
	/** Prose only: tells per 1000 words. */
	tellsPerThousandWords?: number;
}

export interface LintFilesReport {
	files: FileLintResult[];
	/** Every finding across all files, keyed by file path. */
	findings: Array<QualityFinding & { subjectPath: string }>;
	/** Severity tally across all files. */
	counts: Record<string, number>;
	/** The worst prose verdict seen (for a one-line CI signal). */
	worstVerdict: TextVerdict;
}

const PROSE_EXT = new Set([".md", ".markdown", ".txt", ".mdx"]);
const DESIGN_EXT = new Set([".css", ".astro", ".html", ".htm", ".svelte", ".vue"]);

/** Extract the CSS to scan from a file: a .css file is all CSS; a markup file contributes its
 * `<style>` blocks + inline `style="…"` attributes. */
function cssFromFile(ext: string, text: string): string {
	if (ext === ".css") return text;
	const styles = [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "");
	const inline = [...text.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1] ?? "");
	return [...styles, ...inline].join("\n");
}

const VERDICT_RANK: Record<TextVerdict, number> = {
	human: 0,
	"likely-human": 1,
	uncertain: 2,
	"likely-ai": 3,
	ai: 4,
};

export interface LintFilesOptions {
	/** Override the prose profile (default HUMANIZER_TELLS_PROFILE). */
	proseProfile?: QualityProfile;
	/** Override the design profile (default IMPECCABLE_TELLS_PROFILE). */
	designProfile?: QualityProfile;
	/** Read a file's text (injected for tests; default node:fs). */
	readFile?: (file: string) => string;
}

/**
 * Lint a set of files for AI tells. Routes each by extension: prose files run text-tells (with a
 * verdict), design/markup files run design-tells over their CSS. Returns per-file results + an
 * aggregate with the worst verdict — the runnable anti-regression gate. Files with an unknown
 * extension are skipped. PURE given an injected `readFile`.
 */
export function lintFiles(files: readonly string[], options: LintFilesOptions = {}): LintFilesReport {
	const read = options.readFile ?? ((f: string): string => readFileSync(f, "utf8"));
	const proseProfile = options.proseProfile ?? HUMANIZER_TELLS_PROFILE;
	const designProfile = options.designProfile ?? IMPECCABLE_TELLS_PROFILE;

	const results: FileLintResult[] = [];
	const allFindings: Array<QualityFinding & { subjectPath: string }> = [];
	let worst: TextVerdict = "human";

	for (const file of files) {
		const ext = path.extname(file).toLowerCase();
		let text: string;
		try {
			text = read(file);
		} catch {
			continue; // unreadable → skip
		}
		if (PROSE_EXT.has(ext)) {
			const score = scoreTextTells({ path: file, text }, proseProfile);
			results.push({
				path: file,
				kind: "prose",
				findings: score.findings,
				verdict: score.verdict,
				tellsPerThousandWords: score.tellsPerThousandWords,
			});
			for (const f of score.findings) allFindings.push({ ...f, subjectPath: file });
			if (VERDICT_RANK[score.verdict] > VERDICT_RANK[worst]) worst = score.verdict;
		} else if (DESIGN_EXT.has(ext)) {
			const css = cssFromFile(ext, text);
			const findings = runDesignTellsRules({ path: file, css }, designProfile);
			results.push({ path: file, kind: "design", findings });
			for (const f of findings) allFindings.push({ ...f, subjectPath: file });
		}
		// unknown extension → skipped
	}

	return { files: results, findings: allFindings, counts: countFindings(allFindings), worstVerdict: worst };
}

/** A one-line human summary of a lint report — the CI/operator signal. */
export function summarizeLintReport(report: LintFilesReport): string {
	const total = report.findings.length;
	const proseFiles = report.files.filter((f) => f.kind === "prose").length;
	const designFiles = report.files.filter((f) => f.kind === "design").length;
	return `${report.files.length} files (${proseFiles} prose, ${designFiles} design) · ${total} tells · worst verdict: ${report.worstVerdict}`;
}

// Re-export the matcher runners so a /node consumer has everything from one import.
export { runTextTellsRules, runDesignTellsRules };
