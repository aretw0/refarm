import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_TEXT_QUALITY_CONFIG_PATHS = [".refarm/text-quality.json"];

export const DEFAULT_TEXT_QUALITY_CONFIG = {
	version: 1,
	longSentenceWords: 45,
	riskPatterns: [
		{
			id: "draft-markers",
			severity: "warn",
			description: "Draft markers should not remain in promoted prose.",
			regex: "\\b(TODO|FIXME|PENDENTE|PENDENTES)\\b",
		},
		{
			id: "chatbot-artifact",
			severity: "warn",
			description: "Conversational assistant artifacts should be edited out.",
			regex:
				"\\b(espero que isso ajude|me avise se|posso detalhar|sem mais delongas|vamos explorar)\\b",
		},
		{
			id: "generic-authority",
			severity: "warn",
			description: "Vague authority claims need explicit sources.",
			regex:
				"\\b(especialistas (acreditam|afirmam|defendem)|relat[oó]rios do setor indicam|observadores (apontam|notam))\\b",
		},
	],
	repetitionHeuristics: {
		paragraphStarter: {
			enabled: true,
			ngramWords: 2,
			windowParagraphs: 12,
			minOccurrencesInWindow: 3,
			minWordLength: 2,
			ignoreStarters: ["por exemplo", "em termos", "a figura"],
		},
	},
	profiles: {
		default: {},
		strict: {
			longSentenceWords: 38,
			repetitionHeuristics: {
				paragraphStarter: {
					windowParagraphs: 10,
				},
			},
		},
	},
	audiences: {
		default: {},
		introductory: {
			longSentenceWords: 32,
		},
		advanced: {
			longSentenceWords: 55,
		},
	},
};

