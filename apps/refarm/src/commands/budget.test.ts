import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	budgetObservationsPageFromBody,
	currentRateTableFrom,
	groupObservations,
	outcomeMark,
	printGroupedObservationsHuman,
	printObservationsHuman,
	summariseObservations,
} from "./budget.js";

describe("summariseObservations", () => {
	it("counts the runs the node cut, so a hit ceiling is visible", () => {
		const summary = summariseObservations([
			{ "refarm.outcome": "done", "refarm.budget.bound_by": "declared" },
			{ "refarm.outcome": "timed-out", "refarm.budget.bound_by": "node" },
			{ "refarm.outcome": "timed-out", "refarm.budget.bound_by": "node" },
		]);
		expect(summary).toEqual({
			total: 3,
			timedOut: 2,
			boundByNode: 2,
			boundByWorkspace: 0,
			// None of these three nodes carry `refarm.cost.rate_table_version`, and no
			// `currentRateTable` baseline was given — every one is unstamped, and none
			// can be judged stale against a baseline nobody supplied.
			stalePricing: 0,
			unstampedPricing: 3,
			priceUnknown: 0,
			// None of these three carry `host.id` either — pre-node-identity fixtures, so
			// all three are unidentified records, not nodes.
			nodesRepresented: [],
			unnamedNode: 0,
			unidentifiedRecords: 3,
		});
	});

	it("reports zeroes rather than throwing on an empty record", () => {
		expect(summariseObservations([])).toEqual({
			total: 0,
			timedOut: 0,
			boundByNode: 0,
			boundByWorkspace: 0,
			stalePricing: 0,
			unstampedPricing: 0,
			priceUnknown: 0,
			nodesRepresented: [],
			unnamedNode: 0,
			unidentifiedRecords: 0,
		});
	});

	it("counts observations priced by a rate table that is no longer current", () => {
		// Tokens do not drift; prices do. An observation stamped with a
		// superseded rate table still holds true token counts, so its cost is
		// recomputable — but only if the reader can find it.
		const summary = summariseObservations(
			[
				{ "refarm.cost.rate_table_version": "2026-08-03" },
				{ "refarm.cost.rate_table_version": "2026-01-01" },
				{},
			],
			"2026-08-03",
		);
		expect(summary.stalePricing).toBe(1);
		expect(summary.unstampedPricing).toBe(1);
	});

	it("counts a genuine 'no rate on file' apart from a cheap or unstamped run (F5)", () => {
		const summary = summariseObservations([
			// Priced normally.
			{ "refarm.cost.price_known": true },
			// F5's case: estimated_usd is 0.0, but the price was never known.
			{ "refarm.cost.price_known": false },
			// A record written before F5 shipped carries neither key — not
			// counted either way, per D6 (absent is not the same as false).
			{},
		]);
		expect(summary.priceUnknown).toBe(1);
	});

	// ── The collision contract — this is the point of the reducer ──────────────────

	it("gives two nodes the same declared name and distinct ids two separate entries", () => {
		// This is the whole reason nodesRepresented keys on host.id: no coordinator can
		// forbid two offline nodes from choosing the same name, so the reader must not be
		// the thing that silently merges them into one machine's worth of work.
		const summary = summariseObservations([
			{ "host.id": "node-a", "host.name": "sede" },
			{ "host.id": "node-b", "host.name": "sede" },
		]);
		expect(summary.nodesRepresented).toHaveLength(2);
		expect(summary.nodesRepresented.map((n) => n.id).sort()).toEqual(["node-a", "node-b"]);
		expect(summary.nodesRepresented.every((n) => n.name === "sede")).toBe(true);
		expect(summary.nodesRepresented.every((n) => n.observations === 1)).toBe(true);
	});

	it("collapses many observations from one node, by id, into a single entry", () => {
		const summary = summariseObservations([
			{ "host.id": "node-a", "host.name": "sede" },
			{ "host.id": "node-a", "host.name": "sede" },
			{ "host.id": "node-a", "host.name": "sede" },
		]);
		expect(summary.nodesRepresented).toEqual([{ id: "node-a", name: "sede", observations: 3 }]);
	});

	it("counts an observation with an id and no name as a real node, labelled unnamed", () => {
		const summary = summariseObservations([{ "host.id": "node-a" }]);
		expect(summary.nodesRepresented).toEqual([{ id: "node-a", name: null, observations: 1 }]);
		expect(summary.unnamedNode).toBe(1);
		expect(summary.unidentifiedRecords).toBe(0);
	});

	it("gives two DIFFERENT unnamed nodes two entries, not one shared nameless bucket", () => {
		const summary = summariseObservations([{ "host.id": "node-a" }, { "host.id": "node-b" }]);
		expect(summary.nodesRepresented).toHaveLength(2);
		expect(summary.nodesRepresented.every((n) => n.name === null)).toBe(true);
		expect(summary.unnamedNode).toBe(2);
	});

	it("treats an empty declared name on an identified node the same as no name (D6)", () => {
		const summary = summariseObservations([{ "host.id": "node-a", "host.name": "" }]);
		expect(summary.nodesRepresented).toEqual([{ id: "node-a", name: null, observations: 1 }]);
		expect(summary.unnamedNode).toBe(1);
	});

	it("does not trust a non-string host.id or host.name as real values", () => {
		const summary = summariseObservations([{ "host.id": 42, "host.name": 7 }]);
		expect(summary.nodesRepresented).toEqual([]);
		expect(summary.unidentifiedRecords).toBe(1);
		expect(summary.unnamedNode).toBe(0);
	});

	it("keeps a record with no host.id at all out of nodesRepresented, but still countable", () => {
		// Every record written before node identity shipped is this case. It must not be
		// merged with any identified node — there is nothing stable to key it on — and it
		// must not vanish either (D6: absent is not zero).
		const summary = summariseObservations([
			{ "host.id": "node-a", "host.name": "sede" },
			{}, // no host.id, no host.name — pre-identity record
			{}, // a second one, from a possibly different machine — must not collapse into node-a
		]);
		expect(summary.nodesRepresented).toEqual([{ id: "node-a", name: "sede", observations: 1 }]);
		expect(summary.unidentifiedRecords).toBe(2);
	});

	it("keeps the newest non-null name when the same node renamed itself mid-batch", () => {
		// host.name is read live and is documented as mutable — a rename must not corrupt
		// the count, and the entry stays exactly one node throughout.
		const summary = summariseObservations([
			{ "host.id": "node-a", "host.name": "old-name" },
			{ "host.id": "node-a", "host.name": "new-name" },
		]);
		expect(summary.nodesRepresented).toEqual([{ id: "node-a", name: "new-name", observations: 2 }]);
	});

	it("sorts nodesRepresented by name, then by id, for a predictable listing", () => {
		const summary = summariseObservations([
			{ "host.id": "node-z", "host.name": "beta" },
			{ "host.id": "node-a", "host.name": "alpha" },
			{ "host.id": "node-b" }, // unnamed sorts before any declared name
		]);
		expect(summary.nodesRepresented.map((n) => n.id)).toEqual(["node-b", "node-a", "node-z"]);
	});
});

