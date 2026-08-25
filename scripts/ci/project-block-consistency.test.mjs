import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	checkHandoffCitations,
	checkRequirementCitations,
	checkRequirementIndex,
	checkLedgerFreshness,
	itemDigest,
	lastChangeByItem,
	openItemAgeDays,
	UNREVIEWED_AFTER_DAYS,
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

describe("checkLedgerFreshness — per ITEM, because per FILE was wrong in both directions", () => {
	// MEASURED 2026-08-25, before this changed. The old check asked "how many commits since
	// .project/issues.json changed", and that file is touched most sessions:
	//
	//   UNDER-REPORTED  it answered FRESH while 9 of 23 open items had not themselves changed in
	//                   over a week, the oldest a `high` at 16.7 days. ISS-131 — found false that
	//                   day with 8-day-old evidence — was in exactly that tail.
	//   OVER-REPORTED   its threshold was `> 0`, so it fired on 52 of the last 80 commits (65%)
	//                   while the maximum real distance was 7. A gate heard two runs in three is
	//                   not heard at all (7b35d843, the same finding for the security audit).
	const ages = (entries) => new Map(entries);

	it("warns, never errors, naming the count and the OLDEST item", () => {
		const result = checkLedgerFreshness({
			itemAgeDays: ages([["ISS-001", 20], ["ISS-002", 16], ["ISS-003", 2]]),
		});
		assert.deepEqual(result.errors, []);
		assert.equal(result.warnings.length, 1);
		assert.match(result.warnings[0], /2 open item/);
		assert.match(result.warnings[0], /ISS-001/);
	});

	it("is silent while every open item is inside the window", () => {
		const result = checkLedgerFreshness({ itemAgeDays: ages([["ISS-001", 1], ["ISS-002", 13]]) });
		assert.deepEqual(result.warnings, []);
	});

	it("does not fire on a ledger the newest commit simply did not touch", () => {
		// The whole of the over-reporting half: a ledger nobody edited in this commit is normal,
		// and used to produce a warning on two runs in three.
		const result = checkLedgerFreshness({ itemAgeDays: ages([["ISS-001", 0.01]]) });
		assert.deepEqual(result.warnings, []);
	});

	it("reports unknown rather than fresh when git cannot be read", () => {
		const result = checkLedgerFreshness({ itemAgeDays: null });
		assert.match(result.warnings.join(" "), /unknown/);
		assert.deepEqual(result.errors, []);
	});

	it("is silent for an empty ledger rather than claiming anything about it", () => {
		assert.deepEqual(checkLedgerFreshness({ itemAgeDays: ages([]) }).warnings, []);
	});
});

describe("the walk that dates each item", () => {
	const DAY = 86_400_000;
	const rev = (days, issues) => ({ timestampMs: 10 * DAY - days * DAY, issues });

	it("dates an item at the revision its OWN content last changed", () => {
		const lastChange = lastChangeByItem([
			rev(9, [{ id: "ISS-001", body: "a" }, { id: "ISS-002", body: "x" }]),
			rev(1, [{ id: "ISS-001", body: "a" }, { id: "ISS-002", body: "y" }]),
		]);
		// ISS-001 never moved; ISS-002 did. This is the whole defect: the FILE changed in the
		// second revision, so the old check called both of them fresh.
		assert.equal(lastChange.get("ISS-001"), 10 * DAY - 9 * DAY);
		assert.equal(lastChange.get("ISS-002"), 10 * DAY - 1 * DAY);
	});

	it("counts a first appearance as a change, so a new item is fresh and not ageless", () => {
		const lastChange = lastChangeByItem([
			rev(9, [{ id: "ISS-001", body: "a" }]),
			rev(1, [{ id: "ISS-001", body: "a" }, { id: "ISS-002", body: "new" }]),
		]);
		assert.equal(lastChange.get("ISS-002"), 10 * DAY - 1 * DAY);
	});

	it("reads a reordered item as unchanged, not as a review", () => {
		// A writer that serialises keys in a different order has not reviewed anything.
		const lastChange = lastChangeByItem([
			rev(9, [{ id: "ISS-001", title: "t", body: "a" }]),
			rev(1, [{ id: "ISS-001", body: "a", title: "t" }]),
		]);
		assert.equal(lastChange.get("ISS-001"), 10 * DAY - 9 * DAY);
	});

	it("counts a status or resolved_by move as a review, not only prose", () => {
		// "When did anyone last look at this" — closing an item IS looking at it.
		const lastChange = lastChangeByItem([
			rev(9, [{ id: "ISS-001", body: "a", status: "open" }]),
			rev(1, [{ id: "ISS-001", body: "a", status: "resolved" }]),
		]);
		assert.equal(lastChange.get("ISS-001"), 10 * DAY - 1 * DAY);
	});

	it("digests are stable across key order and sensitive to content", () => {
		assert.equal(itemDigest({ id: "a", body: "x" }), itemDigest({ body: "x", id: "a" }));
		assert.notEqual(itemDigest({ id: "a", body: "x" }), itemDigest({ id: "a", body: "y" }));
	});

	it("scores only OPEN items, and omits an id the walk never saw", () => {
		// An id with no history is UNKNOWN. Scoring it 0 would report the one thing nobody
		// measured as the freshest thing in the ledger — the defect shape this whole change is
		// about, one level down.
		const ages = openItemAgeDays({
			issues: [
				{ id: "ISS-001", status: "open" },
				{ id: "ISS-002", status: "resolved" },
				{ id: "ISS-003", status: "open" },
			],
			lastChange: new Map([["ISS-001", 0]]),
			nowMs: 3 * 86_400_000,
		});
		assert.deepEqual([...ages.keys()], ["ISS-001"]);
		assert.equal(ages.get("ISS-001"), 3);
	});

	it("declares its threshold rather than hiding it in a comparison", () => {
		assert.equal(typeof UNREVIEWED_AFTER_DAYS, "number");
		assert.ok(UNREVIEWED_AFTER_DAYS > 0);
	});
});
