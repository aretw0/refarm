import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	DEFAULT_TEXT_QUALITY_CONFIG,
	effectiveTextQualityConfig,
	proseParagraphs,
	readFrontmatterField,
	resolveTextQualityConfigPath,
	scoreText,
	severityCounts,
	stripFrontmatter,
	wordCount,
} from "./text-quality-lib.mjs";

const cliPath = path.resolve("scripts/ci/check-text-quality.mjs");

test("text quality scorer handles plain text", () => {
	const result = scoreText("Um paragrafo simples. Outro periodo.", {
		...DEFAULT_TEXT_QUALITY_CONFIG,
		longSentenceWords: 0,
		riskPatterns: [],
		repetitionHeuristics: { paragraphStarter: { enabled: false } },
	});

	assert.deepEqual(result.findings, []);
	assert.equal(result.metrics.words, 5);
});

test("text quality scorer strips frontmatter", () => {
	const { body, lineOffset } = stripFrontmatter("---\ntitle: Test\n---\nBody here.");

	assert.equal(body, "Body here.");
	assert.equal(lineOffset, 3);
});

test("text quality scorer handles crlf frontmatter", () => {
	const text = "---\r\naudience: introductory\r\n---\r\nBody here.";
	const { body, lineOffset } = stripFrontmatter(text);

	assert.equal(body, "Body here.");
	assert.equal(lineOffset, 3);
	assert.equal(readFrontmatterField(text, "audience"), "introductory");
});

test("text quality scorer filters markdown structure from prose paragraphs", () => {
	const prose = proseParagraphs("# Title\n\n- item\n\nReal paragraph.");

	assert.deepEqual(prose.map((item) => item.text), ["Real paragraph."]);
});

test("text quality scorer detects long sentences", () => {
	const result = scoreText(
		"Esta frase possui muitas palavras para ultrapassar o limite pequeno configurado neste teste.",
		{
			...DEFAULT_TEXT_QUALITY_CONFIG,
			longSentenceWords: 5,
			riskPatterns: [],
			repetitionHeuristics: { paragraphStarter: { enabled: false } },
		},
	);

	assert.equal(result.findings[0].rule, "long-sentence");
	assert.equal(result.findings[0].severity, "info");
});

test("text quality scorer ignores markdown lists for long sentence checks", () => {
	const result = scoreText(
		[
			"Current validation:",
			"",
			"- first list item with enough words to cross the tiny threshold",
			"- second list item with enough words to cross the tiny threshold",
		].join("\n"),
		{
			...DEFAULT_TEXT_QUALITY_CONFIG,
			longSentenceWords: 5,
			riskPatterns: [],
			repetitionHeuristics: { paragraphStarter: { enabled: false } },
		},
	);

	assert.deepEqual(result.findings, []);
});

test("text quality scorer detects repeated paragraph starters", () => {
	const text = [
		"Este texto abre o primeiro paragrafo.",
		"",
		"Este texto abre o segundo paragrafo.",
		"",
		"Este texto abre o terceiro paragrafo.",
	].join("\n");
	const result = scoreText(text, {
		...DEFAULT_TEXT_QUALITY_CONFIG,
		longSentenceWords: 0,
		riskPatterns: [],
		repetitionHeuristics: {
			paragraphStarter: {
				enabled: true,
				ngramWords: 2,
				windowParagraphs: 4,
				minOccurrencesInWindow: 3,
				minWordLength: 2,
				ignoreStarters: [],
			},
		},
	});

	assert.equal(result.findings[0].rule, "paragraph-starter-repeat");
	assert.equal(result.findings[0].severity, "warn");
});

test("text quality scorer merges profile and audience", () => {
	const cfg = effectiveTextQualityConfig(DEFAULT_TEXT_QUALITY_CONFIG, {
		audience: "introductory",
		profile: "strict",
	});

	assert.equal(cfg.longSentenceWords, 32);
	assert.equal(cfg.repetitionHeuristics.paragraphStarter.windowParagraphs, 10);
});