describe("currentRateTableFrom", () => {
	it("derives the current version from the newest observation's own stamp", () => {
		const current = currentRateTableFrom([
			{ "refarm.cost.rate_table_version": "2026-01-01", timestamp_ns: 100 },
			{ "refarm.cost.rate_table_version": "2026-08-03.1", timestamp_ns: 300 },
			{ "refarm.cost.rate_table_version": "2026-06-01", timestamp_ns: 200 },
		]);
		expect(current).toBe("2026-08-03.1");
	});

	it("returns undefined when nothing carries both a stamp and a timestamp", () => {
		expect(currentRateTableFrom([])).toBeUndefined();
		expect(currentRateTableFrom([{ "refarm.cost.rate_table_version": "2026-08-03.1" }])).toBeUndefined();
		expect(currentRateTableFrom([{ timestamp_ns: 100 }])).toBeUndefined();
	});
});

describe("groupObservations", () => {
	// ── The unattributed bucket is a row, never a dilution ────────────────────

	it("keeps unattributed records in their own bucket, never folded into a workspace total", () => {
		const grouped = groupObservations(
			[
				{ "refarm.workspace.id": "refarm" },
				{ "refarm.workspace.id": "refarm" },
				{ "refarm.workspace.id": "rcdc5" },
				{}, // no refarm.workspace.id
				{}, // no refarm.workspace.id
			],
			{ by: "workspace" },
		);
		expect(grouped.total).toBe(5);
		expect(grouped.groups).toHaveLength(2);
		const byKey = Object.fromEntries(grouped.groups.map((g) => [g.key, g.observations]));
		expect(byKey).toEqual({ refarm: 2, rcdc5: 1 });
		expect(grouped.unattributed.observations).toBe(2);
		// The bug this test exists to catch: summing the two GROUPS alone must never be
		// read as "the total" record count — 3 attributed + 2 unattributed is 5, not 3.
		const groupTotal = grouped.groups.reduce((sum, g) => sum + g.observations, 0);
		expect(groupTotal).toBe(3);
		expect(groupTotal).not.toBe(grouped.total);
	});

	it("reports a zero unattributed bucket (still present, not omitted) when every record is attributed", () => {
		const grouped = groupObservations([{ "refarm.workspace.id": "refarm" }], { by: "workspace" });
		expect(grouped.unattributed.observations).toBe(0);
	});

	// ── The subscription axis — null, not 0 ───────────────────────────────────

	it("reports usd: null, not 0, when every member of a group is subscription-priced", () => {
		const grouped = groupObservations(
			[
				{
					"refarm.workspace.id": "refarm",
					"refarm.pricing_mode": "subscription",
					"refarm.cost.estimated_usd": 0,
				},
				{
					"refarm.workspace.id": "refarm",
					"refarm.pricing_mode": "subscription",
					"refarm.cost.estimated_usd": 0,
				},
			],
			{ by: "workspace" },
		);
		const group = grouped.groups[0]!;
		expect(group.usd).toBeNull();
		expect(group.subscriptionMembers).toBe(2);
	});

	it("sums only the metered members of a mixed group and reports how many were excluded", () => {
		const grouped = groupObservations(
			[
				{
					"refarm.workspace.id": "rcdc5",
					"refarm.pricing_mode": "subscription",
					"refarm.cost.estimated_usd": 0,
				},
				{
					"refarm.workspace.id": "rcdc5",
					"refarm.pricing_mode": "subscription",
					"refarm.cost.estimated_usd": 0,
				},
				{ "refarm.workspace.id": "rcdc5", "refarm.pricing_mode": "api", "refarm.cost.estimated_usd": 1.25 },
			],
			{ by: "workspace" },
		);
		const group = grouped.groups[0]!;
		expect(group.usd).toBe(1.25);
		expect(group.subscriptionMembers).toBe(2);
	});

	it("excludes a priced-but-unknown member from usd and counts it apart from subscription (extends summariseObservations' vocabulary)", () => {
		// price_known: false is F5's "no rate on file" — distinct from a subscription
		// member, which is honestly zero rather than unpriced. Conflating the two would
		// undercount BOTH the operator's real spend and the record's own honesty.
		const grouped = groupObservations(
			[
				{
					"refarm.workspace.id": "rcdc5",
					"refarm.pricing_mode": "api",
					"refarm.cost.estimated_usd": 2,
					"refarm.cost.price_known": true,
				},
				{ "refarm.workspace.id": "rcdc5", "refarm.pricing_mode": "api", "refarm.cost.price_known": false },
			],
			{ by: "workspace" },
		);
		const group = grouped.groups[0]!;
		expect(group.usd).toBe(2);
		expect(group.priceUnknown).toBe(1);
		expect(group.subscriptionMembers).toBe(0);
	});

	// ── Token totals — the primary quantity ───────────────────────────────────

	it("sums token totals — input, output, cache_creation, cache_read, reasoning — across a group", () => {
		const grouped = groupObservations(
			[
				{
					"refarm.workspace.id": "refarm",
					"gen_ai.usage.input_tokens": 10,
					"gen_ai.usage.output_tokens": 20,
					"gen_ai.usage.cache_creation.input_tokens": 3,
					"gen_ai.usage.cache_read.input_tokens": 4,
					"gen_ai.usage.reasoning.output_tokens": 5,
				},
				{
					"refarm.workspace.id": "refarm",
					"gen_ai.usage.input_tokens": 1,
					"gen_ai.usage.output_tokens": 2,
				},
			],
			{ by: "workspace" },
		);
		expect(grouped.groups[0]!.tokens).toEqual({
			input: 11,
			output: 22,
			cacheCreation: 3,
			cacheRead: 4,
			reasoning: 5,
		});
	});

	// ── by: host / spawner ─────────────────────────────────────────────────────

	it("groups by host.id, not host.name, so two nodes sharing a declared name stay two rows", () => {
		const grouped = groupObservations(
			[
				{ "host.id": "node-a", "host.name": "sede" },
				{ "host.id": "node-b", "host.name": "sede" },
			],
			{ by: "host" },
		);
		expect(grouped.groups).toHaveLength(2);
		expect(grouped.groups.map((g) => g.key).sort()).toEqual(["node-a", "node-b"]);
		expect(grouped.groups.every((g) => g.label === "sede")).toBe(true);
	});

	it("groups by refarm.budget.spawner", () => {
		const grouped = groupObservations(
			[
				{ "refarm.budget.spawner": "refarm-ask" },
				{ "refarm.budget.spawner": "refarm-ask" },
				{ "refarm.budget.spawner": "capability-dispatch" },
			],
			{ by: "spawner" },
		);
		expect(grouped.groups.map((g) => ({ key: g.key, observations: g.observations }))).toEqual([
			{ key: "refarm-ask", observations: 2 },
			{ key: "capability-dispatch", observations: 1 },
		]);
	});

	it("sorts groups by observation count descending, ties broken by key ascending", () => {
		const grouped = groupObservations(
			[{ "refarm.workspace.id": "b" }, { "refarm.workspace.id": "a" }],
			{ by: "workspace" },
		);
		expect(grouped.groups.map((g) => g.key)).toEqual(["a", "b"]);
	});

	it("reports zero groups and a null-usd, zero unattributed bucket on an empty record, never throwing", () => {
		const grouped = groupObservations([], { by: "workspace" });
		expect(grouped.total).toBe(0);
		expect(grouped.groups).toEqual([]);
		expect(grouped.unattributed).toEqual({
			observations: 0,
			tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
			usd: null,
			subscriptionMembers: 0,
			priceUnknown: 0,
		});
	});
});

