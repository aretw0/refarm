import assert from "node:assert/strict";
import test from "node:test";

import {
	MINIMUM_PLAUSIBLE_CONTRACT_PACKAGE_COUNT,
	MINIMUM_PLAUSIBLE_FIELD_COUNT,
	MINIMUM_PLAUSIBLE_TRACTOR_WIRE_FIELD_COUNT,
	MINIMUM_PLAUSIBLE_TRACTOR_WIRE_TYPE_COUNT,
	assertExtractionIsPlausible,
	assertTractorExtractionIsPlausible,
	blankDeclarationBodies,
	blankTypeNameSelfReferences,
	camelToSnake,
	classifyField,
	evaluateReachabilityBaseline,
	extractContractFields,
	extractSerdeDerivedRustTypeGroups,
	extractTypeGroups,
	hasConsumerEvidence,
	hasProducerEvidence,
	hasSerdeDerive,
	hasTypeNameEvidence,
	main,
	parseReachabilityBaseline,
	snakeToCamel,
	stripComments,
} from "./check-contract-reachability.mjs";

// ── Comment stripping: a comment must never count as evidence ──────────────

test("stripComments removes // and block comments but leaves string contents alone", () => {
	const source = [
		'foo: "kept-1", // bar: "from-line-comment"',
		'/* baz: "from-block-comment" */ qux: "kept-2"',
		'let url = "https://example.com/not-a-comment"; // trailing',
	].join("\n");
	const stripped = stripComments(source);
	assert.ok(stripped.includes('foo: "kept-1"'));
	assert.ok(stripped.includes('qux: "kept-2"'));
	assert.ok(!stripped.includes("from-line-comment"));
	assert.ok(!stripped.includes("from-block-comment"));
	assert.ok(stripped.includes("https://example.com/not-a-comment"));
});

test("stripComments preserves newlines inside a multi-line block comment (line alignment for the block extractor)", () => {
	const source = "a\n/* line1\nline2\nline3 */\nb";
	const stripped = stripComments(source);
	assert.equal(stripped.split("\n").length, source.split("\n").length);
});

// ── Field extraction: a producer's example in a comment must not become a declared field ──

test("extractContractFields ignores a field name that only appears inside a comment", () => {
	const source = `
export interface Widget {
	// example: color: string;
	id: string;
}
`;
	const entries = extractContractFields(source, "widget-contract-v1");
	const names = entries.map((e) => e.fieldName);
	assert.deepEqual(names, ["id"]);
});

test("extractContractFields covers both `interface X {}` and `type X = {}` object shapes", () => {
	const source = `
export interface Alpha {
	a: string;
}
export type Beta = {
	b: number;
};
export type NotAnObject = string | number;
`;
	const entries = extractContractFields(source, "pkg");
	assert.deepEqual(entries.map((e) => e.id).sort(), ["pkg:Alpha.a", "pkg:Beta.b"]);
});

test("extractContractFields keeps only TOP-LEVEL members, not fields nested inside an inline object type", () => {
	const source = `
export type Outer = {
	top: string;
	nested?: { inner: number };
};
`;
	const entries = extractContractFields(source, "pkg");
	const names = entries.map((e) => e.fieldName);
	assert.ok(names.includes("top"));
	assert.ok(names.includes("nested"));
	assert.ok(
		!names.includes("inner"),
		"a field nested inside an inline object type must not be extracted",
	);
});

test("extractContractFields skips method signatures and index signatures, keeping only named data fields", () => {
	const source = `
export interface Handler {
	id: string;
	[key: string]: unknown;
	doSomething(x: number): void;
	optionalMethod?(): Promise<void>;
}
`;
	const entries = extractContractFields(source, "pkg");
	const names = entries.map((e) => e.fieldName);
	assert.deepEqual(names, ["id"]);
});

