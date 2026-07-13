import type { QualityChecker, QualityFinding, QualityProfile } from "./types.js";

/**
 * TEXT-TELLS — a deterministic prose-quality evaluator that flags the "AI tells" of generated
 * writing, as a quality:v1 checker over `{path, text}`. Where a humanizer skill is PROSE the LLM
 * is asked to follow, this is DATA + code: the tells are rules a matcher runs, so the same profile
 * runs as a gate (catches regressions) instead of a reminder. matcher-is-data — each rule's
 * `check.type` selects a matcher; unknown types are skipped (forward-safe).
 *
 * Modeled on the humanizer "nine levers" (perplexity, burstiness, hedge surgery, transitions,
 * punctuation, RLHF voice), reduced to the DETERMINISTIC subset a matcher can decide:
 *   banned-words     — AI-canonical vocabulary (delve, leverage, robust, comprehensive, …).
 *   stock-phrase     — hedges/filler ("it is worth noting", "it is important to note that", …).
 *   ai-transition    — mechanical connectives (Furthermore, Moreover, "It is clear that", …).
 *   em-dash-density  — em dashes above a per-N-words baseline (AI runs 3–5× human).
 *   sentence-burstiness — too-uniform sentence lengths (low variance = AI cadence).
 * The rich judgment (voice, specificity) stays for an LLM pass; this pins the mechanical tells.
 */

/** What a text-tells rule inspects: the subject's path (for the locus) + its full text. */
export interface TextQualitySubject {
	path: string;
	text: string;
}

function strList(check: Record<string, unknown>, key: string): string[] {
	const v = check[key];
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function num(check: Record<string, unknown>, key: string): number | undefined {
	const v = check[key];
	return typeof v === "number" ? v : undefined;
}

/** Count words in a text (whitespace-split, non-empty). */
function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Split prose into sentences (on . ! ? followed by space/end), dropping empties. Coarse but
 * enough for a cadence signal. */
function sentences(text: string): string[] {
	return text
		.replace(/\s+/g, " ")
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Population standard deviation of a number list (0 for <2 items). */
function stdev(values: number[]): number {
	if (values.length < 2) return 0;
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

/** Find every whole-word, case-insensitive occurrence of a term. Returns match indices. */
function findTermIndices(text: string, term: string): number[] {
	const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// Word-boundary for alnum terms; for multi-word/phrase terms, boundary at the ends only.
	const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
	const out: number[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) out.push(m.index);
	return out;
}

/** Run the text-tells rules in `profile` against one subject. PURE. */
export function runTextTellsRules(subject: TextQualitySubject, profile: QualityProfile): QualityFinding[] {
	const findings: QualityFinding[] = [];
	const text = subject.text;
	for (const rule of profile.rules) {
		const check = rule.check;
		switch (check.type) {
			case "banned-words":
			case "stock-phrase":
			case "ai-transition": {
				// All three are "flag each occurrence of a listed term" — the list IS the data.
				const terms = strList(check, "terms");
				for (const term of terms) {
					for (const index of findTermIndices(text, term)) {
						findings.push({
							severity: rule.severity,
							ruleId: rule.id,
							message: rule.description || `${check.type}: "${term}"`,
							locus: { path: subject.path, term, index },
						});
					}
				}
				break;
			}
			case "em-dash-density": {
				// AI prose runs em dashes 3–5× the human baseline. Flag when density exceeds
				// `maxPer` dashes per `words` words.
				const per = num(check, "words") ?? 300;
				const maxPer = num(check, "maxPer") ?? 1;
				const dashes = (text.match(/—/g) ?? []).length;
				const words = wordCount(text);
				const allowed = Math.max(maxPer, Math.ceil((words / per) * maxPer));
				if (dashes > allowed) {
					findings.push({
						severity: rule.severity,
						ruleId: rule.id,
						message: rule.description || `too many em dashes: ${dashes} > ${allowed} for ${words} words`,
						locus: { path: subject.path, dashes, allowed, words },
					});
				}
				break;
			}
			case "sentence-burstiness": {
				// Human writing varies sentence length; AI is uniform. Flag when the stdev of
				// sentence word-counts is below `minStdev` (only for texts with enough sentences).
				const minStdev = num(check, "minStdev") ?? 4;
				const minSentences = num(check, "minSentences") ?? 4;
				const lengths = sentences(text).map(wordCount);
				if (lengths.length >= minSentences) {
					const sd = stdev(lengths);
					if (sd < minStdev) {
						findings.push({
							severity: rule.severity,
							ruleId: rule.id,
							message: rule.description || `low sentence-length variance (${sd.toFixed(1)} < ${minStdev}) — uniform AI cadence`,
							locus: { path: subject.path, stdev: Number(sd.toFixed(2)), minStdev, sentences: lengths.length },
						});
					}
				}
				break;
			}
			default:
				// Unknown check.type → skip (forward-safe; another checker may handle it).
				break;
		}
	}
	return findings;
}

/** The quality:v1 checker over prose — the text-tells as a checker the host aggregates like any
 * other. `domain: "prose"` so a host tells it apart. Subject-generic (`{path,text}`), so a records
 * consumer renders each record to text and passes it here. */
export function createTextTellsChecker(): QualityChecker<TextQualitySubject> {
	return {
		checkerId: "quality.text-tells",
		domain: "prose",
		check: (subject, profile) => runTextTellsRules(subject, profile),
	};
}

/** Run the text-tells profile against a subject in one call (records-free). */
export function checkText(subject: TextQualitySubject, profile: QualityProfile): QualityFinding[] {
	return runTextTellsRules(subject, profile);
}

/** How AI-tell-heavy a text reads, as a legible verdict — the anti-regression signal. Lower is
 * more human. Modeled on the humanizer ai-check's tiered verdict. */
export type TextVerdict = "human" | "likely-human" | "uncertain" | "likely-ai" | "ai";

export interface TextTellsScore {
	/** Tells found per 1000 words — normalized so a long doc isn't unfairly penalized. */
	tellsPerThousandWords: number;
	/** The raw count of tells found. */
	tells: number;
	words: number;
	verdict: TextVerdict;
	/** The findings, so a caller can show WHAT to fix. */
	findings: QualityFinding[];
}

/**
 * Score a text's AI-tell density and return a tiered verdict — the one-glance anti-regression
 * signal (does this writing read as AI?). Normalizes by length (tells per 1000 words) so a long
 * document and a paragraph are judged on the same scale. Thresholds are deliberately lenient
 * (text-tells are advice): a couple of tells is "likely-human", a dense run is "ai".
 */
export function scoreTextTells(subject: TextQualitySubject, profile: QualityProfile): TextTellsScore {
	const findings = runTextTellsRules(subject, profile);
	const words = Math.max(1, wordCount(subject.text));
	const perK = (findings.length / words) * 1000;
	const verdict: TextVerdict =
		perK === 0 ? "human" : perK < 3 ? "likely-human" : perK < 8 ? "uncertain" : perK < 16 ? "likely-ai" : "ai";
	return { tellsPerThousandWords: Number(perK.toFixed(2)), tells: findings.length, words, verdict, findings };
}
