import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	checkHandoffCitations,
	checkRequirementCitations,
	checkRequirementIndex,
	checkLedgerFreshness,
	parseCommitCount,
} from "./project-block-consistency.mjs";

describe("checkHandoffCitations", () => {
	const issues = [{ id: "ISS-001", status: "open", axis: "cost" }];

	it("errors when a cited id does not exist", () => {
		const result = checkHandoffCitations({ next_actions: ["see ISS-404"], blockers: [] }, issues);
		assert.ok(result.errors.includes("[handoff] cites unknown work item: ISS-404"));
	});

	it("errors when an entry cites nothing", () => {
		const result = checkHandoffCitations(
			{ next_actions: ["a loose end with no id"], blockers: [] },
			issues,
		);
		assert.equal(result.errors.length, 1);
		assert.match(result.errors[0], /cites no work item/);
	});

	it("passes when every entry cites an existing id", () => {
		const result = checkHandoffCitations({ next_actions: ["ISS-001 is next"], blockers: [] }, issues);
		assert.deepEqual(result.errors, []);
	});

	it("does NOT require every open issue to appear in the handoff", () => {
		const many = [
			{ id: "ISS-001", status: "open", axis: "cost" },
			{ id: "ISS-002", status: "open", axis: "cost" },
		];
		const result = checkHandoffCitations({ next_actions: ["ISS-001 only"], blockers: [] }, many);
		assert.deepEqual(result.errors, []);
	});

	it("errors on an open issue with no axis", () => {
		const result = checkHandoffCitations({ next_actions: ["ISS-001"], blockers: [] }, [
			{ id: "ISS-001", status: "open" },
		]);
		assert.match(result.errors.join(" "), /ISS-001.*axis/);
	});

	it("errors on a resolved issue with no resolved_by", () => {
		const result = checkHandoffCitations({ next_actions: ["ISS-001"], blockers: [] }, [
			{ id: "ISS-001", status: "open", axis: "cost" },
			{ id: "ISS-002", status: "resolved" },
		]);
		assert.match(result.errors.join(" "), /ISS-002.*resolved_by/);
	});

	// Regression guard: main() also cross-references a VER- resolved_by against the verification
	// block, but that is a DIFFERENT concern from "resolved_by is missing" — checkHandoffCitations
	// is the sole owner of the missing-resolved_by message. If that responsibility is ever
	// duplicated back into main()'s issue loop, this test alone can't see main()'s output, but it
	// pins that THIS function reports the case exactly once — never twice for one root cause.
	it("reports a missing resolved_by exactly once, not doubled", () => {
		const result = checkHandoffCitations({ next_actions: ["ISS-001"], blockers: [] }, [
			{ id: "ISS-001", status: "open", axis: "cost" },
			{ id: "ISS-002", status: "resolved" },
		]);
		assert.equal(result.errors.length, 1);
	});
});

describe("checkLedgerFreshness", () => {
	it("warns, never errors, when commits landed and the ledger did not move", () => {
		const result = checkLedgerFreshness({ commitsSinceLedgerChange: 12 });
		assert.deepEqual(result.errors, []);
		assert.equal(result.warnings.length, 1);
	});

	it("is silent when the ledger moved recently", () => {
		const result = checkLedgerFreshness({ commitsSinceLedgerChange: 0 });
		assert.deepEqual(result.warnings, []);
	});

	it("reports unknown rather than fresh when git cannot be read", () => {
		const result = checkLedgerFreshness({ commitsSinceLedgerChange: null });
		assert.match(result.warnings.join(" "), /unknown/);
		assert.deepEqual(result.errors, []);
	});
});

describe("parseCommitCount", () => {
	it("parses a valid git rev-list --count line", () => {
		assert.equal(parseCommitCount("4\n"), 4);
	});

	it("parses zero", () => {
		assert.equal(parseCommitCount("0\n"), 0);
	});

	// Regression for the finding: a non-numeric `git rev-list --count` result (empty stdout,
	// truncated output, an unexpected shape) used to flow through as `NaN`, and `NaN > 0` is
	// `false`, so `checkLedgerFreshness` reported FRESH for a count it never actually read.
	it("returns null (UNKNOWN), never NaN, for non-numeric output", () => {
		assert.equal(parseCommitCount(""), null);
		assert.equal(parseCommitCount("not a number"), null);
		assert.equal(parseCommitCount("\n"), null);
	});

	// The end-to-end proof that the guard actually protects `checkLedgerFreshness`: feeding its
	// result straight through must land on the UNKNOWN branch, not the "0 commits, fresh" branch.
	it("composes with checkLedgerFreshness to report UNKNOWN, not FRESH, for garbage git output", () => {
		const commitsSinceLedgerChange = parseCommitCount("not a number");
		const result = checkLedgerFreshness({ commitsSinceLedgerChange });
		assert.match(result.warnings.join(" "), /unknown/);
		assert.deepEqual(result.errors, []);
	});
});

describe("checkRequirementCitations", () => {
	const requirements = [{ id: "R1" }, { id: "R7" }, { id: "REQ-ENV-001" }];

	it("errors when an item serves a requirement that does not exist", () => {
		const result = checkRequirementCitations(requirements, [{ id: "ISS-1", requirement: "R99" }]);
		assert.ok(result.errors.includes("[issues] ISS-1 serves unknown requirement: R99"));
	});

	it("passes when the citation exists", () => {
		assert.deepEqual(checkRequirementCitations(requirements, [{ id: "ISS-1", requirement: "R7" }]).errors, []);
	});

	it("does NOT require an item to cite one — the field is optional by decision", () => {
		assert.deepEqual(checkRequirementCitations(requirements, [{ id: "ISS-1", status: "open" }]).errors, []);
	});

	it("accepts a citation of the May-era cohort too — they are requirements of this project as well", () => {
		assert.deepEqual(
			checkRequirementCitations(requirements, [{ id: "ISS-1", requirement: "REQ-ENV-001" }]).errors,
			[],
		);
	});

	it("names every offender rather than stopping at the first", () => {
		const result = checkRequirementCitations(requirements, [
			{ id: "ISS-1", requirement: "R98" },
			{ id: "ISS-2", requirement: "R99" },
		]);
		assert.equal(result.errors.length, 2);
	});
});

describe("checkRequirementIndex", () => {
	const requirements = [{ id: "R1", title: "Continuidade", maturity: "parcial" }];
	const table = "| Id | Resultado | Maturidade |\n| --- | --- | --- |\n| R1 | Continuidade | parcial |";

	it("passes when the index matches the record", () => {
		assert.deepEqual(checkRequirementIndex(table, requirements).errors, []);
	});

	it("errors when a row's maturity drifts from the record", () => {
		const drifted = table.replace("parcial", "provado");
		assert.match(checkRequirementIndex(drifted, requirements).errors[0], /R1/);
	});

	it("errors when a requirement has no row at all", () => {
		const result = checkRequirementIndex(table, [...requirements, { id: "R2", title: "x", maturity: "parcial" }]);
		assert.match(result.errors[0], /R2/);
	});

	it("ignores the legacy REQ- cohort, which the index never claimed to cover", () => {
		const result = checkRequirementIndex(table, [...requirements, { id: "REQ-ENV-001" }]);
		assert.deepEqual(result.errors, []);
	});

	it("reports UNKNOWN rather than clean when the index cannot be read", () => {
		const result = checkRequirementIndex(null, requirements);
		assert.deepEqual(result.errors, []);
		assert.match(result.warnings[0], /could not be read/i);
	});
});