test('extractContractFields handles quoted JSON-LD-style keys like "@type"', () => {
	const source = `
export interface Node {
	"@type": string;
	"@id": string;
	title?: string;
}
`;
	const entries = extractContractFields(source, "pkg");
	assert.deepEqual(entries.map((e) => e.fieldName).sort(), ["@id", "@type", "title"]);
});

// ── Declaration bodies must be blanked out of the evidence corpus, not counted as producers ──

test("blankDeclarationBodies removes an interface's own field declarations from the evidence corpus", () => {
	const source = stripComments(`
export interface Effort {
	workspaceId?: string;
}
function build() {
	return { workspaceId: "refarm" };
}
`);
	const blanked = blankDeclarationBodies(source, "ts");
	assert.ok(!blanked.includes("workspaceId?: string"));
	assert.ok(blanked.includes('workspaceId: "refarm"'), "code outside the declaration must survive");
});

test("blankDeclarationBodies removes a Rust struct's own field declarations", () => {
	const source = stripComments(`
pub struct Effort {
    pub workspace_id: Option<String>,
}
fn build() -> Effort {
    Effort { workspace_id: None }
}
`);
	const blanked = blankDeclarationBodies(source, "rs");
	assert.ok(!blanked.includes("pub workspace_id: Option<String>"));
	assert.ok(
		blanked.includes("workspace_id: None"),
		"code outside the struct declaration must survive",
	);
});

// ── Reachability classification: the core question, "does anything set it, and does anything read it?" ──

test("classifyField: reachable when the corpus has both a producer and a consumer", () => {
	const corpus = ["const x = { deadlineMs: 5000 };", "console.log(x.deadlineMs);"];
	assert.equal(classifyField({ fieldName: "deadlineMs" }, corpus), "reachable");
});

test("classifyField: unreachable is THE DEFECT SHAPE — a consumer with no producer (Effort.workspace_id before the fix)", () => {
	const corpus = ["console.log(effort.workspaceId);"];
	assert.equal(classifyField({ fieldName: "workspaceId" }, corpus), "unreachable");
});

test("classifyField: unread when something sets it but nothing reads it back", () => {
	const corpus = ["const x = { score: 1 };"];
	assert.equal(classifyField({ fieldName: "score" }, corpus), "unread");
});

test("classifyField: dormant when neither a producer nor a consumer is found", () => {
	assert.equal(
		classifyField({ fieldName: "neverMentionedAnywhere" }, ["irrelevant code"]),
		"dormant",
	);
});

test('hasProducerEvidence matches a quoted JSON-LD key like "@context" as a construction site, not just its bare form', () => {
	const corpus = ['const node = { "@context": "https://schema.org/" };'];
	assert.ok(hasProducerEvidence("@context", corpus));
});

test("hasConsumerEvidence matches bracket access on a quoted key", () => {
	const corpus = ['if (!credential["@context"]) fail();'];
	assert.ok(hasConsumerEvidence("@context", corpus));
});

test("camelToSnake bridges the wire's camelCase to Rust's snake_case for cross-language evidence", () => {
	assert.equal(camelToSnake("deadlineMs"), "deadline_ms");
	assert.equal(camelToSnake("workspaceId"), "workspace_id");
	assert.equal(camelToSnake("created_after_ns"), "created_after_ns");
});

test("classifyField finds a Rust-side producer for a TS-declared camelCase field via the snake_case guess", () => {
	const corpus = ["let effort = Effort { workspace_id: Some(id) };", "console.log(x.workspaceId);"];
	assert.equal(classifyField({ fieldName: "workspaceId" }, corpus), "reachable");
});

test("snakeToCamel is camelToSnake's mirror — needed once declared fields can start as Rust identifiers", () => {
	assert.equal(snakeToCamel("workspace_id"), "workspaceId");
	assert.equal(snakeToCamel("scoped_credentials"), "scopedCredentials");
	assert.equal(snakeToCamel("deadlineMs"), "deadlineMs");
});

