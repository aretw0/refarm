import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── D1: the reachability gate ───────────────────────────────────────────────
//
// Design: docs/superpowers/specs/2026-08-04-instruments-for-the-four-shapes-design.md
//
// For each declared field of a versioned wire contract (`packages/*-contract-v1`),
// this asks two questions of the tree: does anything SET it, and does anything
// READ it? Six defects in the budget laboratory shared one shape — a layer that
// worked in isolation and connected to nothing (`Effort.workspace_id`: declared
// on the wire, consumed by the resolver, recorded by the observation, set by
// nobody). No task review caught any of them, because each review reads its own
// diff and the defect lives in the absence of something OUTSIDE it.
//
// Three states per field, mirroring the vocabulary this repo already uses for
// auditors rather than inventing a fourth:
//   - reachable   — something sets it AND something reads it.
//   - unreachable — a consumer exists and no producer does. THE DEFECT SHAPE.
//   - unread      — a producer exists and no consumer does. Not always a
//                    defect (a field can be written for a consumer that hasn't
//                    landed yet), so it needs a declared reason or it fails.
// A field extraction can also turn up NEITHER a producer nor a consumer — that
// combination isn't literally "a consumer exists" (unreachable) or "a producer
// exists" (unread), so this gate reports it as a fourth, explicitly-labelled
// `dormant` bucket and holds it to the same declared-reason standard as
// `unread`. It is an addition on top of the design's three states, not a
// silent fourth meaning smuggled into one of them.
//
// ── Technique, following scripts/ci/check-model-defaults-drift.mjs ─────────
//
// Source scanning: read TypeScript and Rust as TEXT, strip comments first (a
// comment must never count as evidence — the exact lesson that script's own
// history records), then look for the textual SHAPE of "something sets this
// key" and "something reads this key" across packages/ and apps/.
//
// It is IMPERFECT BY CONSTRUCTION, and that must be visible in every run, not
// buried in a doc comment — see COVERAGE_LIMITS_NOTE below, printed
// unconditionally. Concretely:
//   - a field set through a dynamically built key (`obj[computed] = x`) is
//     invisible to this scan;
//   - a Rust field renamed on the wire via `#[serde(rename = "...")]` (this
//     repo has exactly this shape for `maxUsd` / `max_usd_millis` in
//     packages/tractor/src/sidecar/budget.rs) will be missed unless the
//     mechanical camelCase→snake_case guess happens to still match;
//   - a producer or consumer living outside packages/ and apps/ (examples/,
//     scripts/, docs/) is out of scope and will be missed;
//   - a short or common field name (`id`, `status`, `source`) can look
//     falsely REACHABLE through unrelated code that merely shares its shape —
//     this scan matches text, not types. That risk runs the OPPOSITE
//     direction from the others (it hides defects rather than inventing them),
//     and is exactly as real.
//
// ── Baseline, following scripts/ci/model-defaults-price-baseline.json ──────
//
// A shrinking ratchet: today's unreachable/unread/dormant fields are
// enumerated, dated, and given a reason in contract-reachability-baseline.json
// (hand-edited; no command writes it). This gate is red if a NEW
// non-reachable field is not in the baseline (growth), red if a baselined
// entry has since become reachable and was not deleted (undeleted progress),
// and red if a baselined entry's state no longer matches reality — including
// the field having been renamed or removed (stale cover). It is green only
// while the non-reachable set is fully, currently, accounted for.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const packagesDir = resolve(rootDir, "packages");
const appsDir = resolve(rootDir, "apps");
const baselinePath = resolve(rootDir, "scripts/ci/contract-reachability-baseline.json");

export const VALID_STATES = new Set(["unreachable", "unread", "dormant"]);

export const COVERAGE_LIMITS_NOTE =
	"This gate finds producers and consumers by scanning field names as text across packages/ and " +
	"apps/ (TypeScript and Rust) after stripping comments and blanking type/interface/struct/enum " +
	"declaration bodies; it is imperfect by construction — a field set through a dynamically built " +
	'key, a Rust field renamed via #[serde(rename = "...")], or a producer/consumer living outside ' +
	"packages/ and apps/ will be missed, and a short or common field name can look falsely reachable " +
	"through unrelated code that merely happens to share its shape.";

