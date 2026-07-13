import type { QualityChecker, QualityFinding, QualityProfile } from "./types.js";

/**
 * The NOTE gates — the generic hygiene checks any note-box governs its corpus with, as a
 * quality:v1 checker over a note (frontmatter + body). These are the delta two note-boxes
 * proved they need (required metadata, enough content, well-formed links) beyond the plain
 * regex checker. matcher-is-data: each rule's `check.type` selects a matcher; unknown types
 * are skipped (forward-safe), so richer gates ship as checker code + rule data.
 *
 * The matchers (check.type):
 *   frontmatter-required — a required frontmatter FIELD is present and non-empty.
 *   min-words            — the body has at least `min` words (a stub note is flagged).
 *   wikilink-shape       — every `[[…]]` is well-formed (no empty/unclosed link target).
 */

/** What a note gate inspects: the note's path (for the locus) + its full text (frontmatter
 * + body). Structural, so a caller passes a record-derived note or a raw one. */
export interface NoteQualitySubject {
	path: string;
	text: string;
}

/** Split a note's text into its frontmatter object + body. A tiny reader (leading `---`
 * block, one `key: value` per line) — enough for the required-field gate; not a full YAML
 * parser. PURE. */
function readNote(text: string): { frontmatter: Record<string, string>; body: string } {
	const frontmatter: Record<string, string> = {};
	if (!text.startsWith("---")) return { frontmatter, body: text };
	const end = text.indexOf("\n---", 3);
	if (end < 0) return { frontmatter, body: text };
	const block = text.slice(3, end);
	for (const line of block.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colon = trimmed.indexOf(":");
		if (colon < 0) continue;
		const key = trimmed.slice(0, colon).trim();
		const value = trimmed.slice(colon + 1).trim();
		if (key) frontmatter[key] = value;
	}
	const body = text.slice(end + 4);
	return { frontmatter, body };
}

function str(check: Record<string, unknown>, key: string): string | undefined {
	const v = check[key];
	return typeof v === "string" ? v : undefined;
}
function num(check: Record<string, unknown>, key: string): number | undefined {
	const v = check[key];
	return typeof v === "number" ? v : undefined;
}

/** Run the note gates in `profile` against one note. PURE. */
export function runNoteQualityRules(subject: NoteQualitySubject, profile: QualityProfile): QualityFinding[] {
	const findings: QualityFinding[] = [];
	const { frontmatter, body } = readNote(subject.text);
	for (const rule of profile.rules) {
		const check = rule.check;
		switch (check.type) {
			case "frontmatter-required": {
				const field = str(check, "field");
				if (!field) break;
				const value = frontmatter[field];
				if (!value || value.length === 0) {
					findings.push({
						severity: rule.severity,
						ruleId: rule.id,
						message: rule.description || `missing required frontmatter: ${field}`,
						locus: { path: subject.path, field },
					});
				}
				break;
			}
			case "min-words": {
				const min = num(check, "min") ?? 0;
				const words = body.trim().split(/\s+/).filter(Boolean).length;
				if (words < min) {
					findings.push({
						severity: rule.severity,
						ruleId: rule.id,
						message: rule.description || `too few words: ${words} < ${min}`,
						locus: { path: subject.path, words, min },
					});
				}
				break;
			}
			case "wikilink-shape": {
				// Flag an empty/whitespace-only wikilink target: `[[ ]]` or `[[]]`.
				const bad = [...subject.text.matchAll(/\[\[([^\]]*)\]\]/g)].filter(
					(m) => (m[1] ?? "").trim().length === 0,
				);
				for (const m of bad) {
					findings.push({
						severity: rule.severity,
						ruleId: rule.id,
						message: rule.description || "empty wikilink target",
						locus: { path: subject.path, index: m.index ?? 0 },
					});
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

/** A quality:v1 checker over notes — the note-box gates as a checker the host aggregates
 * like any other. `domain: "note"` so a host can tell it apart. Records-free by design
 * (subject is a `{path,text}`), so this contract stays dependency-light and subject-generic;
 * a records consumer renders each record to `{path,text}` (vault-contract's `recordToVaultNote`)
 * and passes it here. */
export function createNoteQualityChecker(
	options: { checkerId?: string } = {},
): QualityChecker<NoteQualitySubject> {
	return {
		checkerId: options.checkerId ?? "sovereign.reference-note-quality",
		domain: "note",
		check: (subject, profile) => runNoteQualityRules(subject, profile),
	};
}

/** One finding tied back to the note it came from. */
export interface KeyedNoteFinding extends QualityFinding {
	subjectPath: string;
}

/**
 * Check a set of notes against gates in ONE call: run the checker over each and return the
 * findings keyed back to their note path. Async so a sync reference checker OR a sovereign
 * WASM checker both work unchanged. The DX twin of organizeRecords: the plumbing lives here;
 * the consumer brings notes + a gate profile (data) and gets findings. Records-free — a
 * records caller maps records → `{path,text}` first (records stays out of this contract).
 */
export async function checkNotes(
	checker: QualityChecker<NoteQualitySubject>,
	notes: readonly NoteQualitySubject[],
	profile: QualityProfile,
): Promise<KeyedNoteFinding[]> {
	const out: KeyedNoteFinding[] = [];
	for (const note of notes) {
		const findings = await checker.check(note, profile);
		for (const finding of findings) out.push({ ...finding, subjectPath: note.path });
	}
	return out;
}