test("text quality scorer counts severities", () => {
	assert.deepEqual(
		severityCounts([
			{ severity: "warn" },
			{ severity: "warn" },
			{ severity: "info" },
		]),
		{ fail: 0, warn: 2, info: 1 },
	);
});

test("text quality cli emits json report", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "refarm-text-quality-"));
	try {
		const file = path.join(dir, "note.md");
		writeFileSync(file, "TODO: revisar.\n", "utf8");
		const result = spawnSync(process.execPath, [cliPath, "--json", file], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

		assert.equal(result.status, 0, result.stderr);
		const payload = JSON.parse(result.stdout);
		assert.equal(payload.command, "check-text-quality");
		assert.equal(payload.summary.warn, 1);
		assert.equal(payload.files[0].findings[0].rule, "draft-markers");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("text quality cli discovers project-local .refarm config", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "refarm-text-quality-"));
	try {
		const refarmDir = path.join(dir, ".refarm");
		mkdirSync(refarmDir);
		writeFileSync(
			path.join(refarmDir, "text-quality.json"),
			JSON.stringify({
				...DEFAULT_TEXT_QUALITY_CONFIG,
				riskPatterns: [
					{
						id: "consumer-marker",
						severity: "fail",
						description: "Consumer marker detected.",
						regex: "\\bCONSUMER_MARKER\\b",
					},
				],
			}),
			"utf8",
		);
		const file = path.join(dir, "note.md");
		writeFileSync(file, "CONSUMER_MARKER\n", "utf8");
		const result = spawnSync(process.execPath, [cliPath, "--json", file], {
			cwd: dir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

		assert.equal(result.status, 1, result.stderr);
		const payload = JSON.parse(result.stdout);
		assert.equal(payload.configPath, ".refarm/text-quality.json");
		assert.equal(payload.summary.fail, 1);
		assert.equal(payload.files[0].findings[0].rule, "consumer-marker");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("text quality cli explicit config overrides discovered config", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "refarm-text-quality-"));
	try {
		const refarmDir = path.join(dir, ".refarm");
		mkdirSync(refarmDir);
		writeFileSync(
			path.join(refarmDir, "text-quality.json"),
			JSON.stringify({
				...DEFAULT_TEXT_QUALITY_CONFIG,
				riskPatterns: [
					{
						id: "discovered-marker",
						severity: "fail",
						description: "Discovered marker detected.",
						regex: "\\bMARKER\\b",
					},
				],
			}),
			"utf8",
		);
		const explicitConfig = path.join(dir, "explicit.json");
		writeFileSync(
			explicitConfig,
			JSON.stringify({
				...DEFAULT_TEXT_QUALITY_CONFIG,
				riskPatterns: [],
			}),
			"utf8",
		);
		const file = path.join(dir, "note.md");
		writeFileSync(file, "MARKER\n", "utf8");
		const result = spawnSync(
			process.execPath,
			[cliPath, "--json", "--config", explicitConfig, file],
			{
				cwd: dir,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		assert.equal(result.status, 0, result.stderr);
		const payload = JSON.parse(result.stdout);
		assert.equal(payload.summary.fail, 0);
		assert.equal(payload.configPath, "explicit.json");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("text quality config resolver returns null when no config exists", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "refarm-text-quality-"));
	try {
		assert.equal(await resolveTextQualityConfigPath(dir), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("text quality cli strict mode fails on warnings", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "refarm-text-quality-"));
	try {
		const file = path.join(dir, "note.md");
		writeFileSync(file, "TODO: revisar.\n", "utf8");
		const result = spawnSync(process.execPath, [cliPath, "--strict", file], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

		assert.notEqual(result.status, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("text quality cli rejects missing option values", () => {
	const result = spawnSync(process.execPath, [cliPath, "--config"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	assert.equal(result.status, 2);
	assert.match(result.stderr, /Missing value for: --config/u);
});

test("word count handles accented words", () => {
	assert.equal(wordCount("avaliação de textos"), 3);
});