describe("printGroupedObservationsHuman — the subscription axis renders as —, never $0.00", () => {
	let stdout: string[];

	beforeEach(() => {
		stdout = [];
		vi.spyOn(console, "log").mockImplementation((...args) => void stdout.push(args.join(" ")));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("prints — for a group whose members are all subscription-priced, never $0.00", () => {
		const grouped = groupObservations(
			[{ "refarm.workspace.id": "refarm", "refarm.pricing_mode": "subscription" }],
			{ by: "workspace" },
		);
		printGroupedObservationsHuman(grouped);
		const text = stdout.join("\n");
		expect(text).toContain("—");
		expect(text).not.toContain("$0.00");
	});

	it("always prints the (unattributed) row, even when its count is zero", () => {
		const grouped = groupObservations([{ "refarm.workspace.id": "refarm" }], { by: "workspace" });
		printGroupedObservationsHuman(grouped);
		const text = stdout.join("\n");
		expect(text).toContain("(unattributed)");
	});
});

describe("printObservationsHuman — truncation notice", () => {
	// `summary.total` already means "how many observations this call returned" (the array
	// length `summariseObservations` counted) — that meaning is pinned by the header line
	// below (`(${summary.total} shown)`). The server's new fact, "how many
	// BudgetObservation nodes actually exist", is a DIFFERENT number and must never be
	// read through that same field name, so the page-level info travels in its own
	// `{ stored, truncated }` argument instead of being folded into `ObservationSummary`.
	let stdout: string[];

	beforeEach(() => {
		stdout = [];
		vi.spyOn(console, "log").mockImplementation((...args) => void stdout.push(args.join(" ")));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("prints a notice naming both counts when the payload says truncated: true", () => {
		const observations = [{ "refarm.outcome": "done" }];
		const summary = summariseObservations(observations);

		printObservationsHuman(observations, summary, { stored: 42, truncated: true });

		const text = stdout.join("\n");
		expect(text).toContain("42");
		expect(text.toLowerCase()).toContain("stored");
	});

	it("never prints 'of undefined' when truncated: true arrives without stored", () => {
		// Task 2's own contract (`BudgetObservationsPage`'s doc) allows `stored` and
		// `truncated` to be absent INDEPENDENTLY — a body can report truncation without
		// also reporting the true count. `page.stored` must not be interpolated blind.
		const observations = [{ "refarm.outcome": "done" }];
		const summary = summariseObservations(observations);

		printObservationsHuman(observations, summary, { stored: undefined, truncated: true });

		const text = stdout.join("\n");
		expect(text.toLowerCase()).not.toContain("undefined");
	});

	it("prints nothing about storage when the payload says truncated: false", () => {
		const observations = [{ "refarm.outcome": "done" }];
		const summary = summariseObservations(observations);

		printObservationsHuman(observations, summary, { stored: 1, truncated: false });

		const text = stdout.join("\n");
		expect(text.toLowerCase()).not.toContain("stored");
	});

	// The live path today: the operator's own node is running a sidecar built before
	// `stored`/`truncated` shipped, so `GET /nodes` omits both keys right now. A fallback
	// that rounds that gap to "complete" (`truncated: false`) would print a confident
	// answer nobody gave — this must render as its own third state instead.
	it("prints an unknown-completeness notice when the payload omits stored/truncated — NEVER the truncation warning or silence", () => {
		const observations = [{ "refarm.outcome": "done" }];
		const summary = summariseObservations(observations);

		printObservationsHuman(observations, summary, { stored: undefined, truncated: undefined });

		const text = stdout.join("\n");
		expect(text.toLowerCase()).toContain("unknown");
		// Must not read as either "the record is definitely complete" (silence) or "the
		// record is definitely truncated" (the --limit warning) — an unstated fact must not
		// be dressed up as either resolved state.
		expect(text.toLowerCase()).not.toContain("raise --limit");
	});
});

describe("budgetObservationsPageFromBody — absent means absent", () => {
	it("carries stored/truncated through when the sidecar reports them", () => {
		const page = budgetObservationsPageFromBody({ nodes: [{ a: 1 }], stored: 42, truncated: true });
		expect(page).toEqual({ observations: [{ a: 1 }], stored: 42, truncated: true });
	});

	it("leaves stored/truncated undefined — NOT defaulted — when the sidecar omits them", () => {
		// This is the exact shape an older sidecar build returns today: `{ nodes, total }`,
		// no `stored`, no `truncated`. `observations.length`/`false` would be a guess
		// dressed up as a fact.
		const page = budgetObservationsPageFromBody({ nodes: [{ a: 1 }, { b: 2 }], total: 2 } as never);
		expect(page.observations).toEqual([{ a: 1 }, { b: 2 }]);
		expect(page.stored).toBeUndefined();
		expect(page.truncated).toBeUndefined();
	});

	it("leaves stored/truncated undefined when the fields are present but the wrong type", () => {
		const page = budgetObservationsPageFromBody({
			nodes: [],
			stored: "42" as unknown as number,
			truncated: "true" as unknown as boolean,
		});
		expect(page.stored).toBeUndefined();
		expect(page.truncated).toBeUndefined();
	});
});

describe("outcomeMark", () => {
	it("renders a distinct mark for every outcome the record can carry, including delivered and partial (F2)", () => {
		const marks = new Set(
			["done", "delivered", "partial", "timed-out", "failed", "cancelled"].map(outcomeMark),
		);
		expect(marks.size).toBe(6);
		// An outcome the vocabulary does not (yet) name still renders, via the
		// fallback — it must never throw.
		expect(() => outcomeMark("some-future-outcome")).not.toThrow();
	});
});
