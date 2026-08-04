import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── D1: the reachability gate ───────────────────────────────────────────────
//
// Design: docs/superpowers/specs/2026-08-04-instruments-for-the-four-shapes-design.md
//
// For each declared field of a versioned wire contract, this asks two
// questions of the tree: does anything SET it, and does anything READ it?
// Six defects in the budget laboratory shared one shape — a layer that worked
// in isolation and connected to nothing (`Effort.workspace_id`: declared on
// the wire, consumed by the resolver, recorded by the observation, set by
// nobody). No task review caught any of them, because each review reads its
// own diff and the defect lives in the absence of something OUTSIDE it.
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
// ── The TYPE question, added after the gate's first real finding ──────────
//
// The gate's own first run caught five contract packages each declaring a
// `*TelemetryEvent` type named nowhere else in the repository — dead types,
// duplicated five ways. But it only caught them through `traceId`, the one
// distinctively-named field; the type's other fields (`pluginId`, `durationMs`,
// `ok`) were common enough to match unrelated code and read as accidentally
// reachable. Then one capability's telemetry got wired for real: a single,
// genuine `.traceId` read/write pair made ALL FIVE `*TelemetryEvent.traceId`
// fields read as reachable, including the four still genuinely unwired — this
// gate matches FIELD NAMES AS TEXT, not types, so once anything anywhere
// writes `traceId:` and reads `.traceId`, every field literally named
// `traceId` on every type reads as produced-and-consumed regardless of which
// type it actually belongs to. The finding was never "the field `traceId` is
// unused" — it was "the TYPE `EnrichmentTelemetryEvent` is named nowhere."
//
// So a FIFTH bucket, `unnamed`, asks a different, prior question about the
// TYPE itself, not any one of its fields: does this type's NAME appear
// anywhere outside its own declaration? A type nobody names is dead
// regardless of how common its field names are, and a `traceId` somewhere
// else can never resurrect it. When a type is unnamed, its fields are
// trivially non-reachable too (nothing can construct or destructure a value
// of a type nobody references), so this gate reports ONE `unnamed` finding
// for the type and skips separate field-level entries for it entirely — never
// one finding per field of one dead type. Only when a type IS named elsewhere
// does the field-level producer/consumer question above even get asked of its
// fields.
//
// ── Scope: wire contracts by NATURE, not by directory ──────────────────────
//
// The declared surface is the contract packages' `src/types.ts` (TypeScript
// wire shapes by convention), PLUS every Rust struct/enum under
// `packages/tractor/src/` that derives `Serialize` or `Deserialize` — a wire
// shape by definition, that is what the derive means, wherever in the crate it
// lives. This is exactly the design's own motivating example:
// `Effort.workspace_id` lives on `packages/tractor/src/sidecar/mod.rs`'s
// `struct Effort`, not in a contract package, and a gate scoped only to
// `packages/*-contract-v1` would never have been able to see it. This does
// NOT widen to "every public type in every package" — that would be
// unmanageable; it widens to the one other place this repo declares wire
// shapes by a mechanical, checkable rule (the derive), not by guessing.
//
// ── Technique, following scripts/ci/check-model-defaults-drift.mjs ─────────
//
// Source scanning: read TypeScript and Rust as TEXT, strip comments first (a
// comment must never count as evidence — the exact lesson that script's own
// history records), then look for the textual SHAPE of "something sets this
// key", "something reads this key", and "something names this type" across
// packages/ and apps/.
//
// It is IMPERFECT BY CONSTRUCTION, and that must be visible in every run, not
// buried in a doc comment — see COVERAGE_LIMITS_NOTE below, printed
// unconditionally. Concretely:
//   - a field set through a dynamically built key (`obj[computed] = x`) is
//     invisible to this scan;
//   - a Rust field renamed on the wire via `#[serde(rename = "...")]` to
//     something a MECHANICAL case transform would not produce is missed even
//     though the transform now runs both ways (camelCase→snake_case AND
//     snake_case→camelCase, needed once declared fields can originate as Rust
//     identifiers, not only TS ones). `maxUsd` / `max_usd_millis` in
//     packages/tractor/src/sidecar/budget.rs is exactly this shape, and so is
//     `tailscale_ips` / `"TailscaleIPs"` and `myself` / `"Self"` in
//     packages/tractor/src/sidecar/tailnet_resolve.rs — the wire names there
//     are the Tailscale CLI's own JSON, not this repo's naming convention, so
//     no mechanical guess in either direction finds them;
//   - a producer or consumer living outside packages/ and apps/ (examples/,
//     scripts/, docs/) is out of scope and will be missed;
//   - a short or common field name (`id`, `status`, `source`) can look
//     falsely REACHABLE through unrelated code that merely shares its shape —
//     this scan matches text, not types. That risk runs the OPPOSITE
//     direction from the others (it hides defects rather than inventing them),
//     and is exactly as real;
//   - a Rust struct/enum that is a wire shape in fact but is never annotated
//     with `#[derive(Serialize)]` / `#[derive(Deserialize)]` (constructed by
//     hand into a `serde_json::Value`, say) is invisible to the widened scope
//     — the derive is a mechanical, checkable proxy for "this crosses the
//     wire," not a proof, and this gate trusts it rather than guessing harder;
//   - the same short-or-common-name risk above applies to TYPE names too: a
//     generically-named type (`Config`, `Options`) could in principle share
//     text with an unrelated identifier elsewhere and read as falsely NAMED —
//     this scan matches identifier text, not type-checked references.
//
// ── Baseline, following scripts/ci/model-defaults-price-baseline.json ──────
//
// A shrinking ratchet: today's unreachable/unread/dormant/unnamed fields and
// types are enumerated, dated, and given a reason in
// contract-reachability-baseline.json (hand-edited; no command writes it).
// This gate is red if a NEW non-reachable field or type is not in the
// baseline (growth), red if a baselined entry has since become reachable and
// was not deleted (undeleted progress), and red if a baselined entry's state
// no longer matches reality — including the field or type having been renamed
// or removed (stale cover). It is green only while the non-reachable set is
// fully, currently, accounted for.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const packagesDir = resolve(rootDir, "packages");
const appsDir = resolve(rootDir, "apps");
const baselinePath = resolve(rootDir, "scripts/ci/contract-reachability-baseline.json");