test("classifyField finds a TS-side producer for a Rust-declared snake_case field via the camelCase guess (provides_api / providesApi shape)", () => {
	// Before the reverse guess existed, a Rust-native field name (e.g.
	// `provides_api`) only ever searched for its OWN spelling and the
	// (no-op) camelToSnake of itself — never the camelCase wire spelling its
	// real TS producer actually used. That made every such field read
	// falsely `unreachable` the moment Rust structs entered scope.
	const corpus = ["return { providesApi: [] };", "caps.provides_api.iter()"];
	assert.equal(classifyField({ fieldName: "provides_api" }, corpus), "reachable");
});

// ── The TYPE question: is this type's NAME used anywhere outside its own declaration? ──

test("blankTypeNameSelfReferences blanks only the type's own name token at its signature, leaving other references and field bodies alone", () => {
	const source = stripComments(`
export interface Widget {
	id: string;
}
function build(): Widget {
	return { id: "x" };
}
`);
	const blanked = blankTypeNameSelfReferences(source, "ts");
	assert.ok(!/export interface Widget/.test(blanked), "the declaration's own name must be blanked");
	assert.ok(blanked.includes("id: string"), "field bodies are untouched by this pass");
	assert.ok(/function build\(\): Widget/.test(blanked), "a real usage elsewhere must survive");
});

test("blankTypeNameSelfReferences blanks a Rust struct's own name at its signature the same way", () => {
	const source = stripComments(`
pub struct Effort {
    pub id: String,
}
fn store(e: Effort) {}
`);
	const blanked = blankTypeNameSelfReferences(source, "rs");
	assert.ok(!/pub struct Effort/.test(blanked));
	assert.ok(/fn store\(e: Effort\)/.test(blanked));
});

test("hasTypeNameEvidence: a type named nowhere but its own declaration is NOT evidence of itself", () => {
	const source = stripComments(`
export interface DeadType {
	traceId: string;
}
`);
	const corpus = [blankTypeNameSelfReferences(source, "ts")];
	assert.ok(!hasTypeNameEvidence("DeadType", corpus));
});

test("hasTypeNameEvidence: a type referenced by ANOTHER declaration (composition) counts as named", () => {
	const source = stripComments(`
export interface Inner {
	traceId: string;
}
export interface Envelope {
	event: Inner;
}
`);
	const corpus = [blankTypeNameSelfReferences(source, "ts")];
	assert.ok(
		hasTypeNameEvidence("Inner", corpus),
		"a sibling type composing this one by name is real usage, not self-declaration",
	);
});

test("hasTypeNameEvidence: a traceId read elsewhere does NOT resurrect an unnamed type (the bug this change fixes)", () => {
	// The gate's own first real finding: five *TelemetryEvent types shared a
	// `traceId` field. One capability wiring ITS telemetry for real made
	// every sibling's `traceId` read as field-reachable by text — but the
	// TYPE name itself, `DeadTelemetryEvent`, is still named nowhere.
	const source = stripComments(`
export interface DeadTelemetryEvent {
	traceId: string;
}
`);
	const corpus = [
		blankTypeNameSelfReferences(source, "ts"),
		"const wired = { traceId: id() }; console.log(wired.traceId);",
	];
	assert.ok(!hasTypeNameEvidence("DeadTelemetryEvent", corpus));
});

// ── Rust wire structs outside contract packages (packages/tractor/src/) ────

test("hasSerdeDerive matches Serialize or Deserialize inside a #[derive(...)] attribute, plain or path-qualified", () => {
	assert.ok(hasSerdeDerive("#[derive(Debug, Clone, Serialize, Deserialize)]\n"));
	assert.ok(hasSerdeDerive("#[derive(Debug, serde::Deserialize)]\n"));
	assert.ok(!hasSerdeDerive("#[derive(Debug, Clone)]\n"));
	assert.ok(!hasSerdeDerive("#[serde(rename_all = \"camelCase\")]\n"));
});

