import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { checkHandoffCitations, checkLedgerFreshness } from "./project-block-consistency.mjs";

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
