import assert from "node:assert/strict";
import test from "node:test";

import {
	MINIMUM_PLAUSIBLE_CONTRACT_PACKAGE_COUNT,
	MINIMUM_PLAUSIBLE_FIELD_COUNT,
	assertExtractionIsPlausible,
	blankDeclarationBodies,
	camelToSnake,
	classifyField,
	evaluateReachabilityBaseline,
	extractContractFields,
	hasConsumerEvidence,
	hasProducerEvidence,
	main,
	parseReachabilityBaseline,
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

// ── End-to-end fixture: reachable/unreachable/unread/dormant fields wired through main() ──

// Pad past the plausibility floor with synthetic packages, all declaring the
// SAME field name (`value`) on many distinct types so the padding contributes
// distinct `pkg:Type.value` ids without each needing its own baseline entry —
// one shared producer+consumer pair in the evidence corpus makes every
// padding field `reachable`, leaving the fixture's own four fields
// (reachable/unreachable/unread/dormant) as the only classifications under
// test. Those floors have their own dedicated tests above; this helper exists
// only so the end-to-end tests don't also have to hand-satisfy them.
function buildFloorClearingPadding() {
	const contractTypesSources = new Map();
	let padding = "";
	for (let i = 0; i < MINIMUM_PLAUSIBLE_FIELD_COUNT; i++) {
		padding += `export interface Padding${i} {\n\tvalue: string;\n}\n`;
	}
	contractTypesSources.set("padding-pkg", padding);
	for (let i = 0; i < MINIMUM_PLAUSIBLE_CONTRACT_PACKAGE_COUNT - 1; i++) {
		contractTypesSources.set(`extra-pkg-${i}`, "export interface Extra {\n\tvalue: string;\n}\n");
	}
	const evidenceCorpus = ["const p = { value: 1 };", "console.log(p.value);"];
	return { contractTypesSources, evidenceCorpus };
}

test("main() end-to-end: a clean baseline against a small fixture tree passes", async () => {
	const { contractTypesSources, evidenceCorpus } = buildFloorClearingPadding();
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

	const code = await main({ contractTypesSources, evidenceCorpus, baselineRaw });
	assert.equal(code, 0);
});

test("main() end-to-end: a NEW unreachable field not in the baseline fails the gate", async () => {
	const { contractTypesSources, evidenceCorpus } = buildFloorClearingPadding();
	contractTypesSources.set(
		"fixture-contract-v1",
		`
export interface Fixture {
	workspaceId: string;
}
`,
	);
	evidenceCorpus.push("console.log(effort.workspaceId);"); // consumer, no producer — Shape 2

	const code = await main({
		contractTypesSources,
		evidenceCorpus,
		baselineRaw: '{"entries":[]}',
	});
	assert.equal(code, 1);
});

// ── Regression guard: the real repo, end to end, unmodified ────────────────
//
// Same convention as check-model-defaults-drift.mjs's own final test: this
// exercises the real filesystem walk (packages/*-contract-v1/src/types.ts +
// the packages/ and apps/ evidence corpus) and the real, hand-edited
// baseline. If this fails, either a field genuinely regressed, or the
// baseline needs an update — never silence it by weakening the assertion.
test("main() exits 0 against the real repo files (regression guard)", async () => {
	const code = await main();
	assert.equal(code, 0);
});