// ── Comment stripping (TS + Rust share // and /* */; TS also has ' and ` strings) ──
//
// Same reasoning and same shape as check-model-defaults-drift.mjs's
// stripRustComments: a maintainer's example in a comment must never be
// mistaken for evidence. Newlines inside stripped regions are PRESERVED (as
// blank space, not removed) so the line-based field extraction below stays
// aligned with the original source.
export function stripComments(source) {
	let result = "";
	let i = 0;
	const n = source.length;
	while (i < n) {
		const two = source.slice(i, i + 2);
		if (two === "//") {
			const newline = source.indexOf("\n", i);
			const end = newline === -1 ? n : newline;
			result += " ".repeat(end - i);
			i = end;
			continue;
		}
		if (two === "/*") {
			const end = source.indexOf("*/", i + 2);
			const realEnd = end === -1 ? n : end + 2;
			for (let j = i; j < realEnd; j++) {
				result += source[j] === "\n" ? "\n" : " ";
			}
			i = realEnd;
			continue;
		}
		const ch = source[i];
		if (ch === '"' || ch === "'" || ch === "`") {
			const quote = ch;
			result += ch;
			i++;
			while (i < n && source[i] !== quote) {
				if (source[i] === "\\" && i + 1 < n) {
					result += source[i] + source[i + 1];
					i += 2;
					continue;
				}
				result += source[i];
				i++;
			}
			if (i < n) {
				result += source[i];
				i++;
			}
			continue;
		}
		result += ch;
		i++;
	}
	return result;
}