test("extractSerdeDerivedRustTypeGroups includes a struct with #[derive(Serialize)]/#[derive(Deserialize)], skips one without", () => {
	const source = `
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wired {
    pub id: String,
}

pub struct NotWire {
    pub id: String,
}
`;
	const groups = extractSerdeDerivedRustTypeGroups(source, "tractor");
	const names = groups.map((g) => g.typeName);
	assert.ok(names.includes("Wired"));
	assert.ok(!names.includes("NotWire"), "a struct never annotated with a serde derive is out of scope");
});

test("extractSerdeDerivedRustTypeGroups still finds the derive through an intervening #[serde(...)] attribute line (the Effort shape)", () => {
	const source = `
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effort {
    pub workspace_id: Option<String>,
}
`;
	const groups = extractSerdeDerivedRustTypeGroups(source, "tractor");
	assert.deepEqual(
		groups.map((g) => g.id),
		["tractor:Effort"],
	);
	assert.deepEqual(
		groups[0].fields.map((f) => f.fieldName),
		["workspace_id"],
	);
});

test("extractSerdeDerivedRustTypeGroups covers enums too", () => {
	const source = `
#[derive(Debug, Serialize, Deserialize)]
pub enum NoticeKind {
    Info,
    Warning,
}
`;
	const groups = extractSerdeDerivedRustTypeGroups(source, "tractor");
	assert.deepEqual(
		groups.map((g) => g.typeName),
		["NoticeKind"],
	);
});

test("extractTypeGroups: each group carries id/package/typeName plus a fields array shaped like extractContractFields's entries", () => {
	const stripped = stripComments("export interface Alpha {\n\ta: string;\n\tb: number;\n}\n");
	const groups = extractTypeGroups(stripped, "pkg", "ts");
	assert.deepEqual(groups, [
		{
			id: "pkg:Alpha",
			package: "pkg",
			typeName: "Alpha",
			fields: [
				{ id: "pkg:Alpha.a", fieldName: "a" },
				{ id: "pkg:Alpha.b", fieldName: "b" },
			],
		},
	]);
});

// ── Parse-sanity floor: a scan that finds almost nothing must scream ───────

test("assertExtractionIsPlausible throws when the package count is implausibly low", () => {
	assert.throws(
		() => assertExtractionIsPlausible(1, MINIMUM_PLAUSIBLE_FIELD_COUNT),
		/only found 1 packages/,
	);
});

test("assertExtractionIsPlausible throws when the field count is implausibly low", () => {
	assert.throws(
		() => assertExtractionIsPlausible(MINIMUM_PLAUSIBLE_CONTRACT_PACKAGE_COUNT, 3),
		/only extracted 3 declared field/,
	);
});

test("assertExtractionIsPlausible does not throw right at the floor", () => {
	assert.doesNotThrow(() =>
		assertExtractionIsPlausible(
			MINIMUM_PLAUSIBLE_CONTRACT_PACKAGE_COUNT,
			MINIMUM_PLAUSIBLE_FIELD_COUNT,
		),
	);
});

test("assertTractorExtractionIsPlausible throws when the tractor wire type count is implausibly low", () => {
	assert.throws(
		() => assertTractorExtractionIsPlausible(1, MINIMUM_PLAUSIBLE_TRACTOR_WIRE_FIELD_COUNT),
		/only found 1 #\[derive/,
	);
});

test("assertTractorExtractionIsPlausible throws when the tractor wire field count is implausibly low", () => {
	assert.throws(
		() => assertTractorExtractionIsPlausible(MINIMUM_PLAUSIBLE_TRACTOR_WIRE_TYPE_COUNT, 3),
		/only extracted 3 declared field/,
	);
});

test("assertTractorExtractionIsPlausible does not throw right at the floor", () => {
	assert.doesNotThrow(() =>
		assertTractorExtractionIsPlausible(
			MINIMUM_PLAUSIBLE_TRACTOR_WIRE_TYPE_COUNT,
			MINIMUM_PLAUSIBLE_TRACTOR_WIRE_FIELD_COUNT,
		),
	);
});

