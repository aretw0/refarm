import { describe, expect, it } from "vitest";

import { lintFiles, summarizeLintReport } from "./lint-files.js";

/** An in-memory file set so the runner is tested without touching disk. */
function reader(files: Record<string, string>) {
	return (f: string): string => {
		if (!(f in files)) throw new Error(`ENOENT ${f}`);
		return files[f]!;
	};
}

describe("lintFiles — the runnable tells gate", () => {
	it("runs text-tells on prose and design-tells on CSS, routing by extension", () => {
		const files = {
			"doc.md": "Furthermore, we leverage a robust framework.",
			"styles.css": ".card { border-left: 4px solid #4f9d69; }",
			"readme.txt": "The scraper broke. I fixed it in ten minutes.",
		};
		const report = lintFiles(Object.keys(files), { readFile: reader(files) });
		const doc = report.files.find((f) => f.path === "doc.md")!;
		const css = report.files.find((f) => f.path === "styles.css")!;
		expect(doc.kind).toBe("prose");
		expect(doc.findings.length).toBeGreaterThan(0);
		expect(doc.verdict).toBeDefined();
		expect(css.kind).toBe("design");
		expect(css.findings.some((x) => x.ruleId === "side-stripe-border")).toBe(true);
	});

	it("keys every finding back to its file and tallies severities", () => {
		const files = { "a.md": "Furthermore, we utilize synergy." };
		const report = lintFiles(["a.md"], { readFile: reader(files) });
		expect(report.findings.every((f) => f.subjectPath === "a.md")).toBe(true);
		expect(report.counts.warn).toBeGreaterThan(0);
	});

	it("reports the WORST prose verdict across files (the CI signal)", () => {
		const files = {
			"clean.md": "It broke. I fixed it. Then I wrote the test.",
			"sloppy.md": "Furthermore, it is worth noting that we leverage a robust, comprehensive, pivotal framework. Moreover, this streamlines synergy.",
		};
		const report = lintFiles(Object.keys(files), { readFile: reader(files) });
		expect(["likely-ai", "ai", "uncertain"]).toContain(report.worstVerdict);
	});

	it("extracts CSS from an .astro file's <style> block and inline style", () => {
		const astro = `<div style="z-index: 9999;"></div><style>.x { backdrop-filter: blur(8px); }</style>`;
		const report = lintFiles(["page.astro"], { readFile: reader({ "page.astro": astro }) });
		const rules = report.files[0]!.findings.map((f) => f.ruleId);
		expect(rules).toContain("glassmorphism");
		expect(rules).toContain("arbitrary-zindex");
	});

	it("skips unknown extensions and unreadable files", () => {
		const report = lintFiles(["data.json", "missing.md"], { readFile: reader({ "data.json": "{}" }) });
		expect(report.files).toEqual([]); // .json skipped by ext; missing.md unreadable
	});

	it("summarizeLintReport gives a one-line signal", () => {
		const files = { "a.md": "Furthermore.", "b.css": ".x { z-index: 9999; }" };
		const report = lintFiles(Object.keys(files), { readFile: reader(files) });
		const line = summarizeLintReport(report);
		expect(line).toContain("2 files");
		expect(line).toContain("worst verdict:");
	});
});