export const VALID_STATES = new Set(["unreachable", "unread", "dormant", "unnamed"]);

export const COVERAGE_LIMITS_NOTE =
	"This gate finds producers, consumers, and type-name usages by scanning identifiers as text " +
	"across packages/ and apps/ (TypeScript and Rust) after stripping comments and blanking " +
	"declaration bodies (fields) or declaration name tokens (types); declared fields come from " +
	"packages/*-contract-v1/src/types.ts AND every Rust struct/enum under packages/tractor/src/ that " +
	"derives Serialize or Deserialize. It is imperfect by construction — a field set through a " +
	'dynamically built key, a Rust field renamed via #[serde(rename = "...")] to something neither ' +
	"the camelCase→snake_case nor the snake_case→camelCase mechanical guess produces (Tailscale's own " +
	'"TailscaleIPs"/"Self" JSON field names, e.g.), a producer/consumer/type-usage living outside ' +
	"packages/ and apps/, or a Rust wire struct/enum that is never annotated with " +
	"#[derive(Serialize)]/#[derive(Deserialize)] will be missed, and a short or common field or type " +
	"name can look falsely reachable/named through unrelated code that merely happens to share its text.";

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
	// The `d` flag (regex match indices, Node 16+) gives the exact [start, end)
	// span of each capture group — used below to isolate the type NAME's own
	// token position (`nameStart`/`nameEnd`), separate from `declStart` (the
	// whole declaration, including any `export`/`pub` prefix). Two different
	// blanking passes need two different spans: one blanks only the name so a
	// type's OWN declaration line stops counting as evidence that its name is
	// used elsewhere; the other blanks the whole body so a field's own
	// declaration stops counting as evidence that something sets it.
	const re =
		lang === "ts"
			? /\bexport\s+(interface)\s+([A-Za-z_$][\w$]*)\s*(?:<[^{]*?>)?\s*\{|\bexport\s+(type)\s+([A-Za-z_$][\w$]*)\s*(?:<[^{]*?>)?\s*=\s*\{/gd
			: /\b(?:pub(?:\([^)]*\))?\s+)?(struct)\s+([A-Za-z_][\w]*)\s*(?:<[^{]*?>)?\s*\{|\b(?:pub(?:\([^)]*\))?\s+)?(enum)\s+([A-Za-z_][\w]*)\s*(?:<[^{]*?>)?\s*\{/gd;
	const blocks = [];
	let m;
	while ((m = re.exec(strippedSource))) {
		const kind = m[1] || m[3];
		const name = m[2] || m[4];
		const nameSpan = m.indices[2] || m.indices[4];
		const declStart = m.index;
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
		blocks.push({
			kind,
			name,
			declStart,
			nameStart: nameSpan[0],
			nameEnd: nameSpan[1],
			bodyStart,
			bodyEnd,
		});
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

/// The declared TYPE surface of one already-comment-stripped source: every
/// top-level type/interface/struct/enum block, each carrying its own field
/// list. Shared by the TS contract-package path and the Rust tractor-wire
/// path below — one parse, two callers, so the two never drift into scanning
/// declarations differently by accident.
export function extractTypeGroups(strippedSource, packageLabel, lang) {
	const blocks = findTypeLikeBlocks(strippedSource, lang);
	return blocks.map((block) => ({
		id: `${packageLabel}:${block.name}`,
		package: packageLabel,
		typeName: block.name,
		fields: extractFieldsFromBlock(strippedSource, block, lang).map((fieldName) => ({
			id: `${packageLabel}:${block.name}.${fieldName}`,
			fieldName,
		})),
	}));
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
	const entries = [];
	for (const group of extractTypeGroups(stripped, packageName, "ts")) {
		for (const field of group.fields) {
			entries.push({
				id: field.id,
				package: group.package,
				typeName: group.typeName,
				fieldName: field.fieldName,
			});
		}
	}
	return entries;
}

// ── Rust wire structs OUTSIDE contract packages ─────────────────────────────
//
// packages/tractor/src/ declares wire shapes too (`Effort`, `EffortTask`,
// `TaskResult`, ...) that never lived in a `*-contract-v1` package — the
// design's own motivating example, `Effort.workspace_id`, is one. A Rust
// struct or enum is a wire shape BY DEFINITION when it derives `Serialize` or
// `Deserialize`; that derive is the mechanical, checkable rule this widens on
// (see the module doc comment's "Scope" section) — not "every public type."

/// Does the (already comment-stripped) source have a `#[derive(...)]`
/// attribute containing `Serialize` or `Deserialize` directly above the given
/// declaration line index, allowing other attribute lines (`#[serde(...)]`,
/// `#[allow(...)]`) and blank lines (including comment lines, already blanked
/// to whitespace by stripComments) in between, stopping at the first line that
/// is neither? That stop-line is the previous item's own body or code — past
/// it, an attribute belongs to something else, not this declaration.
export function hasSerdeDerive(attributeLinesText) {
	return /derive\s*\([^)]*\b(?:Serialize|Deserialize)\b/.test(attributeLinesText);
}

function collectPrecedingAttributeLines(lines, declLineIndex) {
	let collected = "";
	for (let i = declLineIndex - 1; i >= 0; i--) {
		const trimmed = lines[i].trim();
		if (trimmed === "") continue;
		if (/^#\[/.test(trimmed)) {
			collected = lines[i] + "\n" + collected;
			continue;
		}
		break;
	}
	return collected;
}

/// The declared TYPE surface of one Rust source file, scoped to ONLY the
/// struct/enum blocks whose immediately-preceding attribute stack contains a
/// `#[derive(Serialize)]` or `#[derive(Deserialize)]` — everything else in the
/// file (helper types, internal-only structs with no derive) is out of scope,
/// not silently guessed at, mirroring extractContractFields's own
/// out-of-scope discipline for TS.
export function extractSerdeDerivedRustTypeGroups(rustSource, packageLabel = "tractor") {
	const stripped = stripComments(rustSource);
	const lines = stripped.split("\n");
	const lineOffsets = [];
	let acc = 0;
	for (const line of lines) {
		lineOffsets.push(acc);
		acc += line.length + 1;
	}
	const blocks = findTypeLikeBlocks(stripped, "rs");
	const groups = [];
	for (const block of blocks) {
		let lo = 0;
		let hi = lineOffsets.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineOffsets[mid] <= block.declStart) lo = mid;
			else hi = mid - 1;
		}
		const attrText = collectPrecedingAttributeLines(lines, lo);
		if (!hasSerdeDerive(attrText)) continue;
		groups.push({
			id: `${packageLabel}:${block.name}`,
			package: packageLabel,
			typeName: block.name,
			fields: extractFieldsFromBlock(stripped, block, "rs").map((fieldName) => ({
				id: `${packageLabel}:${block.name}.${fieldName}`,
				fieldName,
			})),
		});
	}
	return groups;
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

/// Blank ONLY the type NAME token at each top-level type/interface/struct/enum
/// declaration's own signature (`export interface Widget {` → `export interface
/// {`), leaving everything else — including the declaration's field bodies, and
/// crucially any OTHER declaration elsewhere that legitimately references this
/// type by name (`event: EnrichmentTelemetryEvent` inside a different
/// interface, an import, a generic parameter, a construction site) — untouched.
/// This is the type-level analogue of blankDeclarationBodies, and answers a
/// different question: not "is this field's declaration evidence that
/// something sets it" but "is this type's OWN signature evidence that its name
/// is used" — it must never be, or every type would trivially name itself.
export function blankTypeNameSelfReferences(strippedSource, lang) {
	const blocks = findTypeLikeBlocks(strippedSource, lang);
	let blanked = strippedSource;
	for (const block of [...blocks].sort((a, b) => b.nameStart - a.nameStart)) {
		const blankedName = " ".repeat(block.nameEnd - block.nameStart);
		blanked = blanked.slice(0, block.nameStart) + blankedName + blanked.slice(block.nameEnd);
	}
	return blanked;
}

/// Does the type's NAME appear anywhere in the (name-self-reference-blanked)
/// corpus, as a whole word? This is the type-level question the field-level
/// scan cannot ask: "traceId somewhere else" can make five unrelated types'
/// `traceId` field all read as produced-and-consumed, but it can never make
/// `EnrichmentTelemetryEvent` (or `SourceTelemetryEvent`, or...) appear as
/// text unless something actually names that specific type — an import, a
/// type annotation, a construction, a generic parameter.
export function hasTypeNameEvidence(typeName, corpusTexts) {
	const re = new RegExp(`\\b${escapeForRegExp(typeName)}\\b`);
	return corpusTexts.some((text) => re.test(text));
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

/// The MIRROR guess, snake_case → camelCase (`scoped_credentials` →
/// `scopedCredentials`), needed once declared fields can come from Rust
/// structs directly rather than only from a TS contract's camelCase names.
/// Before the widening to packages/tractor/src/, camelToSnake alone was
/// enough: every declared field started life as TS camelCase, and the only
/// question was whether the Rust SIDE also used it. Now a field can start
/// life as a Rust identifier (`provides_api`, `scoped_credentials`,
/// `plugin_ids` — all genuinely wired, all missed without this guess, because
/// their real producers are TS object literals spelled `providesApi:` /
/// `scopedCredentials:` / `pluginIds:`), so the guess needs to run both ways.
/// Best-effort ONLY, same as camelToSnake: `TailscaleIPs` / `Self` (Tailscale
/// CLI JSON field names, `#[serde(rename = "...")]`) are not a mechanical
/// transform of `tailscale_ips` / `myself` and this guess will not find them
/// — see COVERAGE_LIMITS_NOTE.
export function snakeToCamel(name) {
	return name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function escapeForRegExp(s) {
	return s.replace(/[.*+?^${}()|[\]\\@]/g, "\\$&");
}

function nameCandidates(fieldName) {
	return new Set([fieldName, camelToSnake(fieldName), snakeToCamel(fieldName)]);
}

/// Does ANYTHING in the (already blanked) evidence corpus construct this
/// field — a bare or quoted object/struct-literal key? Declarations were
/// already blanked out of the corpus, so a remaining `name:` is a
/// construction site, not a re-statement of the type.
export function hasProducerEvidence(fieldName, corpusTexts) {
	const candidates = nameCandidates(fieldName);
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
/// spelling (TS camelCase, Rust snake_case, and now the reverse guess)?
export function hasConsumerEvidence(fieldName, corpusTexts) {
	const candidates = nameCandidates(fieldName);
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

// The Rust-wire-struct analogue, sized off the real repo's own count (40
// serde-deriving struct/enum blocks under packages/tractor/src/, 138 fields
// across them at the time this floor was set) with the same comfortable-room
// ratio the two floors above use.
export const MINIMUM_PLAUSIBLE_TRACTOR_WIRE_TYPE_COUNT = 25;
export const MINIMUM_PLAUSIBLE_TRACTOR_WIRE_FIELD_COUNT = 80;

export function assertTractorExtractionIsPlausible(typeCount, fieldCount) {
	if (typeCount < MINIMUM_PLAUSIBLE_TRACTOR_WIRE_TYPE_COUNT) {
		throw new Error(
			`check-contract-reachability: only found ${typeCount} #[derive(Serialize)]/#[derive(Deserialize)] ` +
				`struct/enum(s) under packages/tractor/src/ (expected at least ` +
				`${MINIMUM_PLAUSIBLE_TRACTOR_WIRE_TYPE_COUNT}) — the parse looks broken (renamed src/ directory, a ` +
				"derive-attribute convention this scanner doesn't understand), not just a smaller wire surface. " +
				"A gate that matches nothing, or next to nothing, must scream, never quietly report a clean run.",
		);
	}
	if (fieldCount < MINIMUM_PLAUSIBLE_TRACTOR_WIRE_FIELD_COUNT) {
		throw new Error(
			`check-contract-reachability: only extracted ${fieldCount} declared field(s) across those Rust wire ` +
				`struct/enum(s) (expected at least ${MINIMUM_PLAUSIBLE_TRACTOR_WIRE_FIELD_COUNT}) — the field ` +
				"regex looks broken, not just a smaller wire surface. A gate that matches nothing, or next to " +
				"nothing, must scream, never quietly report a clean run.",
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

async function walkSourceFiles(dir, out, extensions) {
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
			await walkSourceFiles(full, out, extensions);
		} else if (extensions.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith(".d.ts")) {
			out.push(full);
		}
	}
}

const EVIDENCE_EXTENSIONS = [".ts", ".tsx", ".rs"];

async function collectRealEvidenceCorpora() {
	const files = [];
	await walkSourceFiles(packagesDir, files, EVIDENCE_EXTENSIONS);
	await walkSourceFiles(appsDir, files, EVIDENCE_EXTENSIONS);
	const fieldsCorpus = [];
	const typesCorpus = [];
	for (const file of files) {
		const lang = file.endsWith(".rs") ? "rs" : "ts";
		const raw = await readFile(file, "utf-8");
		const stripped = stripComments(raw);
		fieldsCorpus.push(blankDeclarationBodies(stripped, lang));
		typesCorpus.push(blankTypeNameSelfReferences(stripped, lang));
	}
	return { fieldsCorpus, typesCorpus };
}

const tractorSrcDir = resolve(packagesDir, "tractor", "src");

/// Every `.rs` file under packages/tractor/src/, keyed by its path relative to
/// that directory — the declared-surface source for the widened scope,
/// mirroring readTypesSourceIfPresent's role for the TS contract path.
async function readTractorRustSources() {
	const files = [];
	await walkSourceFiles(tractorSrcDir, files, [".rs"]);
	const sources = new Map();
	for (const file of files) {
		sources.set(relative(tractorSrcDir, file), await readFile(file, "utf-8"));
	}
	return sources;
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
			stale.push({
				id,
				why:
					"this id no longer appears in the extracted contract surface — a field or type was renamed " +
					"or removed, or (for a type id) the type is now named elsewhere and its fields are reported " +
					"individually instead",
			});
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
/// `process.exit` from inside a test run. `tractorRustSources` mirrors
/// `contractTypesSources`'s role for the widened Rust-wire-struct scope —
/// when a test overrides ONE declared-surface source, it must own BOTH (an
/// omitted `tractorRustSources` still falls back to the real filesystem,
/// which would silently mix real-repo Rust findings into a fixture test).
export async function main({
	contractTypesSources: contractTypesSourcesOverride,
	tractorRustSources: tractorRustSourcesOverride,
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

	const contractTypeGroups = [];
	for (const [packageName, source] of contractTypesSources) {
		contractTypeGroups.push(...extractTypeGroups(stripComments(source), packageName, "ts"));
	}
	const contractFieldCount = contractTypeGroups.reduce((sum, g) => sum + g.fields.length, 0);

	try {
		assertExtractionIsPlausible(contractTypesSources.size, contractFieldCount);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.log(COVERAGE_LIMITS_NOTE);
		return 1;
	}

	let tractorRustSources = tractorRustSourcesOverride;
	if (!tractorRustSources) tractorRustSources = await readTractorRustSources();

	const tractorTypeGroups = [];
	for (const source of tractorRustSources.values()) {
		tractorTypeGroups.push(...extractSerdeDerivedRustTypeGroups(source, "tractor"));
	}
	const tractorFieldCount = tractorTypeGroups.reduce((sum, g) => sum + g.fields.length, 0);

	try {
		assertTractorExtractionIsPlausible(tractorTypeGroups.length, tractorFieldCount);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.log(COVERAGE_LIMITS_NOTE);
		return 1;
	}

	const allTypeGroups = [...contractTypeGroups, ...tractorTypeGroups];

	const { fieldsCorpus, typesCorpus } =
		evidenceCorpusOverride !== undefined
			? { fieldsCorpus: evidenceCorpusOverride, typesCorpus: evidenceCorpusOverride }
			: await collectRealEvidenceCorpora();

	// Type first, fields only if the type is named: see the module doc
	// comment's "The TYPE question" section. An unnamed type contributes ONE
	// entry (itself); its fields are never classified individually, so one
	// dead type never becomes N baseline lines.
	const allStates = new Map();
	const byState = { reachable: [], unreachable: [], unread: [], dormant: [], unnamed: [] };
	for (const group of allTypeGroups) {
		if (!hasTypeNameEvidence(group.typeName, typesCorpus)) {
			allStates.set(group.id, "unnamed");
			byState.unnamed.push(group);
			continue;
		}
		for (const field of group.fields) {
			const state = classifyField(field, fieldsCorpus);
			allStates.set(field.id, state);
			byState[state].push(field);
		}
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
		console.error("New non-reachable/unnamed contract type(s) or field(s), not covered by the baseline:");
		for (const line of regressions) console.error(`  - ${line}`);
		console.error("");
		console.error(
			`Either wire a producer/consumer for the field (or a reference to the type's name), or add a ` +
				`dated entry with a reason to ${relative(rootDir, baselinePath)}.`,
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
			`  - ${relative(rootDir, packagesDir)}/*-contract-v1/src/types.ts (declared types/fields)`,
		);
		console.error(
			`  - ${relative(rootDir, packagesDir)}/tractor/src/**/*.rs, #[derive(Serialize)]/` +
				"#[derive(Deserialize)] struct/enum blocks (declared types/fields)",
		);
		console.error(
			`  - ${relative(rootDir, packagesDir)}/**, ${relative(rootDir, appsDir)}/** (evidence)`,
		);
		console.error(`  - ${relative(rootDir, baselinePath)}`);
		console.log(COVERAGE_LIMITS_NOTE);
		return 1;
	}

	console.log(
		`Every declared type/field across ${contractTypesSources.size} contract package(s) ` +
			`(${contractFieldCount} fields) and ${tractorTypeGroups.length} tractor wire struct/enum(s) ` +
			`(${tractorFieldCount} fields) is either reachable/named or accounted for in the baseline. ` +
			`reachable=${byState.reachable.length} unreachable=${byState.unreachable.length} ` +
			`unread=${byState.unread.length} dormant=${byState.dormant.length} unnamed=${byState.unnamed.length}`,
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