// Finding echoed from check-model-defaults-drift.mjs's own history: `main()` must
// return a non-zero code (never call process.exit itself) when extraction breaks.
test("main() returns a non-zero exit code when the extraction floor is not cleared", async () => {
	const code = await main({
		contractTypesSources: new Map([["only-one-pkg", "export interface X { a: string; }"]]),
		baselineRaw: '{"entries":[]}',
	});
	assert.equal(code, 1);
});

// ── Baseline ratchet: growth, undeleted progress, and stale cover must all fail ──

function baselineWith(entries) {
	return { entries };
}

test("evaluateReachabilityBaseline: a new non-reachable field not in the baseline is a regression", () => {
	const allStates = new Map([["pkg:Widget.newField", "unreachable"]]);
	const { regressions } = evaluateReachabilityBaseline(baselineWith([]), allStates);
	assert.equal(regressions.length, 1);
	assert.match(regressions[0], /pkg:Widget\.newField/);
});

test("evaluateReachabilityBaseline: a reachable field is never a regression even if absent from the baseline", () => {
	const allStates = new Map([["pkg:Widget.field", "reachable"]]);
	const { regressions } = evaluateReachabilityBaseline(baselineWith([]), allStates);
	assert.equal(regressions.length, 0);
});

test("evaluateReachabilityBaseline: a baselined field that became reachable is undeleted progress, and fails", () => {
	const baseline = baselineWith([
		{ id: "pkg:Widget.field", state: "unreachable", date: "2026-08-04", reason: "test fixture" },
	]);
	const allStates = new Map([["pkg:Widget.field", "reachable"]]);
	const { fixed } = evaluateReachabilityBaseline(baseline, allStates);
	assert.deepEqual(fixed, ["pkg:Widget.field"]);
});

test("evaluateReachabilityBaseline: a baselined field whose state changed (but is still non-reachable) is stale cover", () => {
	const baseline = baselineWith([
		{ id: "pkg:Widget.field", state: "unread", date: "2026-08-04", reason: "test fixture" },
	]);
	const allStates = new Map([["pkg:Widget.field", "unreachable"]]);
	const { stale } = evaluateReachabilityBaseline(baseline, allStates);
	assert.equal(stale.length, 1);
	assert.match(stale[0].why, /now "unreachable", baseline says "unread"/);
});

test("evaluateReachabilityBaseline: a baselined field that no longer exists at all is stale cover", () => {
	const baseline = baselineWith([
		{ id: "pkg:Widget.removedField", state: "unread", date: "2026-08-04", reason: "test fixture" },
	]);
	const { stale } = evaluateReachabilityBaseline(baseline, new Map());
	assert.equal(stale.length, 1);
	assert.match(stale[0].why, /no longer appears/);
});

test("evaluateReachabilityBaseline: an entry missing a reason, date, or unknown state is malformed", () => {
	const baseline = baselineWith([
		{ id: "pkg:A.a", state: "unread", date: "2026-08-04", reason: "" },
		{ id: "pkg:A.b", state: "unread", date: "", reason: "ok" },
		{ id: "pkg:A.c", state: "not-a-real-state", date: "2026-08-04", reason: "ok" },
	]);
	const allStates = new Map([
		["pkg:A.a", "unread"],
		["pkg:A.b", "unread"],
		["pkg:A.c", "unread"],
	]);
	const { malformed } = evaluateReachabilityBaseline(baseline, allStates);
	assert.equal(malformed.length, 3);
});