// ── Locate top-level `interface X {` / `type X = {` (TS) or `struct X {` /
// `enum X {` (Rust) blocks in an ALREADY COMMENT-STRIPPED source. Used twice,
// for two opposite purposes: on a contract package's types.ts, the block
// bodies are what gets READ (field extraction); on the whole-tree evidence
// corpus, the block bodies get BLANKED, because a field's own declaration
// (`pub workspace_id: Option<String>,`) is not evidence that anything SETS
// it — only a construction site elsewhere is.
export function findTypeLikeBlocks(strippedSource, lang) {
	const re =
		lang === "ts"
			? /\bexport\s+(interface)\s+([A-Za-z_$][\w$]*)\s*(?:<[^{]*?>)?\s*\{|\bexport\s+(type)\s+([A-Za-z_$][\w$]*)\s*(?:<[^{]*?>)?\s*=\s*\{/g
			: /\b(?:pub(?:\([^)]*\))?\s+)?(struct)\s+([A-Za-z_][\w]*)\s*(?:<[^{]*?>)?\s*\{|\b(?:pub(?:\([^)]*\))?\s+)?(enum)\s+([A-Za-z_][\w]*)\s*(?:<[^{]*?>)?\s*\{/g;
	const blocks = [];
	let m;
	while ((m = re.exec(strippedSource))) {
		const kind = m[1] || m[3];
		const name = m[2] || m[4];
		const braceStart = re.lastIndex - 1;
		const bodyStart = braceStart + 1;
		let depth = 1;
		let j = bodyStart;
		while (j < strippedSource.length && depth > 0) {
			const ch = strippedSource[j];
			if (ch === "{") depth++;
			else if (ch === "}") depth--;
			j++;
		}
		const bodyEnd = j - 1;
		blocks.push({ kind, name, bodyStart, bodyEnd });
		re.lastIndex = j;
	}
	return blocks;
}

// ── Field extraction, TOP-LEVEL members only (depth 1 of the block). A
// nested inline shape (`workspace?: { ceiling?: X }`) contributes `workspace`
// but not `ceiling` — start narrow, and this comment says so. Method
// signatures (`foo(): void`) and index signatures (`[key: string]: unknown`)
// are skipped: they are not named data fields a value gets assigned to.
export function extractFieldsFromBlock(strippedSource, block, lang) {
	const body = strippedSource.slice(block.bodyStart, block.bodyEnd);
	const lines = body.split("\n");
	const fields = [];
	let depth = 0;
	const fieldRe =
		lang === "ts"
			? /^(readonly\s+)?(\[[^\]]+\]|"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*)(\?)?\s*:\s*\S/
			: /^(pub(?:\([^)]*\))?\s+)?([A-Za-z_][\w]*)\s*:\s*\S/;
	for (const rawLine of lines) {
		if (depth === 0) {
			const line = rawLine.trim();
			if (line) {
				const fm = line.match(fieldRe);
				if (fm) {
					const nameRaw = fm[2];
					if (!nameRaw.startsWith("[")) {
						const name = nameRaw.replace(/^["']|["']$/g, "");
						const afterName = line.slice(line.indexOf(nameRaw) + nameRaw.length);
						const looksLikeMethod = /^\s*\??\s*\(/.test(afterName) || /^\s*<[^=]/.test(afterName);
						if (!looksLikeMethod) fields.push(name);
					}
				}
			}
		}
		for (const ch of rawLine) {
			if (ch === "{" || ch === "(" || ch === "[") depth++;
			else if (ch === "}" || ch === ")" || ch === "]") depth--;
		}
	}
	return [...new Set(fields)];
}

/// The declared-field surface of ONE contract package: its `src/types.ts`, if
/// present — the mechanical, auditable rule this gate scopes to for its first
/// run (see the design doc's own "start narrow and say so"). A package whose
/// wire shape lives elsewhere (`index.ts` directly, a dedicated file like
/// node-contract-v1's `normalised.ts`) contributes ZERO fields today and is
/// out of scope, not silently guessed at — `packagesWithNoTypesFile` in the
/// summary names them so this is visible, never assumed away.
export function extractContractFields(typesSource, packageName) {
	const stripped = stripComments(typesSource);
	const blocks = findTypeLikeBlocks(stripped, "ts");
	const entries = [];
	for (const block of blocks) {
		for (const fieldName of extractFieldsFromBlock(stripped, block, "ts")) {
			entries.push({
				id: `${packageName}:${block.name}.${fieldName}`,
				package: packageName,
				typeName: block.name,
				fieldName,
			});
		}
	}
	return entries;
}

/// Blank out every top-level type/interface/struct/enum declaration body in a
/// whole file (comment-stripped already), preserving newlines. What survives
/// is executable code: constructions, reads, validators, reference
/// implementations, tests — real candidate evidence, never the declaration
/// that merely names the field's existence.
export function blankDeclarationBodies(strippedSource, lang) {
	const blocks = findTypeLikeBlocks(strippedSource, lang);
	let blanked = strippedSource;
	for (const block of [...blocks].sort((a, b) => b.bodyStart - a.bodyStart)) {
		const bodyText = blanked.slice(block.bodyStart, block.bodyEnd);
		const blankedBody = bodyText.replace(/[^\n]/g, " ");
		blanked = blanked.slice(0, block.bodyStart) + blankedBody + blanked.slice(block.bodyEnd);
	}
	return blanked;
}

/// Best-effort TS camelCase → Rust snake_case guess, so `deadlineMs` also
/// matches `deadline_ms`. Best-effort ONLY: `maxUsd` really rides the wire as
/// `max_usd_millis` (a `#[serde(rename)]`, not a mechanical transform) — see
/// COVERAGE_LIMITS_NOTE. A name already snake_case (`created_after_ns`,
/// already how this repo names some TS fields directly) passes through
/// unchanged.
export function camelToSnake(name) {
	return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function escapeForRegExp(s) {
	return s.replace(/[.*+?^${}()|[\]\\@]/g, "\\$&");
}

/// Does ANYTHING in the (already blanked) evidence corpus construct this
/// field — a bare or quoted object/struct-literal key? Declarations were
/// already blanked out of the corpus, so a remaining `name:` is a
/// construction site, not a re-statement of the type.
export function hasProducerEvidence(fieldName, corpusTexts) {
	const candidates = new Set([fieldName, camelToSnake(fieldName)]);
	for (const text of corpusTexts) {
		for (const n of candidates) {
			const en = escapeForRegExp(n);
			const re = new RegExp(`(?<![.\\w$])${en}\\s*:|["']${en}["']\\s*:`);
			if (re.test(text)) return true;
		}
	}
	return false;
}

/// Does anything READ this field — dot access or bracket access on either
/// spelling (TS camelCase, Rust snake_case guess)?
export function hasConsumerEvidence(fieldName, corpusTexts) {
	const candidates = new Set([fieldName, camelToSnake(fieldName)]);
	for (const text of corpusTexts) {
		for (const n of candidates) {
			const en = escapeForRegExp(n);
			if (new RegExp(`\\.${en}\\b`).test(text)) return true;
			if (new RegExp(`\\[\\s*["']${en}["']\\s*\\]`).test(text)) return true;
		}
	}
	return false;
}

export function classifyField(fieldEntry, corpusTexts) {
	const producer = hasProducerEvidence(fieldEntry.fieldName, corpusTexts);
	const consumer = hasConsumerEvidence(fieldEntry.fieldName, corpusTexts);
	if (producer && consumer) return "reachable";
	if (consumer && !producer) return "unreachable";
	if (producer && !consumer) return "unread";
	return "dormant";
}

// ── Parse-sanity floors: a scan that finds almost nothing must scream, never
// quietly report a clean run — the exact lesson check-model-defaults-drift.mjs
// carries as MINIMUM_PLAUSIBLE_PRICED_LITERAL_COUNT. Today's real counts are
// ~23 packages with a types.ts and ~737 extracted fields; the floors below
// leave comfortable room for legitimate future edits while still catching a
// broken path (renamed `packages/` dir, a regex that stopped matching, an
// empty readdir).
export const MINIMUM_PLAUSIBLE_CONTRACT_PACKAGE_COUNT = 15;
export const MINIMUM_PLAUSIBLE_FIELD_COUNT = 400;

export function assertExtractionIsPlausible(packageCount, fieldCount) {
	if (packageCount < MINIMUM_PLAUSIBLE_CONTRACT_PACKAGE_COUNT) {
		throw new Error(
			`check-contract-reachability: only found ${packageCount} packages/*-contract-v1 package(s) with a ` +
				`src/types.ts (expected at least ${MINIMUM_PLAUSIBLE_CONTRACT_PACKAGE_COUNT}) — the parse looks ` +
				"broken (renamed packages/ directory, a moved types.ts convention, or something else this " +
				"scanner doesn't understand), not just a smaller set. A gate that matches nothing, or next to " +
				"nothing, must scream, never quietly report a clean run.",
		);
	}
	if (fieldCount < MINIMUM_PLAUSIBLE_FIELD_COUNT) {
		throw new Error(
			`check-contract-reachability: only extracted ${fieldCount} declared field(s) across those packages ` +
				`(expected at least ${MINIMUM_PLAUSIBLE_FIELD_COUNT}) — the field regex looks broken, not just a ` +
				"smaller contract surface. A gate that matches nothing, or next to nothing, must scream, never " +
				"quietly report a clean run.",
		);
	}
}

// ── Filesystem walking (real repo only — not part of the pure classification
// core, so tests exercise the pure functions above with fixtures and leave
// this to the one real-repo regression-guard test). ────────────────────────

async function listContractPackageDirs() {
	const entries = await readdir(packagesDir, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory() && e.name.endsWith("-contract-v1"))
		.map((e) => e.name)
		.sort();
}

async function readTypesSourceIfPresent(packageName) {
	const typesPath = join(packagesDir, packageName, "src", "types.ts");
	try {
		return await readFile(typesPath, "utf-8");
	} catch {
		return null;
	}
}

const EXCLUDED_PATH_SEGMENTS = ["/node_modules/", "/dist/", "/.turbo/", "/target/"];

async function walkSourceFiles(dir, out) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (EXCLUDED_PATH_SEGMENTS.some((seg) => (full + "/").includes(seg))) continue;
		if (entry.isDirectory()) {
			await walkSourceFiles(full, out);
		} else if (
			(entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) ||
			entry.name.endsWith(".tsx") ||
			entry.name.endsWith(".rs")
		) {
			out.push(full);
		}
	}
}

async function collectRealEvidenceCorpus() {
	const files = [];
	await walkSourceFiles(packagesDir, files);
	await walkSourceFiles(appsDir, files);
	const corpus = [];
	for (const file of files) {
		const lang = file.endsWith(".rs") ? "rs" : "ts";
		const raw = await readFile(file, "utf-8");
		const stripped = stripComments(raw);
		corpus.push(blankDeclarationBodies(stripped, lang));
	}
	return corpus;
}

export function parseReachabilityBaseline(baselineRaw) {
	let baseline;
	try {
		baseline = JSON.parse(baselineRaw);
	} catch (error) {
		throw new Error(
			`check-contract-reachability: ${relative(rootDir, baselinePath)} is not valid JSON — refusing to guess its contents. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!Array.isArray(baseline?.entries)) {
		throw new Error(
			`check-contract-reachability: ${relative(rootDir, baselinePath)} has no \`entries\` array — refusing to guess its contents.`,
		);
	}
	return baseline;
}

/// The ratchet, mirroring evaluatePriceBaseline in
/// check-model-defaults-drift.mjs exactly: `allStates` is EVERY extracted
/// field this run mapped to its current state (including "reachable" —
/// needed to detect undeleted progress).
export function evaluateReachabilityBaseline(baseline, allStates) {
	const regressions = [];
	for (const [id, state] of allStates) {
		if (state === "reachable") continue;
		if (!baseline.entries.some((entry) => entry.id === id)) {
			regressions.push(`${id} — ${state}, and not in the baseline`);
		}
	}

	const fixed = [];
	const stale = [];
	const malformed = [];
	const held = [];
	for (const entry of baseline.entries) {
		const id = typeof entry?.id === "string" ? entry.id : "";
		const state = typeof entry?.state === "string" ? entry.state : "";
		const date = typeof entry?.date === "string" ? entry.date : "";
		const reason = typeof entry?.reason === "string" ? entry.reason : "";
		if (!id || !date.trim() || !reason.trim()) {
			malformed.push(id || "(an entry with no id)");
			continue;
		}
		if (!VALID_STATES.has(state)) {
			malformed.push(`${id} (state "${state}" is not one of ${[...VALID_STATES].join(", ")})`);
			continue;
		}
		const currentState = allStates.get(id);
		if (currentState === undefined) {
			stale.push({ id, why: "this field no longer appears in the extracted contract fields" });
			continue;
		}
		if (currentState === "reachable") {
			fixed.push(id);
			continue;
		}
		if (currentState !== state) {
			stale.push({ id, why: `now "${currentState}", baseline says "${state}"` });
			continue;
		}
		held.push({ id, state });
	}

	return { regressions, fixed, stale, malformed, held };
}

/// The whole gate as a pure(ish) function of its inputs, same shape as
/// check-model-defaults-drift.mjs's main(): reads the real repo by default,
/// every input overridable so tests can feed fixtures and assert on the
/// RETURNED exit code without spawning a subprocess or calling
/// `process.exit` from inside a test run.
export async function main({
	contractTypesSources: contractTypesSourcesOverride,
	evidenceCorpus: evidenceCorpusOverride,
	baselineRaw: baselineRawOverride,
} = {}) {
	let contractTypesSources = contractTypesSourcesOverride;
	let packagesWithNoTypesFile = [];
	if (!contractTypesSources) {
		const packageNames = await listContractPackageDirs();
		contractTypesSources = new Map();
		for (const pkg of packageNames) {
			const source = await readTypesSourceIfPresent(pkg);
			if (source === null) {
				packagesWithNoTypesFile.push(pkg);
			} else {
				contractTypesSources.set(pkg, source);
			}
		}
	}

	const fieldEntries = [];
	for (const [packageName, source] of contractTypesSources) {
		fieldEntries.push(...extractContractFields(source, packageName));
	}

	try {
		assertExtractionIsPlausible(contractTypesSources.size, fieldEntries.length);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.log(COVERAGE_LIMITS_NOTE);
		return 1;
	}

	const evidenceCorpus = evidenceCorpusOverride ?? (await collectRealEvidenceCorpus());

	const allStates = new Map();
	const byState = { reachable: [], unreachable: [], unread: [], dormant: [] };
	for (const entry of fieldEntries) {
		const state = classifyField(entry, evidenceCorpus);
		allStates.set(entry.id, state);
		byState[state].push(entry);
	}

	let baseline;
	try {
		const baselineRaw = baselineRawOverride ?? (await readFile(baselinePath, "utf-8"));
		baseline = parseReachabilityBaseline(baselineRaw);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.log(COVERAGE_LIMITS_NOTE);
		return 1;
	}

	const { regressions, fixed, stale, malformed, held } = evaluateReachabilityBaseline(
		baseline,
		allStates,
	);
	const failed =
		regressions.length > 0 || fixed.length > 0 || stale.length > 0 || malformed.length > 0;

	if (regressions.length > 0) {
		console.error("New non-reachable contract field(s), not covered by the baseline:");
		for (const line of regressions) console.error(`  - ${line}`);
		console.error("");
		console.error(
			`Either wire a producer/consumer for the field, or add a dated entry with a reason to ` +
				`${relative(rootDir, baselinePath)}.`,
		);
		console.error("");
	}

	if (fixed.length > 0) {
		console.error(
			`Baseline entries in ${relative(rootDir, baselinePath)} that are now reachable — delete them ` +
				"(progress must be recorded, not left to rot):",
		);
		for (const id of fixed) console.error(`  - ${id}`);
		console.error("");
	}

	if (stale.length > 0) {
		console.error(
			`Baseline entries in ${relative(rootDir, baselinePath)} that no longer match reality — delete or ` +
				"correct them (stale cover is cover for nothing):",
		);
		for (const { id, why } of stale) console.error(`  - ${id}: ${why}`);
		console.error("");
	}

	if (malformed.length > 0) {
		console.error(
			`Malformed entries in ${relative(rootDir, baselinePath)} (each needs a non-empty "id", a "state" ` +
				`of ${[...VALID_STATES].join("/")}, a "date" and a "reason"):`,
		);
		for (const id of malformed) console.error(`  - ${id}`);
		console.error("");
	}

	if (packagesWithNoTypesFile.length > 0) {
		console.log(
			`Out of scope this run (no src/types.ts, so no fields extracted): ${packagesWithNoTypesFile.join(", ")}`,
		);
	}

	if (failed) {
		console.error("Sources compared:");
		console.error(
			`  - ${relative(rootDir, packagesDir)}/*-contract-v1/src/types.ts (declared fields)`,
		);
		console.error(
			`  - ${relative(rootDir, packagesDir)}/**, ${relative(rootDir, appsDir)}/** (evidence)`,
		);
		console.error(`  - ${relative(rootDir, baselinePath)}`);
		console.log(COVERAGE_LIMITS_NOTE);
		return 1;
	}

	console.log(
		`Every declared field across ${contractTypesSources.size} contract package(s) ` +
			`(${fieldEntries.length} fields) is either reachable or accounted for in the baseline. ` +
			`reachable=${byState.reachable.length} unreachable=${byState.unreachable.length} ` +
			`unread=${byState.unread.length} dormant=${byState.dormant.length}`,
	);
	if (held.length > 0) {
		console.log("Known, accepted debt (baselined, still not reachable):");
		for (const { id, state } of held) console.log(`  - ${id} [${state}]`);
	}
	console.log(COVERAGE_LIMITS_NOTE);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(await main());
}