const WORD_RE = /[\p{L}\p{N}_]+(?:[-'][\p{L}\p{N}_]+)?/gu;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u;

export function deepMerge(base, overlay) {
	const out = structuredClone(base);
	for (const [key, value] of Object.entries(overlay ?? {})) {
		if (
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			out[key] &&
			typeof out[key] === "object" &&
			!Array.isArray(out[key])
		) {
			out[key] = deepMerge(out[key], value);
		} else {
			out[key] = structuredClone(value);
		}
	}
	return out;
}

export function effectiveTextQualityConfig(
	baseConfig = DEFAULT_TEXT_QUALITY_CONFIG,
	{ profile = "default", audience = "default" } = {},
) {
	const profiles = baseConfig.profiles ?? {};
	const audiences = baseConfig.audiences ?? {};
	const profileConfig = profiles[profile] ?? profiles.default ?? {};
	const audienceConfig = audiences[audience] ?? audiences.default ?? {};
	return deepMerge(deepMerge(baseConfig, profileConfig), audienceConfig);
}

export function normalizeText(value) {
	return String(value ?? "")
		.normalize("NFKD")
		.replace(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase();
}

export function stripFrontmatter(text) {
	const raw = String(text ?? "").replace(/^\uFEFF/u, "");
	const match = raw.match(FRONTMATTER_RE);
	if (!match) {
		return { body: raw, lineOffset: 0 };
	}
	const cut = match[0].length;
	const lineOffset = raw.slice(0, cut).split(/\r?\n/u).length - 1;
	return { body: raw.slice(cut), lineOffset };
}

export function readFrontmatterField(text, field) {
	const raw = String(text ?? "").replace(/^\uFEFF/u, "");
	const frontmatterMatch = raw.match(FRONTMATTER_RE);
	if (!frontmatterMatch) return null;
	const frontmatter = frontmatterMatch[1];
	const pattern = new RegExp(`^${escapeRegExp(field)}\\s*:\\s*(.+?)\\s*$`, "mu");
	const match = frontmatter.match(pattern);
	return match?.[1]?.trim().replace(/^["']|["']$/gu, "") ?? null;
}

export function wordCount(text) {
	return Array.from(String(text ?? "").matchAll(WORD_RE)).length;
}

function lineEntries(text, offset = 0) {
	return String(text ?? "")
		.split(/\r?\n/u)
		.map((line, index) => ({ line: index + 1 + offset, text: line }));
}

function extractParagraphsFromEntries(entries) {
	const paragraphs = [];
	let current = [];
	let startLine = null;
	for (const entry of entries) {
		if (!entry.text.trim()) {
			if (current.length > 0 && startLine !== null) {
				paragraphs.push({
					line: startLine,
					text: current.map((line) => line.trim()).join(" ").trim(),
				});
			}
			current = [];
			startLine = null;
			continue;
		}
		startLine ??= entry.line;
		current.push(entry.text);
	}
	if (current.length > 0 && startLine !== null) {
		paragraphs.push({
			line: startLine,
			text: current.map((line) => line.trim()).join(" ").trim(),
		});
	}
	return paragraphs;
}

export function extractParagraphs(text, offset = 0) {
	return extractParagraphsFromEntries(lineEntries(text, offset));
}

function proseParagraphsFromEntries(entries) {
	return extractParagraphsFromEntries(entries).filter((paragraph) => {
		const trimmed = paragraph.text.trimStart();
		return (
			trimmed &&
			!trimmed.startsWith("#") &&
			!trimmed.startsWith("- ") &&
			!trimmed.startsWith("* ") &&
			!trimmed.startsWith("|") &&
			!trimmed.startsWith("```")
		);
	});
}

export function proseParagraphs(text, offset = 0) {
	return proseParagraphsFromEntries(lineEntries(text, offset));
}

export function splitSentences(text) {
	return String(text ?? "")
		.split(/\r?\n/u)
		.filter((line) => !line.trimStart().startsWith("|"))
		.join(" ")
		.replace(/\s+/gu, " ")
		.split(/(?<=[.!?])\s+/u)
		.map((sentence) => sentence.trim())
		.filter(Boolean);
}

function paragraphStarter(paragraph, { ngramWords, minWordLength }) {
	return Array.from(paragraph.matchAll(WORD_RE))
		.map((match) => normalizeText(match[0]))
		.filter((word) => word.length >= minWordLength)
		.slice(0, ngramWords)
		.join(" ");
}

export function scoreText(text, config = DEFAULT_TEXT_QUALITY_CONFIG, source = "") {
	const findings = [];
	const { body, lineOffset } = stripFrontmatter(text);
	const entries = lineEntries(body, lineOffset);
	const prose = proseParagraphsFromEntries(entries);
	const metrics = {
		source,
		words: wordCount(body),
		generatedAt: new Date().toISOString(),
	};

	for (const pattern of config.riskPatterns ?? []) {
		const regex = new RegExp(pattern.regex, "giu");
		for (const entry of entries) {
			if (!regex.test(entry.text)) continue;
			findings.push({
				severity: pattern.severity ?? "warn",
				rule: pattern.id,
				message: pattern.description ?? "Text quality pattern detected.",
				line: entry.line,
				snippet: entry.text.trim(),
			});
			regex.lastIndex = 0;
		}
	}

	const starterConfig = config.repetitionHeuristics?.paragraphStarter ?? {};
	if (starterConfig.enabled !== false) {
		const queues = new Map();
		const hits = [];
		const ngramWords = Number(starterConfig.ngramWords ?? 2);
		const minWordLength = Number(starterConfig.minWordLength ?? 2);
		const windowParagraphs = Number(starterConfig.windowParagraphs ?? 12);
		const minOccurrences = Number(starterConfig.minOccurrencesInWindow ?? 3);
		const ignore = new Set(
			(starterConfig.ignoreStarters ?? []).map((starter) => normalizeText(starter)),
		);

		for (const [index, paragraph] of prose.entries()) {
			const starter = paragraphStarter(paragraph.text, { ngramWords, minWordLength });
			if (!starter || ignore.has(starter)) continue;
			const queue = queues.get(starter) ?? [];
			queue.push({ index, line: paragraph.line });
			while (queue.length > 0 && index - queue[0].index > windowParagraphs) {
				queue.shift();
			}
			queues.set(starter, queue);
			if (queue.length === minOccurrences) {
				findings.push({
					severity: "warn",
					rule: "paragraph-starter-repeat",
					message: `Paragraph starter repeated: '${starter}' appeared ${minOccurrences} times in ${windowParagraphs} paragraphs.`,
					line: paragraph.line,
					snippet: paragraph.text.slice(0, 220),
				});
				hits.push({
					starter,
					line: paragraph.line,
					firstLineInWindow: queue[0].line,
					occurrences: minOccurrences,
				});
			}
		}
		if (hits.length > 0) {
			metrics.paragraphStarterRepeats = hits;
		}
	}

	const longSentenceWords = Number(config.longSentenceWords ?? 0);
	if (longSentenceWords > 0) {
		const longSentences = prose
			.flatMap((paragraph) =>
				splitSentences(paragraph.text).map((sentence) => ({
					line: paragraph.line,
					words: wordCount(sentence),
					sentence,
				})),
			)
			.filter((item) => item.words > longSentenceWords)
			.sort((a, b) => b.words - a.words);
		metrics.longSentences = longSentences.slice(0, 10);
		for (const item of longSentences.slice(0, 5)) {
			findings.push({
				severity: "info",
				rule: "long-sentence",
				message: `Long sentence with ${item.words} words (> ${longSentenceWords}).`,
				line: item.line,
				snippet: item.sentence.slice(0, 240),
			});
		}
	}

	return { findings, metrics };
}

export function severityCounts(findings) {
	const counts = { fail: 0, warn: 0, info: 0 };
	for (const finding of findings) {
		counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
	}
	return counts;
}

export function statusForFindings(findings) {
	const counts = severityCounts(findings);
	if (counts.fail > 0) return "FAIL";
	if (counts.warn > 0) return "PASS_WITH_WARNINGS";
	return "PASS";
}

export async function loadTextQualityConfig(configPath) {
	if (!configPath) return DEFAULT_TEXT_QUALITY_CONFIG;
	const raw = await readFile(configPath, "utf8");
	return JSON.parse(raw);
}

export async function resolveTextQualityConfigPath(cwd = process.cwd()) {
	for (const candidate of DEFAULT_TEXT_QUALITY_CONFIG_PATHS) {
		const resolved = path.resolve(cwd, candidate);
		try {
			await access(resolved);
			return resolved;
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	}
	return null;
}

export async function loadDiscoveredTextQualityConfig({
	configPath,
	cwd = process.cwd(),
} = {}) {
	const resolvedConfigPath = configPath ?? (await resolveTextQualityConfigPath(cwd));
	const config = await loadTextQualityConfig(resolvedConfigPath);
	return {
		config,
		configPath: resolvedConfigPath,
	};
}

export async function scoreFile(file, config, { profile = "default", audience } = {}) {
	const text = await readFile(file, "utf8");
	const resolvedAudience = audience ?? readFrontmatterField(text, "audience") ?? "default";
	const effectiveConfig = effectiveTextQualityConfig(config, {
		profile,
		audience: resolvedAudience,
	});
	const result = scoreText(text, effectiveConfig, path.normalize(file));
	const counts = severityCounts(result.findings);
	return {
		path: path.normalize(file),
		profile,
		audience: resolvedAudience,
		status: statusForFindings(result.findings),
		counts,
		findings: result.findings,
		metrics: result.metrics,
	};
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