test("evaluateReachabilityBaseline: a matching, current baseline entry is held (accepted debt), not a failure", () => {
	const baseline = baselineWith([
		{ id: "pkg:Widget.field", state: "unread", date: "2026-08-04", reason: "test fixture" },
	]);
	const allStates = new Map([["pkg:Widget.field", "unread"]]);
	const { regressions, fixed, stale, malformed, held } = evaluateReachabilityBaseline(
		baseline,
		allStates,
	);
	assert.deepEqual(
		{ regressions, fixed, stale, malformed },
		{ regressions: [], fixed: [], stale: [], malformed: [] },
	);
	assert.deepEqual(held, [{ id: "pkg:Widget.field", state: "unread" }]);
});

test("parseReachabilityBaseline throws on invalid JSON rather than guessing", () => {
	assert.throws(() => parseReachabilityBaseline("not json"), /not valid JSON/);
});

test("parseReachabilityBaseline throws when `entries` is missing", () => {
	assert.throws(() => parseReachabilityBaseline("{}"), /no `entries` array/);
});

// ── End-to-end fixture: reachable/unreachable/unread/dormant/unnamed wired through main() ──

// Pad past BOTH plausibility floors (the TS contract one and the tractor
// wire one) with synthetic packages/structs, all declaring the SAME field
// name (`value`) on many distinct types so the padding contributes distinct
// `pkg:Type.value` ids without each needing its own baseline entry — one
// shared producer+consumer pair in the evidence corpus makes every padding
// field `reachable`, and one line naming every padding TYPE makes every
// padding type `named`, leaving the fixture's own declared type(s) as the
// only classifications under test. Those floors, and the type-name question,
// have their own dedicated tests above; this helper exists only so the
// end-to-end tests don't also have to hand-satisfy them. `tractorRustSources`
// must be built here too (not left to fall back to the real filesystem) —
// omitting it would silently mix real-repo Rust findings into what is meant
// to be an isolated fixture.
function buildFloorClearingPadding() {
	const contractTypesSources = new Map();
	const typeNames = [];
	let padding = "";
	for (let i = 0; i < MINIMUM_PLAUSIBLE_FIELD_COUNT; i++) {
		padding += `export interface Padding${i} {\n\tvalue: string;\n}\n`;
		typeNames.push(`Padding${i}`);
	}
	contractTypesSources.set("padding-pkg", padding);
	for (let i = 0; i < MINIMUM_PLAUSIBLE_CONTRACT_PACKAGE_COUNT - 1; i++) {
		contractTypesSources.set(`extra-pkg-${i}`, "export interface Extra {\n\tvalue: string;\n}\n");
	}
	typeNames.push("Extra");

	const tractorRustSources = new Map();
	const tractorPaddingCount = Math.max(
		MINIMUM_PLAUSIBLE_TRACTOR_WIRE_TYPE_COUNT,
		MINIMUM_PLAUSIBLE_TRACTOR_WIRE_FIELD_COUNT,
	);
	let tractorPadding = "";
	for (let i = 0; i < tractorPaddingCount; i++) {
		tractorPadding +=
			`#[derive(Debug, Clone, Serialize, Deserialize)]\n` +
			`pub struct PaddingRust${i} {\n    pub value: String,\n}\n`;
		typeNames.push(`PaddingRust${i}`);
	}
	tractorRustSources.set("padding.rs", tractorPadding);

	const evidenceCorpus = ["const p = { value: 1 };", "console.log(p.value);", typeNames.join(" ")];
	return { contractTypesSources, tractorRustSources, evidenceCorpus };
}

test("main() end-to-end: a clean baseline against a small fixture tree passes", async () => {
	const { contractTypesSources, tractorRustSources, evidenceCorpus } = buildFloorClearingPadding();
	contractTypesSources.set(
		"fixture-contract-v1",
		`
export interface Fixture {
	reachableField: string;
	unreachableField: string;
	unreadField: string;
	dormantField: string;
}
`,
	);
	evidenceCorpus.push(
		"const f: Fixture = load();", // names the type, so field-level classification even applies
		"const x = { reachableField: 1 };",
		"console.log(x.reachableField);",
		"console.log(x.unreachableField);", // consumer, no producer
		"const y = { unreadField: 1 };", // producer, no consumer
		// dormantField: mentioned nowhere else
	);
	const baselineRaw = JSON.stringify({
		entries: [
			{
				id: "fixture-contract-v1:Fixture.unreachableField",
				state: "unreachable",
				date: "2026-08-04",
				reason: "test fixture",
			},
			{
				id: "fixture-contract-v1:Fixture.unreadField",
				state: "unread",
				date: "2026-08-04",
				reason: "test fixture",
			},
			{
				id: "fixture-contract-v1:Fixture.dormantField",
				state: "dormant",
				date: "2026-08-04",
				reason: "test fixture",
			},
		],
	});

	const code = await main({ contractTypesSources, tractorRustSources, evidenceCorpus, baselineRaw });
	assert.equal(code, 0);
});

test("main() end-to-end: a NEW unreachable field not in the baseline fails the gate", async () => {
	const { contractTypesSources, tractorRustSources, evidenceCorpus } = buildFloorClearingPadding();
	contractTypesSources.set(
		"fixture-contract-v1",
		`
export interface Fixture {
	workspaceId: string;
}
`,
	);
	evidenceCorpus.push(
		"const f: Fixture = load();", // names the type — the field, not the type, is under test here
		"console.log(effort.workspaceId);", // consumer, no producer — Shape 2
	);

	const code = await main({
		contractTypesSources,
		tractorRustSources,
		evidenceCorpus,
		baselineRaw: '{"entries":[]}',
	});
	assert.equal(code, 1);
});

test("main() end-to-end: an unnamed type with several fields is ONE baseline-worthy finding, not one per field", async () => {
	// The gate's own history, reproduced as a fixture: a dead type whose
	// fields share names common enough to look field-reachable on their own
	// (a shared `traceId`/`pluginId`/`durationMs` producer+consumer exists
	// elsewhere in the corpus) — CHANGE ONE's whole point is that none of
	// that field-level noise matters once the TYPE itself is named nowhere.
	const { contractTypesSources, tractorRustSources, evidenceCorpus } = buildFloorClearingPadding();
	contractTypesSources.set(
		"dead-contract-v1",
		`
export interface DeadType {
	traceId: string;
	pluginId: string;
	durationMs: number;
}
`,
	);
	evidenceCorpus.push(
		"const t = { traceId: id(), pluginId: p, durationMs: 5 };",
		"console.log(t.traceId, t.pluginId, t.durationMs);",
		// "DeadType" itself: named nowhere.
	);

	const withoutBaseline = await main({
		contractTypesSources,
		tractorRustSources,
		evidenceCorpus,
		baselineRaw: '{"entries":[]}',
	});
	assert.equal(withoutBaseline, 1);

	// If the type's three fields were STILL being reported individually
	// (the pre-fix behaviour), this single type-level entry would leave two
	// of them uncovered and the gate would stay red.
	const withBaseline = await main({
		contractTypesSources,
		tractorRustSources,
		evidenceCorpus,
		baselineRaw: JSON.stringify({
			entries: [
				{
					id: "dead-contract-v1:DeadType",
					state: "unnamed",
					date: "2026-08-04",
					reason: "test fixture — type named nowhere outside its own declaration",
				},
			],
		}),
	});
	assert.equal(withBaseline, 0, "one type-level entry must cover ALL of the dead type's fields");
});

// ── Regression guard: the real repo, end to end, unmodified ────────────────
//
// Same convention as check-model-defaults-drift.mjs's own final test: this
// exercises the real filesystem walk (packages/*-contract-v1/src/types.ts,
// packages/tractor/src/**/*.rs's serde-deriving structs/enums, and the
// packages/ and apps/ evidence corpus) and the real, hand-edited baseline. If
// this fails, either a type/field genuinely regressed, or the baseline needs
// an update — never silence it by weakening the assertion.
test("main() exits 0 against the real repo files (regression guard)", async () => {
	const code = await main();
	assert.equal(code, 0);
});
